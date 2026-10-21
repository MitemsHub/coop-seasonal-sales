// app/api/admin/branches/replicate/route.js — Copy items from one branch to others.
//
//   POST { from_branch_id, to_branch_ids: number[], phone?, dry_run?, cycle_id? }
//
// For the selected (default: active) cycle it copies FROM the source branch:
//   1. every survey entry of its latest live submission (names, categories,
//      prices, rep photos, cancelled flags) into a NEW submission per target
//      branch tagged "replicated from <source>" — created once, then reused,
//      so the call is safe to repeat (idempotent)
//   2. each saved product's cycle price row *for the source branch's own
//      price* — an existing target price row ALWAYS wins (never overwritten)
//   3. the target's rep_phone is filled from the source branch when empty
//      (explicit `phone` overrides)
//
// IMPORTANT — branch independence (the admin's explicit concern): the copy
// creates SEPARATE per-branch data rows. Once created, a target branch's
// prices/entries live in their own rows and:
//   • editing a price in the target does NOT touch the source (and vice versa)
//   • cancelling an item for the target branch does not affect the source
//   • re-saving/refining an entry in the target writes to the target's own
//     submission — the source's entries are never rewritten
// Nothing is shared by reference; the only deliberate exception is the items
// catalog row itself (one shared product identity, the same way every branch
// already shares the General catalog).
//
// Auth: admin session (validateSession 'admin'), like every admin API.
// di: dry_run returns exactly what would happen, with no writes.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'
import { invalidateCache } from '../../../../../lib/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body, status = 200) => NextResponse.json(body, { status })

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return json({ ok: false, error: 'Unauthorized' }, 401)

  const supabase = createClient()
  const body = await request.json().catch(() => ({}))

  const fromBranchId = Number(body.from_branch_id)
  const toIds = Array.isArray(body.to_branch_ids)
    ? [...new Set(body.to_branch_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
    : []
  const dryRun = body.dry_run === true
  const phoneOverride = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null

  if (!Number.isFinite(fromBranchId) || fromBranchId <= 0) {
    return json({ ok: false, error: 'Pick the branch (the source) to copy from.' }, 400)
  }
  const toBranchIds = toIds.filter((id) => id !== fromBranchId)
  if (!toBranchIds.length) return json({ ok: false, error: 'Pick at least one branch to copy to.' }, 400)

  // Resolve the cycle (explicit or the active one)
  let cycleId = body.cycle_id != null && Number(body.cycle_id) > 0 ? Number(body.cycle_id) : null
  if (cycleId == null) {
    const { data: active } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
    cycleId = active?.id ?? null
  }
  if (cycleId == null) return json({ ok: false, error: 'No active cycle to copy within.' }, 400)

  // Load source + targets
  const { data: branchRows, error: brErr } = await supabase
    .from('branches')
    .select('id, code, name, rep_phone')
  if (brErr) return json({ ok: false, error: brErr.message }, 500)
  const byId = new Map((branchRows || []).map((b) => [b.id, b]))
  const from = byId.get(fromBranchId)
  if (!from) return json({ ok: false, error: 'Source branch not found' }, 404)

  // The source's latest live submission for this cycle (dated first, then forever-linked ones)
  const { data: srcSubs, error: subErr } = await supabase
    .from('food_survey_submissions')
    .select('id, rep_name, phone, created_at')
    .eq('branch_id', fromBranchId)
    .or(`cycle_id.eq.${cycleId},cycle_id.is.null`)
    .order('cycle_id', { nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (subErr) return json({ ok: false, error: subErr.message }, 500)
  const srcSub = (srcSubs || [])[0]
  if (!srcSub) {
    return json({ ok: false, error: `${from.name} has no survey submission for this cycle yet — nothing to copy.` }, 400)
  }

  const { data: srcEntries, error: entErr } = await supabase
    .from('food_survey_entries')
    .select('catalog_id, item_name, category, price, photo_url, saved_item_id, cancelled')
    .eq('submission_id', srcSub.id)
    .order('id')
  if (entErr) return json({ ok: false, error: entErr.message }, 500)
  const entries = srcEntries || []
  if (!entries.length) {
    return json({ ok: false, error: `${from.name}'s survey for this cycle has no item entries to copy.` }, 400)
  }

  // Prices in the cycle at the source branch, for the saved items
  const savedItemIds = [...new Set(entries.filter((e) => e.saved_item_id != null && !e.cancelled).map((e) => Number(e.saved_item_id)))]
  const srcPrices = new Map()
  if (savedItemIds.length) {
    for (let from0 = 0; ; from0 += 1000) {
      const { data: chunk, error: pErr } = await supabase
        .from('branch_item_prices')
        .select('branch_id, item_id, price, cycle_id')
        .eq('branch_id', fromBranchId)
        .eq('cycle_id', cycleId)
        .in('item_id', savedItemIds)
        .range(from0, from0 + 999)
      if (pErr) return json({ ok: false, error: pErr.message }, 500)
      for (const r of chunk || []) srcPrices.set(Number(r.item_id), Number(r.price || 0))
      if (!chunk || chunk.length < 1000) break
    }
  }

  // Results skeleton
  const results = []
  const createdSubmissions = []

  for (const targetId of toBranchIds) {
    const target = byId.get(targetId)
    if (!target) { results.push({ branch_id: targetId, ok: false, error: 'branch not found' }); continue }

    // Already-replicated submission for this branch + cycle → reuse it.
    let subId = null
    const { data: existing } = await supabase
      .from('food_survey_submissions')
      .select('id')
      .eq('branch_id', targetId)
      .eq('cycle_id', cycleId)
      .ilike('notes', `replicated from ${from.name}%`)
      .limit(1)
      .maybeSingle()
    const entriesCopied = { count: 0, skipped: 0 }
    const pricesWritten = { count: 0, kept: 0, unpriced: 0 }

    if (!dryRun) {
      if (existing?.id) {
        subId = existing.id
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('food_survey_submissions')
          .insert({
            rep_name: srcSub.rep_name || 'Replicated',
            branch_id: targetId,
            cycle_id: cycleId,
            source: 'rep',
            notes: `replicated from ${from.name} via Items Import`,
            phone: phoneOverride || srcSub.phone || null,
          })
          .select('id')
          .single()
        if (insErr) { results.push({ branch_id: targetId, ok: false, error: insErr.message }); continue }
        subId = ins.id
        createdSubmissions.push(subId)
      }
    }

    // Entry duplication — skip ones the target already has by name in this cycle
    const { data: tgtDupes } = await supabase
      .from('food_survey_entries')
      .select('item_name')
      .eq('submission_id', existing?.id ?? -1)
      .in('item_name', entries.map((e) => e.item_name).filter(Boolean))
    // For a fresh submission this returns nothing; when reusing an old one it
    // lists what is truly present already.
    // NOTE: reuse case with a duplicated submission needs the entries dupes
    // scoped to it; a NEW target branch (no existing sub) has none.
    const haveNames = new Set((tgtDupes || []).map((d) => (d.item_name || '').trim().toLowerCase()))
    for (const e of entries) {
      const nm = (e.item_name || '').trim().toLowerCase()
      if (haveNames.has(nm)) { entriesCopied.skipped++; continue }
      if (!dryRun) {
        const { error: eErr } = await supabase.from('food_survey_entries').insert({
          submission_id: subId,
          catalog_id: e.catalog_id ?? null,
          item_name: e.item_name,
          category: e.category || null,
          price: e.price ?? null,
          photo_url: e.photo_url || null,
          saved_item_id: e.saved_item_id ?? null,
          cancelled: e.cancelled === true,
        })
        if (eErr) { results.push({ branch_id: targetId, ok: false, error: eErr.message }); break }
      }
      entriesCopied.count++
    }

    // Prices — the source branch's own price per saved product; existing rows win.
    for (const itemId of savedItemIds) {
      const srcPrice = srcPrices.get(itemId)
      if (srcPrice == null) { pricesWritten.unpriced++; continue }
      const { data: tgt, error: tErr } = await supabase
        .from('branch_item_prices')
        .select('price')
        .eq('branch_id', targetId)
        .eq('item_id', itemId)
        .eq('cycle_id', cycleId)
        .maybeSingle()
      if (tErr) { results.push({ branch_id: targetId, ok: false, error: tErr.message }); break }
      if (tgt) { pricesWritten.kept++; continue }
      if (!dryRun) {
        const { error: wErr } = await supabase
          .from('branch_item_prices')
          .insert({ branch_id: targetId, item_id: itemId, cycle_id: cycleId, price: srcPrice })
        if (wErr) { results.push({ branch_id: targetId, ok: false, error: wErr.message }); break }
      }
      pricesWritten.count++
    }

    // rep_phone backfill
    if (!dryRun && (phoneOverride || from.rep_phone) && !target.rep_phone) {
      await supabase.from('branches').update({ rep_phone: phoneOverride || from.rep_phone }).eq('id', targetId)
    }

    results.push({
      branch_id: targetId,
      branch_name: target.name,
      ok: true,
      submission: dryRun ? (existing?.id ?? 'new') : Number(subId),
      entries_copied: entriesCopied.count,
      entries_skipped_existing: entriesCopied.skipped,
      prices_written: pricesWritten.count,
      prices_kept_existing: pricesWritten.kept,
      prices_unpriced_at_source: pricesWritten.unpriced,
      rep_phone: dryRun ? undefined : (phoneOverride || from.rep_phone || target.rep_phone || null),
    })
  }

  if (!dryRun) {
    // invalidate the shop caches for all involved branches so the copies
    // appear in members' shop immediately (same pattern as the price importer)
    try { await invalidateCache(`${'items-prices'}:${'*'}`) } catch {}
    // audit line
    try {
      await supabase.from('audit_log').insert({
        actor: 'admin', action: 'branch_replicate', module: 'items',
        detail: { from: fromBranchId, to: toBranchIds, cycle_id: cycleId, dry_run: false, results },
      })
    } catch {}
  }

  return json({ ok: true, dry_run: dryRun, cycle_id: cycleId, from: { id: from.id, name: from.name }, results })
}
