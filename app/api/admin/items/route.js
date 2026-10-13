// app/api/admin/items/route.js
// Items Management API — General + Outsourced items, and the image bank list.
//
//   GET  ?section=general|outsourced|images|submission_report&cycle_id=
//        general          → items saved as "general" with this cycle's price/markup
//        outsourced       → rep survey drafts for the cycle + their saved shop state
//        images           → the shared image bank (every item with a refined image)
//        submission_report→ every branch vs. the survey: who submitted, how many
//                           drafts, and who is still missing this cycle
//
//   POST { cycle_id, section, item_id?, sku?, name, category, unit, price,
//          markup?, image_url? }
//        Writes the item ONCE (items row) and a price row for EVERY branch for
//        the target cycle (branch_item_prices), so it appears in every branch's
//        shop immediately. Markup (when provided) is written for every branch
//        too, so editing markup here behaves like a one-shot version of the
//        Markups module. Images are always a link to the bank (items.image_url)
//        — never a new upload.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { queryDirect, transactionalQuery } from '../../../../lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[, ₦]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Stable SKU derived from the name — items imported by Excel use readable
// SKUs; items first created here get one so image uploads (named by SKU) work.
const skuFromName = (name) => {
  const base = String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 32)
  return base || `ITEM${Date.now().toString(36).toUpperCase()}`
}

const hasColumn = async (supabase, table, column) => {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

// items.source ('general' | 'outsourced') keeps the two sections separate.
// Created on demand (same lazy-DDL pattern the price importer uses) so the
// feature works before the migration file has been run by hand.
const ensureSourceColumn = async () => {
  try {
    await queryDirect(`ALTER TABLE public.items ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'general'`)
    return true
  } catch (e) {
    console.warn('items.source column ensure skipped:', e?.message || e)
    return false
  }
}

const resolveCycleId = async (supabase, requested) => {
  if (requested != null && requested !== '') return Number(requested)
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.id) return data.id
  const { data: latest } = await supabase.from('cycles').select('id').order('id', { ascending: false }).limit(1).maybeSingle()
  return latest?.id ?? null
}

// Per-branch values collapse to one editable number: uniform → that value,
// divergent → the lowest with a varies flag (saving unifies every branch).
const collapse = (values) => {
  const uniq = [...new Set(values.map((v) => Number(v)))]
  if (!uniq.length) return { value: null, varies: false }
  if (uniq.length === 1) return { value: uniq[0], varies: false }
  return { value: Math.min(...uniq), varies: true }
}

export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const section = String(searchParams.get('section') || 'general')

    // The image bank is cycle-independent (that's the whole point — one bank,
    // reused every cycle), so it answers before any cycle lookup.
    if (section === 'images') {
      const { data, error } = await supabase
        .from('items')
        .select('item_id, sku, name, category, image_url')
        .not('image_url', 'is', null)
        .neq('image_url', '')
        .order('name')
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      const seen = new Set()
      const images = (data || []).filter((r) => {
        const key = String(r.image_url).split('?')[0]
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return NextResponse.json({ ok: true, images })
    }

    const cycleId = await resolveCycleId(supabase, searchParams.get('cycle_id'))
    if (cycleId == null) return NextResponse.json({ ok: false, error: 'No cycle found' }, { status: 400 })

    // ── Submission report: which branches have filed their survey ─────
    // Branches with no submission still come back (submitted: false) so the
    // admin can see exactly who is missing. Drafts tagged cycle_id NULL are
    // counted too — the outsourced list shows them for every cycle.
    if (section === 'submission_report') {
      const { data: branches, error: bErr } = await supabase.from('branches').select('id, name, code').order('name')
      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
      const { data: subs, error: sErr } = await supabase
        .from('food_survey_submissions')
        .select('id, branch_id, rep_name, created_at, entries:food_survey_entries(id)')
        .or(`cycle_id.eq.${Number(cycleId)},cycle_id.is.null`)
      if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 })

      const byBranch = new Map()
      for (const s of subs || []) {
        if (!byBranch.has(s.branch_id)) {
          byBranch.set(s.branch_id, { submissions: 0, entries: 0, reps: new Set(), last_at: null })
        }
        const acc = byBranch.get(s.branch_id)
        acc.submissions += 1
        acc.entries += (s.entries || []).length
        if (s.rep_name) acc.reps.add(String(s.rep_name))
        if (!acc.last_at || String(s.created_at || '') > String(acc.last_at)) acc.last_at = s.created_at || acc.last_at
      }

      const rows = (branches || []).map((b) => {
        const acc = byBranch.get(b.id)
        return {
          branch_id: b.id,
          name: b.name,
          code: b.code || '',
          submitted: !!acc,
          submissions: acc?.submissions || 0,
          entries: acc?.entries || 0,
          reps: acc ? [...acc.reps] : [],
          last_at: acc?.last_at || null,
        }
      })
      return NextResponse.json({
        ok: true,
        cycle_id: cycleId,
        section,
        branches: rows,
        total: rows.length,
        submitted: rows.filter((r) => r.submitted).length,
        draft_count: rows.reduce((n, r) => n + r.entries, 0),
      })
    }

    const sourceCol = (await ensureSourceColumn()) && (await hasColumn(supabase, 'items', 'source'))
    const pricesHasCycle = await hasColumn(supabase, 'branch_item_prices', 'cycle_id')
    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')

    const itemFields = sourceCol ? 'item_id, sku, name, category, unit, image_url, source' : 'item_id, sku, name, category, unit, image_url'
    const { data: items, error: iErr } = await supabase.from('items').select(itemFields).order('name')
    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 })

    let priceQ = supabase.from('branch_item_prices').select('branch_id, item_id, price')
    if (pricesHasCycle) priceQ = priceQ.eq('cycle_id', cycleId)
    const { data: prices, error: pErr } = await priceQ
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

    let markupQ = supabase.from('branch_item_markups').select('branch_id, item_id, amount, active')
    if (markupsHasCycle) markupQ = markupQ.eq('cycle_id', cycleId)
    const { data: markups } = await markupQ // markup table may predate markups — ignore errors

    const pricesByItem = new Map()
    for (const p of prices || []) {
      if (!pricesByItem.has(p.item_id)) pricesByItem.set(p.item_id, [])
      pricesByItem.get(p.item_id).push(p)
    }
    const markupsByItem = new Map()
    for (const m of markups || []) {
      if (m.active === false) continue // deactivated markup doesn't affect the shop price
      if (!markupsByItem.has(m.item_id)) markupsByItem.set(m.item_id, [])
      markupsByItem.get(m.item_id).push(m)
    }

    const decorate = (it) => {
      const pr = collapse((pricesByItem.get(it.item_id) || []).map((p) => p.price))
      const mk = collapse((markupsByItem.get(it.item_id) || []).map((m) => m.amount))
      return {
        item_id: it.item_id,
        sku: it.sku,
        name: it.name,
        category: it.category || '',
        unit: it.unit || '',
        image_url: it.image_url || '',
        source: it.source || 'general',
        price: pr.value,
        price_varies: pr.varies,
        markup: mk.value,
        markup_varies: mk.varies,
        branches_priced: (pricesByItem.get(it.item_id) || []).length,
        in_shop: (pricesByItem.get(it.item_id) || []).length > 0 && Number(pr.value) > 0,
      }
    }

    if (section === 'general') {
      const rows = (items || [])
        .filter((it) => (sourceCol ? (it.source || 'general') === 'general' : true))
        .filter((it) => pricesByItem.has(it.item_id)) // only what's priced in this cycle
        .map(decorate)
      return NextResponse.json({ ok: true, cycle_id: cycleId, section, rows })
    }

    // ── Outsourced: rep survey drafts, refined into shop items ──────────
    const { data: entries, error: eErr } = await supabase
      .from('food_survey_entries')
      .select('id, catalog_id, item_name, category, price, photo_url, submission:food_survey_submissions(cycle_id, rep_name, branch_id)')
    if (eErr) return NextResponse.json({ ok: false, error: eErr.message }, { status: 500 })

    const [{ data: catalog }, { data: branches }] = await Promise.all([
      supabase.from('food_survey_catalog').select('id, name, unit'),
      supabase.from('branches').select('id, name, code').order('name'),
    ])

    const catalogById = new Map((catalog || []).map((c) => [c.id, c]))
    const branchById = new Map((branches || []).map((b) => [b.id, b]))
    const itemByName = new Map()
    for (const it of items || []) if (!itemByName.has(norm(it.name))) itemByName.set(norm(it.name), it)

    // Drafts are keyed per branch + item — the same item submitted by two
    // branches appears under each branch so the admin works branch by branch.
    const drafts = new Map() // `${branch_id}::${norm(name)}` → draft
    for (const e of entries || []) {
      if (e.submission && e.submission.cycle_id != null && Number(e.submission.cycle_id) !== Number(cycleId)) continue
      const nameKey = norm(e.item_name)
      if (!nameKey) continue
      const branchId = e.submission?.branch_id ?? null
      const draftKey = `${branchId ?? 'none'}::${nameKey}`
      if (drafts.has(draftKey)) continue
      const cat = e.catalog_id ? catalogById.get(e.catalog_id) : null
      const br = branchId != null ? branchById.get(branchId) : null
      drafts.set(draftKey, {
        key: draftKey,
        norm_name: nameKey,
        draft_name: String(e.item_name || '').trim(),
        draft_category: e.category || cat?.name || '',
        draft_unit: cat?.unit || '',
        draft_price: num(e.price),
        rep_photo: e.photo_url || '',
        rep_name: e.submission?.rep_name || '',
        branch_id: branchId,
        branch_name: br?.name || '',
        branch_code: br?.code || '',
      })
    }

    const rows = []
    const draftedNames = new Set()
    for (const d of drafts.values()) {
      draftedNames.add(d.norm_name)
      const saved = itemByName.get(d.norm_name)
      rows.push({ ...decorate(saved || {}), saved: !!saved, draft: d })
    }
    // Keep already-saved outsourced items editable even if the survey entry
    // was deleted or renamed away.
    if (sourceCol) {
      for (const it of items || []) {
        if ((it.source || '') !== 'outsourced') continue
        if (itemByName.get(norm(it.name)) !== it) continue
        if (draftedNames.has(norm(it.name))) continue
        rows.push({ ...decorate(it), saved: true, draft: null })
      }
    }
    // Group-friendly order: branch name, then item name; drafts first.
    rows.sort((a, b) => {
      const br = String(a.draft?.branch_name || 'zzz').localeCompare(String(b.draft?.branch_name || 'zzz'))
      if (br !== 0) return br
      return String(a.draft?.draft_name || a.name || '').localeCompare(String(b.draft?.draft_name || b.name || ''))
    })

    return NextResponse.json({ ok: true, cycle_id: cycleId, section, rows })
  } catch (e) {
    console.error('Items management GET error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}

// PATCH { item_ids: number[], image_url }
// Bulk image assignment: point any number of items at ONE bank image in a
// single UPDATE — the same items.image_url link the shop, branches and
// imports already use, so every selected item shows it immediately.
export async function PATCH(req) {
  try {
    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const itemIds = [...new Set((Array.isArray(body.item_ids) ? body.item_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    const imageUrl = String(body.image_url || '').trim()

    if (!imageUrl) return NextResponse.json({ ok: false, error: 'image_url is required — pick an image from the bank' }, { status: 400 })
    if (!itemIds.length) return NextResponse.json({ ok: false, error: 'No items selected' }, { status: 400 })
    if (itemIds.length > 500) return NextResponse.json({ ok: false, error: 'Select at most 500 items per batch' }, { status: 400 })

    const { data, error } = await supabase
      .from('items')
      .update({ image_url: imageUrl })
      .in('item_id', itemIds)
      .select('item_id')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, updated: (data || []).length, requested: itemIds.length })
  } catch (e) {
    console.error('Items management PATCH error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const section = body.section === 'outsourced' ? 'outsourced' : 'general'
    const name = String(body.name || '').trim()
    const price = num(body.price)
    const markup = body.markup === undefined || body.markup === null || body.markup === '' ? null : num(body.markup)
    const category = String(body.category || '').trim()
    const unit = String(body.unit || '').trim()
    const image_url = String(body.image_url || '').trim()
    const itemId = body.item_id != null && body.item_id !== '' ? Number(body.item_id) : null

    if (name.length < 2) return NextResponse.json({ ok: false, error: 'Item name is required (min 2 characters)' }, { status: 400 })
    if (!(price > 0)) return NextResponse.json({ ok: false, error: 'Price must be greater than 0 for the item to show in the shop' }, { status: 400 })

    const cycleId = await resolveCycleId(supabase, body.cycle_id)
    if (cycleId == null) return NextResponse.json({ ok: false, error: 'No cycle found' }, { status: 400 })

    await ensureSourceColumn()
    const sourceCol = await hasColumn(supabase, 'items', 'source')

    const { data: branches, error: bErr } = await supabase.from('branches').select('id, code').order('id')
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    if (!branches?.length) return NextResponse.json({ ok: false, error: 'No branches found' }, { status: 400 })

    // ── 1. Upsert the item row (the shared catalog entry) ────────────────
    const sku = String(body.sku || '').trim().toUpperCase() || skuFromName(name)
    const patch = { name, sku, category, unit, image_url }
    if (sourceCol) patch.source = section // fall back to a plain catalog item if the column is missing
    let itemRow = null

    if (itemId) {
      const { data, error } = await supabase.from('items').update(patch).eq('item_id', itemId).select('item_id, sku, name').single()
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      itemRow = data
    } else {
      const { data: existing } = await supabase.from('items').select('item_id').eq('sku', sku).maybeSingle()
      if (existing) {
        const { data, error } = await supabase.from('items').update(patch).eq('item_id', existing.item_id).select('item_id, sku, name').single()
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        itemRow = data
      } else {
        const doInsert = () => supabase.from('items').insert(patch).select('item_id, sku, name').single()
        let { data, error } = await doInsert()
        if (error && String(error.message || '').includes('duplicate key value') && String(error.message || '').includes('items_pkey')) {
          try {
            await queryDirect(`SELECT setval(pg_get_serial_sequence('public.items','item_id'), (SELECT COALESCE(MAX(item_id), 0) FROM public.items));`)
          } catch {}
          ;({ data, error } = await doInsert())
        }
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        itemRow = data
      }
    }

    // ── 2. Price for EVERY branch in this cycle → visible in every shop ──
    const pricesHasCycle = await hasColumn(supabase, 'branch_item_prices', 'cycle_id')
    try {
      await queryDirect(
        pricesHasCycle
          ? `CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item_cycle ON public.branch_item_prices(branch_id, item_id, cycle_id);`
          : `CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item ON public.branch_item_prices(branch_id, item_id);`
      )
    } catch {}

    const priceRows = branches.map((b) => {
      const row = { branch_id: b.id, item_id: itemRow.item_id, price }
      if (pricesHasCycle) row.cycle_id = cycleId
      return row
    })

    const upsertPrices = async (part) => {
      const { error, count } = await supabase
        .from('branch_item_prices')
        .upsert(part, { onConflict: pricesHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id', ignoreDuplicates: false, count: 'exact' })
      return { error, count }
    }

    let { error: pErr } = await upsertPrices(priceRows)
    if (pErr && String(pErr.message || '').includes('duplicate key value') && String(pErr.message || '').includes('branch_item_prices_pkey')) {
      try {
        await queryDirect(`SELECT setval(pg_get_serial_sequence('public.branch_item_prices','id'), (SELECT COALESCE(MAX(id), 0) FROM public.branch_item_prices));`)
      } catch {}
      ;({ error: pErr } = await upsertPrices(priceRows))
    }
    if (pErr && String(pErr.message || '').toLowerCase().includes('no unique or exclusion constraint matching the on conflict specification')) {
      // Missing unique index — fall back to manual update/insert under a lock.
      await transactionalQuery(7201, async (q) => {
        for (const r of priceRows) {
          if (pricesHasCycle) {
            const { rows } = await q('SELECT id FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1', [r.branch_id, r.item_id, r.cycle_id])
            if (rows.length) await q('UPDATE branch_item_prices SET price = $1 WHERE id = $2', [r.price, rows[0].id])
            else await q('INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price) VALUES ($1, $2, $3, $4)', [r.branch_id, r.item_id, r.cycle_id, r.price])
          } else {
            const { rows } = await q('SELECT id FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 LIMIT 1', [r.branch_id, r.item_id])
            if (rows.length) await q('UPDATE branch_item_prices SET price = $1 WHERE id = $2', [r.price, rows[0].id])
            else await q('INSERT INTO branch_item_prices (branch_id, item_id, price) VALUES ($1, $2, $3)', [r.branch_id, r.item_id, r.price])
          }
        }
      })
      pErr = null
    }
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

    // ── 3. Markup for EVERY branch (same power as the Markups module) ────
    let markupBranches = 0
    if (markup != null) {
      const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')
      try {
        await queryDirect(
          markupsHasCycle
            ? `CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_item_markups_cycle ON public.branch_item_markups(branch_id, item_id, cycle_id);`
            : `CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_item_markups ON public.branch_item_markups(branch_id, item_id);`
        )
      } catch {}

      const markupRows = branches.map((b) => {
        const row = { branch_id: b.id, item_id: itemRow.item_id, amount: markup, active: true }
        if (markupsHasCycle) row.cycle_id = cycleId
        return row
      })

      const upsertMarkups = async (part) => {
        const { error, count } = await supabase
          .from('branch_item_markups')
          .upsert(part, { onConflict: markupsHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id', ignoreDuplicates: false, count: 'exact' })
        return { error, count }
      }

      let { error: mErr } = await upsertMarkups(markupRows)
      if (mErr && String(mErr.message || '').includes('duplicate key value')) {
        ;({ error: mErr } = await upsertMarkups(markupRows))
      }
      if (mErr && String(mErr.message || '').toLowerCase().includes('no unique or exclusion constraint matching the on conflict specification')) {
        await transactionalQuery(7202, async (q) => {
          for (const r of markupRows) {
            if (markupsHasCycle) {
              const { rows } = await q('SELECT id FROM branch_item_markups WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1', [r.branch_id, r.item_id, r.cycle_id])
              if (rows.length) await q('UPDATE branch_item_markups SET amount = $1, active = TRUE WHERE id = $2', [r.amount, rows[0].id])
              else await q('INSERT INTO branch_item_markups (branch_id, item_id, cycle_id, amount) VALUES ($1, $2, $3, $4)', [r.branch_id, r.item_id, r.cycle_id, r.amount])
            } else {
              const { rows } = await q('SELECT id FROM branch_item_markups WHERE branch_id = $1 AND item_id = $2 LIMIT 1', [r.branch_id, r.item_id])
              if (rows.length) await q('UPDATE branch_item_markups SET amount = $1, active = TRUE WHERE id = $2', [r.amount, rows[0].id])
              else await q('INSERT INTO branch_item_markups (branch_id, item_id, amount) VALUES ($1, $2, $3)', [r.branch_id, r.item_id, r.amount])
            }
          }
        })
        mErr = null
      }
      if (mErr) return NextResponse.json({ ok: false, error: `Saved, but markup failed: ${mErr.message}` }, { status: 500 })
      markupBranches = markupRows.length
    }

    return NextResponse.json({
      ok: true,
      cycle_id: cycleId,
      section,
      item: { item_id: itemRow.item_id, sku: itemRow.sku, name: itemRow.name },
      branches_priced: priceRows.length,
      markup_branches: markupBranches,
    })
  } catch (e) {
    console.error('Items management POST error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
