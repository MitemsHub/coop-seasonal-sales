// app/api/admin/items/route.js
// Items Management API — General + Outsourced items, and the image bank list.
//
//   GET  ?section=general|outsourced|images|submission_report&cycle_id=
//        general          → items saved as "general" with this cycle's price/markup
//        outsourced       → rep survey drafts for the cycle + their saved shop state
//        images           → the shared image bank (every item with a refined image)
//        submission_report→ every branch vs. the survey: who submitted, how many
//                           drafts, and who is still missing this cycle
//        shop_preview     → one branch's shop exactly as members see it for the
//                           cycle (items + branch markups, drafts flagged first)
//
//   POST { cycle_id, section, item_id?, sku?, name, category, unit, price,
//          markup?, image_url?, bank_only? }
//        Writes the item ONCE (items row) and a price row for EVERY branch for
//        the target cycle (branch_item_prices), so it appears in every branch's
//        shop immediately. Markup (when provided) is written for every branch
//        too, so editing markup here behaves like a one-shot version of the
//        Markups module. Images are always a link to the bank (items.image_url)
//        — never a new upload.
//        bank_only: true → creates/updates the items row ONLY (no price, no
//        cycle needed). That is how a new photo joins the Image Bank before
//        the item is priced anywhere; it shows in shops once it is priced in
//        Items Import for a cycle.
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

    // The full catalog (image or not) — powers the "pick an existing item"
    // name dropdown on Items Import so admins reuse rows instead of
    // duplicating them.
    if (section === 'all') {
      const { data, error } = await supabase
        .from('items')
        .select('item_id, sku, name, category, unit, image_url')
        .order('name')
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, items: data || [] })
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

    // ── Shop preview: how one branch's shop looks for this cycle ────
    // Mirrors the member shop exactly — v_inventory_status for this branch
    // + cycle with price > 0 (falling back to branch_item_prices if the view
    // is missing, same as the shop does), then the branch's active markups
    // added on top. Items matching this branch's survey drafts are flagged
    // and sorted first so the admin sees their refined work as members will.
    if (section === 'shop_preview') {
      const branchId = Number(searchParams.get('branch_id'))
      if (!Number.isInteger(branchId) || branchId <= 0) {
        return NextResponse.json({ ok: false, error: 'branch_id is required' }, { status: 400 })
      }
      const { data: branch, error: brErr } = await supabase
        .from('branches')
        .select('id, name, code')
        .eq('id', branchId)
        .maybeSingle()
      if (brErr) return NextResponse.json({ ok: false, error: brErr.message }, { status: 500 })
      if (!branch) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

      // 1. Items priced for this branch (same queries the member shop runs)
      let rows = []
      let invErr = null
      const runInventory = async (withCycle) => {
        let q = supabase
          .from('v_inventory_status')
          .select('item_id, sku, item_name, unit, category, image_url, price')
          .eq('branch_code', branch.code)
          .gt('price', 0)
        if (withCycle) q = q.eq('cycle_id', cycleId)
        return await q.order('item_name')
      }
      ;({ data: rows, error: invErr } = await runInventory(true))
      if (invErr && String(invErr.message || '').includes('cycle_id')) {
        ;({ data: rows, error: invErr } = await runInventory(false))
      }
      if (invErr && String(invErr.message || '').toLowerCase().includes('does not exist')) {
        // View missing → the shop's own fallback: branch_item_prices + items
        const runFallback = async (withCycle) => {
          let q = supabase
            .from('branch_item_prices')
            .select('price, items:item_id(item_id, name, sku, unit, category, image_url)')
            .eq('branch_id', branchId)
            .gt('price', 0)
          if (withCycle) q = q.eq('cycle_id', cycleId)
          return await q.order('name', { foreignTable: 'items' })
        }
        let fbRows = null
        ;({ data: fbRows, error: invErr } = await runFallback(true))
        if (invErr && String(invErr.message || '').includes('cycle_id')) {
          ;({ data: fbRows, error: invErr } = await runFallback(false))
        }
        rows = (fbRows || []).filter((r) => r.items).map((r) => ({
          item_id: r.items.item_id,
          sku: r.items.sku,
          item_name: r.items.name,
          unit: r.items.unit,
          category: r.items.category,
          image_url: r.items.image_url,
          price: r.price,
        }))
      }
      if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 })

      // 2. This branch's active markups — displayed price = price + markup
      let mkData = null
      const runMarkups = async (withCycle) => {
        let q = supabase.from('branch_item_markups').select('item_id, amount, active').eq('branch_id', branchId)
        if (withCycle) q = q.eq('cycle_id', cycleId)
        return await q
      }
      ;({ data: mkData } = await runMarkups(true))
      if (!mkData) {
        const retry = await runMarkups(false)
        mkData = retry.data
      }
      const markupByItem = new Map(
        (mkData || []).filter((m) => m.active !== false).map((m) => [m.item_id, Number(m.amount || 0)])
      )

      // 3. This branch's survey drafts — same cycle rule as the outsourced list
      const { data: subs } = await supabase
        .from('food_survey_submissions')
        .select('id')
        .eq('branch_id', branchId)
        .or(`cycle_id.eq.${Number(cycleId)},cycle_id.is.null`)
      const subIds = (subs || []).map((s) => s.id)
      const draftNames = new Set()
      if (subIds.length) {
        const { data: ents } = await supabase.from('food_survey_entries').select('item_name').in('submission_id', subIds)
        for (const e of ents || []) {
          const key = norm(e.item_name)
          if (key) draftNames.add(key)
        }
      }

      // 4. Compose exactly what the member shop shows for this branch
      const items = (rows || []).map((r) => {
        const markup = markupByItem.get(r.item_id) || 0
        const base = Number(r.price || 0)
        return {
          item_id: r.item_id,
          sku: r.sku || '',
          name: r.item_name || '',
          unit: r.unit || '',
          category: r.category || '',
          image_url: r.image_url || '',
          base_price: base,
          markup,
          price: base + markup,
          from_draft: draftNames.has(norm(r.item_name)),
        }
      })
      items.sort((a, b) => Number(b.from_draft) - Number(a.from_draft) || String(a.name).localeCompare(String(b.name)))

      return NextResponse.json({
        ok: true,
        cycle_id: cycleId,
        section,
        branch: { id: branch.id, name: branch.name, code: branch.code || '' },
        items,
        total: items.length,
        draft_hits: items.filter((i) => i.from_draft).length,
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

    // A single-item patch carrying only name/SKU is a field edit (the Image
    // Bank inline rename) — it must not be gated on an image_url.
    const isFieldEdit = itemIds.length === 1 && (body.name !== undefined || body.sku !== undefined)

    if (!imageUrl && !isFieldEdit) return NextResponse.json({ ok: false, error: 'image_url is required — pick an image from the bank' }, { status: 400 })
    if (!itemIds.length) return NextResponse.json({ ok: false, error: 'No items selected' }, { status: 400 })
    if (itemIds.length > 500) return NextResponse.json({ ok: false, error: 'Select at most 500 items per batch' }, { status: 400 })

    // Field edits write exactly the field(s) the client sent; image
    // assignments write image_url. Mixing them is not supported.
    const updatePatch = isFieldEdit
      ? Object.fromEntries(
          [
            ['name', body.name !== undefined ? String(body.name).trim() : undefined],
            ['sku', body.sku !== undefined ? String(body.sku).trim().toUpperCase() : undefined],
          ].filter(([, v]) => v !== undefined)
        )
      : { image_url: imageUrl }

    const { data, error } = await supabase
      .from('items')
      .update(updatePatch)
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

    // bank_only → a bank entry: the items row (name/SKU/category/unit/image)
    // with no price, no cycle and no branches. It joins the Image Bank right
    // away and only shows in shops once it is priced for a cycle in Items Import.
    const bankOnly = body.bank_only === true
    if (name.length < 2) return NextResponse.json({ ok: false, error: 'Item name is required (min 2 characters)' }, { status: 400 })
    if (!bankOnly && !(price > 0)) return NextResponse.json({ ok: false, error: 'Price must be greater than 0 for the item to show in the shop' }, { status: 400 })

    let cycleId = null
    if (!bankOnly) {
      cycleId = await resolveCycleId(supabase, body.cycle_id)
      if (cycleId == null) return NextResponse.json({ ok: false, error: 'No cycle found' }, { status: 400 })
    }

    await ensureSourceColumn()
    const sourceCol = await hasColumn(supabase, 'items', 'source')

    let branches = []
    let targetBranchId = null

    // Outsourced edits are branch-scoped: the price/markup are written only
    // for the draft's branch, not broadcast to every branch in the cycle.
    if (section === 'outsourced') {
      // The Items Import editor sends draft.branch_id. Other clients (for
      // example a future "add outsourced item" flow) may post branch_id
      // directly on the payload instead.
      const draft = body.draft
      const bodyBranchId = body.branch_id != null && body.branch_id !== '' ? Number(body.branch_id) : null

      if (draft?.branch_id != null) {
        targetBranchId = Number(draft.branch_id)
      } else if (Number.isFinite(bodyBranchId) && bodyBranchId > 0) {
        targetBranchId = bodyBranchId
      } else {
        return NextResponse.json(
          { ok: false, error: 'An outsourced item needs a draft.branch_id or branch_id so price and markup are written for the right branch.' },
          { status: 400 }
        )
      }

      if (!Number.isFinite(targetBranchId) || targetBranchId <= 0) {
        return NextResponse.json({ ok: false, error: 'branch id must be a valid branch' }, { status: 400 })
      }
      const { data: branchRow, error: brErr } = await supabase
        .from('branches')
        .select('id, code')
        .eq('id', targetBranchId)
        .maybeSingle()
      if (brErr) return NextResponse.json({ ok: false, error: brErr.message }, { status: 500 })
      if (!branchRow) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })
    } else {
      const { data: branchRows, error: bErr } = await supabase.from('branches').select('id, code').order('id')
      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
      if (!branchRows?.length) return NextResponse.json({ ok: false, error: 'No branches found' }, { status: 400 })
      branches = branchRows
    }

    // ── 1. Upsert the item row (the shared catalog entry) ────────────────
    const sku = String(body.sku || '').trim().toUpperCase() || skuFromName(name)
    const patch = { name, sku }
    // A bank-only save may carry just a photo (or just a name) — it must not
    // blank out fields it was not given, especially on an existing row. A
    // full save writes them all, exactly as the form sent them.
    if (category || !bankOnly) patch.category = category
    if (unit || !bankOnly) patch.unit = unit
    if (image_url || !bankOnly) patch.image_url = image_url
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

    // Bank-only save stops here: the item (and its image) is in the bank.
    if (bankOnly) {
      return NextResponse.json({
        ok: true,
        bank_only: true,
        item: { item_id: itemRow.item_id, sku: itemRow.sku, name: itemRow.name },
        branches_priced: 0,
        markup_branches: 0,
      })
    }

    // ── 2. Write price + markup only for the relevant branch(es) ─────────
    const pricesHasCycle = await hasColumn(supabase, 'branch_item_prices', 'cycle_id')
    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')

    const priceRows = section === 'outsourced'
      ? [{ branch_id: targetBranchId, item_id: itemRow.item_id, price }]
      : branches.map((b) => {
          const row = { branch_id: b.id, item_id: itemRow.item_id, price }
          if (pricesHasCycle) row.cycle_id = cycleId
          return row
        })

    let branches_priced = 0
    const writePrices = async (rows) => {
      if (!rows.length) return 0
      try {
        await queryDirect(
          pricesHasCycle
            ? `CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item_cycle ON public.branch_item_prices(branch_id, item_id, cycle_id);`
            : `CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item ON public.branch_item_prices(branch_id, item_id);`
        )
      } catch {}

      const upsertPrices = async (part) => {
        const { error, count } = await supabase
          .from('branch_item_prices')
          .upsert(part, { onConflict: pricesHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id', ignoreDuplicates: false, count: 'exact' })
        return { error, count }
      }

      let { error: pErr } = await upsertPrices(rows)
      if (pErr && String(pErr.message || '').includes('duplicate key value') && String(pErr.message || '').includes('branch_item_prices_pkey')) {
        try {
          await queryDirect(`SELECT setval(pg_get_serial_sequence('public.branch_item_prices','id'), (SELECT COALESCE(MAX(id), 0) FROM public.branch_item_prices));`)
        } catch {}
        ;({ error: pErr } = await upsertPrices(rows))
      }
      if (pErr && String(pErr.message || '').toLowerCase().includes('no unique or exclusion constraint matching the on conflict specification')) {
        await transactionalQuery(7201, async (q) => {
          for (const r of rows) {
            if (pricesHasCycle) {
              const { rows: qRows } = await q('SELECT id FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1', [r.branch_id, r.item_id, r.cycle_id])
              if (qRows.length) await q('UPDATE branch_item_prices SET price = $1 WHERE id = $2', [r.price, qRows[0].id])
              else await q('INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price) VALUES ($1, $2, $3, $4)', [r.branch_id, r.item_id, r.cycle_id, r.price])
            } else {
              const { rows: qRows } = await q('SELECT id FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 LIMIT 1', [r.branch_id, r.item_id])
              if (qRows.length) await q('UPDATE branch_item_prices SET price = $1 WHERE id = $2', [r.price, qRows[0].id])
              else await q('INSERT INTO branch_item_prices (branch_id, item_id, price) VALUES ($1, $2, $3)', [r.branch_id, r.item_id, r.price])
            }
          }
        })
        pErr = null
      }
      if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })
      return rows.length
    }

    branches_priced = await writePrices(priceRows)

    // ── 3. Markup for the relevant branch(es) (same power as the Markups module) ────
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

      let markupRows
      if (section === 'outsourced') {
        markupRows = [{ branch_id: targetBranchId, item_id: itemRow.item_id, amount: markup, active: true }]
        if (markupsHasCycle) markupRows[0].cycle_id = cycleId
      } else {
        markupRows = branches.map((b) => {
          const row = { branch_id: b.id, item_id: itemRow.item_id, amount: markup, active: true }
          if (markupsHasCycle) row.cycle_id = cycleId
          return row
        })
      }

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
