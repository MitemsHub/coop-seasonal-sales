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
//
//   DELETE ?item_id= — CANCEL an item (the admin's deliberate removal).
//        Not a hard row delete: items.is_active flips to false, the shop, the
//        pickers and every priced list hide it immediately, order history
//        stays intact, and the row (with its SKU tombstoned to RETIRED-…)
//        remains visible in the Image Bank's Deleted items so the admin can
//        restore it. mode=restore activates it again.
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

const ensureItemActiveColumn = async () => {
  try {
    await queryDirect(`ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`)
    return true
  } catch (e) {
    console.warn('items.is_active column ensure skipped:', e?.message || e)
    return false
  }
}

// food_survey_entries.saved_item_id pins a rep's survey draft to the exact
// item row the admin saved it as. The name alone is NOT reliable — the admin
// routinely refines "Coco pop" into "Kellogg's Coco Pops Sachet 400g", and a
// name-only match would then show the branch's draft as "Not worked on yet"
// even though the item (price, image, markup) is live in that branch's shop.
// Created on demand with the same lazy-DDL pattern as items.source.
const ensureSurveyLinkColumn = async () => {
  try {
    await queryDirect(`ALTER TABLE public.food_survey_entries ADD COLUMN IF NOT EXISTS saved_item_id BIGINT`)
    return true
  } catch (e) {
    console.warn('food_survey_entries.saved_item_id column ensure skipped:', e?.message || e)
    return false
  }
}

// Per-entry cancelled flag — set by the admin's Cancel action on an item.
// The entry itself stays in the Survey (the rep's submission is history),
// but it renders with a Cancelled badge and the Items Import resolver skips
// it. Cleared again by the restore handler should the item come back.
const ensureEntryCancelledColumn = async () => {
  try {
    await queryDirect(`ALTER TABLE public.food_survey_entries ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT FALSE`)
    return true
  } catch (e) {
    console.warn('food_survey_entries.cancelled column ensure skipped:', e?.message || e)
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
      // Retired items (is_active=false) STAY in the bank so the admin can
      // restore them from Image Bank › Deleted items, but the item carries
      // its is_active flag so the UI can badge them "Deleted".
      const imagesHasActive = await hasColumn(supabase, 'items', 'is_active')
      let imagesQ = supabase
        .from('items')
        .select(`item_id, sku, name, category, image_url${imagesHasActive ? ', is_active' : ''}`)
        .not('image_url', 'is', null)
        .neq('image_url', '')
      const { data, error } = await imagesQ
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
      // A retired item must not be offered again in "pick an existing
      // item" — that's how twins reappear. Active only.
      const allHasActive = await hasColumn(supabase, 'items', 'is_active')
      let allQ = supabase
        .from('items')
        .select('item_id, sku, name, category, unit, image_url')
      if (allHasActive) allQ = allQ.eq('is_active', true)
      const { data, error } = await allQ.order('name')
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
      // Cancelled entries are read too so their linked products leave the
      // branch's preview (the admin removed them for this branch; showing
      // them would mean a cancel never affects what shoppers see).
      const { data: subs } = await supabase
        .from('food_survey_submissions')
        .select('id')
        .eq('branch_id', branchId)
        .or(`cycle_id.eq.${Number(cycleId)},cycle_id.is.null`)
      const subIds = (subs || []).map((s) => s.id)
      const draftNames = new Set()
      const cancelledItemIds = new Set()
      if (subIds.length) {
        let ents = null
        let entsErr = null
        const withCols = await supabase.from('food_survey_entries').select('item_name, cancelled, saved_item_id').in('submission_id', subIds)
        ents = withCols.data
        entsErr = withCols.error
        if (entsErr) {
          // Legacy deployment without saved_item_id/cancelled — fall back to
          // names only so the preview still works.
          const plain = await supabase.from('food_survey_entries').select('item_name').in('submission_id', subIds)
          ents = plain.data
        }
        for (const e of ents || []) {
          if (e.cancelled === true) {
            const linkId = e.saved_item_id != null ? Number(e.saved_item_id) : null
            if (linkId) cancelledItemIds.add(linkId) // linked product hidden for this branch+cycle
            continue // cancelled entries never rank a product as "refined work"
          }
          const key = norm(e.item_name)
          if (key) draftNames.add(key)
        }
      }

      // 4. Compose exactly what the member shop shows for this branch
      const items = (rows || [])
        .filter((r) => !cancelledItemIds.has(r.item_id))
        .map((r) => {
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
        cancelled_hidden: cancelledItemIds.size,
      })
    }

    const sourceCol = (await ensureSourceColumn()) && (await hasColumn(supabase, 'items', 'source'))
    const pricesHasCycle = await hasColumn(supabase, 'branch_item_prices', 'cycle_id')
    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')
    const itemsHasActive = await hasColumn(supabase, 'items', 'is_active')

    // is_active rides along on every item row so the Outsourced resolver can
    // drop cancelled items (the admin removed them deliberately) and the
    // General list can exclude them too.
    const itemFields = [
      'item_id, sku, name, category, unit, image_url',
      sourceCol ? 'source' : null,
      itemsHasActive ? 'is_active' : null,
    ].filter(Boolean).join(', ')
    let itemsQ = supabase.from('items').select(itemFields)
    if (itemsHasActive) itemsQ = itemsQ.eq('is_active', true)
    itemsQ = itemsQ.order('name')
    const { data: items, error: iErr } = await itemsQ
    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 })

    let priceQ = supabase.from('branch_item_prices').select('branch_id, item_id, price')
    if (pricesHasCycle) priceQ = priceQ.eq('cycle_id', cycleId)
    // A cycle can hold thousands of priced rows (24 branches × hundreds of
    // items); without an explicit range PostgREST silently returns the first
    // 1000 and the list would miss items (ghost "Not worked on yet" cards).
    priceQ = priceQ.range(0, 99999)
    const { data: prices, error: pErr } = await priceQ
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

    let markupQ = supabase.from('branch_item_markups').select('branch_id, item_id, amount, active')
    if (markupsHasCycle) markupQ = markupQ.eq('cycle_id', cycleId)
    markupQ = markupQ.range(0, 99999)
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
    const surveyLinkCol = await ensureSurveyLinkColumn()
    const cancelledCol = await ensureEntryCancelledColumn()
    const surveyLinkField = surveyLinkCol
      ? (cancelledCol ? 'saved_item_id, cancelled' : 'saved_item_id')
      : (cancelledCol ? 'cancelled' : null)
    const entriesSelect = [
      'id, catalog_id, item_name, category, price, photo_url',
      surveyLinkField,
      'submission:food_survey_submissions(cycle_id, rep_name, branch_id)',
    ].filter(Boolean).join(', ')
    const { data: entries, error: eErr } = await supabase.from('food_survey_entries').select(entriesSelect)
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
    // EVERY survey entry gets its own card. The survey form is the admin's
    // raw intake, not a unique-product registry: a rep can submit "Rice" in
    // two submissions at one branch meaning TWO different products (e.g.
    // Bulmex ₦51,000 vs another rice ₦52,000 — real Abeokuta data), and the
    // admin must see and refine both. Earlier versions collapsed same-name
    // duplicates per branch, which silently Hid those second products (and
    // first caused the last-page jump when the hidden entry was the linked
    // one). Exact-clone entries (same branch + name + link) still dedupe so
    // a technical double-insert doesn't render twice.
    const drafts = new Map() // draftKey (branch::name::link::entry) → draft
    for (const e of entries || []) {
      if (e.submission && e.submission.cycle_id != null && Number(e.submission.cycle_id) !== Number(cycleId)) continue
      const nameKey = norm(e.item_name)
      if (!nameKey) continue
      const branchId = e.submission?.branch_id ?? null
      const linkId = surveyLinkCol ? e.saved_item_id ?? null : null
      const draftKey = `${branchId ?? 'none'}::${nameKey}::${linkId ?? 'none'}::${e.id}`
      if (drafts.has(draftKey)) continue
      const cat = e.catalog_id ? catalogById.get(e.catalog_id) : null
      const br = branchId != null ? branchById.get(branchId) : null
      drafts.set(draftKey, {
        key: draftKey,
        norm_name: nameKey,
        entry_id: e.id,
        entry_id_link: linkId,
        draft_name: String(e.item_name || '').trim(),
        draft_category: e.category || cat?.name || '',
        draft_unit: cat?.unit || '',
        draft_price: num(e.price),
        rep_photo: e.photo_url || '',
        rep_name: e.submission?.rep_name || '',
        branch_id: branchId,
        branch_name: br?.name || '',
        branch_code: br?.code || '',
        cancelled: cancelledCol ? e.cancelled === true : false,
      })
    }

    const rows = []
    const draftedNames = new Set()
    // A draft resolves its saved item through the persistent survey link
    // (saved_item_id) FIRST — surviving renames — and falls back to the
    // name match only when the link is missing (legacy data).
    const itemById = new Map((items || []).map((it) => [it.item_id, it]))
    // Legacy backfill: drafts saved before the link existed are recovered
    // via a price-verified signature (see below) — NEVER by "only item
    // priced at the branch", which force-links different products together.
    // The recovered link is persisted so every later load resolves it directly.
    const recoveredLinks = new Map() // entry_id → item_id
    if (surveyLinkCol) {
      const pendingDrafts = []
      for (const d of drafts.values()) {
        const link = d.entry_id_link
        if (link == null || !itemById.has(link)) pendingDrafts.push(d)
        else recoveredLinks.set(d.entry_id, link)
      }
      const claimedItemsByBranch = new Map() // branch_id → Map(item_id → norm_name of the claiming draft)
      for (const d of pendingDrafts) {
        if (d.branch_id == null) continue
        // Recovery is price-verified ONLY. "The only outsourced item priced
        // at this branch" is NOT evidence — a branch can legitimately have
        // one saved product while its drafts are for several different
        // products, and blind recovery force-links drafts of different
        // products to the same item (five drafts once resolved to one
        // cereal). The form pre-fills the draft's own price, so an untouched
        // save keeps that price on the item: a unique branch price equal to
        // the draft price is a checkable signature of the right save.
        if (!(d.draft_price > 0)) continue // no price to verify against → name-match fallback in charge
        const pricedAtBranch = (items || []).filter((it) => {
          if ((sourceCol ? it.source || 'general' : it.source) !== 'outsourced') return false
          const pr = (pricesByItem.get(it.item_id) || []).find(
            (p) => Number(p.branch_id) === Number(d.branch_id) && Number(p.price || 0) > 0
          )
          return pr != null && Math.abs(Number(pr.price) - d.draft_price) < 0.01
        })
        if (pricedAtBranch.length !== 1) continue // none or ambiguous → never guess
        const chosen = pricedAtBranch[0]
        // Price alone is a hint, not a verdict. Before a price-only recovery
        // is trusted, the other drafts at this branch must not be waiting to
        // contradict it — if any differently-named draft carries the SAME
        // price, that price identifies no product (Ado-Ekiti's "Rice" and
        // "Bow Oil" both ₦60,000). The item is only claimed when the draft
        // ALSO names it: the draft being a leading, contained version of the
        // saved name ("Coco pop" → "Kellogg's Coco Pops Sachet 400g", a real
        // legacy rename) or the saved name containing the draft name keeps
        // the original recovery useful while refusing the indistinguishable
        // collision case that erased the admin's genuine pin.
        const priceSharedByOtherName = [...drafts.values()].some(
          (o) =>
            o.entry_id !== d.entry_id &&
            o.branch_id === d.branch_id &&
            o.norm_name !== d.norm_name &&
            Math.abs(Number(o.draft_price || 0) - d.draft_price) < 0.01
        )
        const chosenNorm = norm(chosen.name)
        const namesAgree = d.norm_name.includes(chosenNorm) || chosenNorm.includes(d.norm_name)
        if (priceSharedByOtherName && !namesAgree) continue
        // Two DIFFERENT products can share one draft price at a branch
        // (Ado-Ekiti's "Rice" and "Bow Oil" both ₦60,000): once one of them
        // is linked to the priced item, the price signature alone stops being
        // evidence for the other. Letting the second claim the same item made
        // the repair pass see "two different names on one item": it kept no
        // winner and UNLINKED BOTH — erasing the admin's genuine save pin.
        // So: an already-claimed item may only serve another draft of the
        // SAME name (a legit resubmission of the same product).
        const claimed = claimedItemsByBranch.get(d.branch_id)
        const chosenClaim = claimed?.get(chosen.item_id)
        if (chosenClaim != null && chosenClaim !== d.norm_name) continue
        // The skip happens before persistence and before recovery tracking;
        // the genuine price match keeps its claim and the same-name variant
        // still collapses onto the saved card afterwards.
        recoveredLinks.set(d.entry_id, chosen.item_id)
        d.entry_id_link = chosen.item_id
        if (!claimed) claimedItemsByBranch.set(d.branch_id, new Map())
        claimedItemsByBranch.get(d.branch_id).set(chosen.item_id, d.norm_name)
        try {
          await queryDirect(`UPDATE public.food_survey_entries SET saved_item_id = $1 WHERE id = $2 AND saved_item_id IS NULL`, [chosen.item_id, d.entry_id])
        } catch {}
      }
    }
    // Repair pass: clear links written by the old over-eager recovery.
    // A saved outsourced item is ONE product, so within a (branch, item)
    // link group every draft with the SAME draft name is a legit
    // resubmission — but drafts of DIFFERENT names sharing one item can
    // only mean at most one of them is real. Keep a candidate only when
    // its draft price matches the item's current branch price; otherwise
    // clear the group so the name-match fallback (or a re-Edit + Save) can
    // re-link each draft correctly.
    if (surveyLinkCol) {
      const linkGroups = new Map() // `${branch}::${item}` → drafts
      for (const d of drafts.values()) {
        const link = d.entry_id_link
        if (link == null || !itemById.has(link)) continue
        const gk = `${d.branch_id ?? 'none'}::${link}`
        if (!linkGroups.has(gk)) linkGroups.set(gk, [])
        linkGroups.get(gk).push(d)
      }
      const unlinks = new Set() // entry ids whose link must be cleared
      for (const [, group] of linkGroups.entries()) {
        if (group.length < 2) continue
        if (new Set(group.map((d) => d.norm_name)).size < 2) continue // same product name → legit resubmissions
        const winners = group.filter((d) => {
          if (!(d.draft_price > 0)) return false
          const pr = (pricesByItem.get(itemById.get(d.entry_id_link).item_id) || []).find(
            (p) => Number(p.branch_id) === Number(d.branch_id)
          )
          return pr != null && Math.abs(Number(pr.price || 0) - d.draft_price) < 0.01
        })
        const keep = winners.length === 1 ? new Set([winners[0].entry_id]) : new Set()
        for (const d of group) {
          if (!keep.has(d.entry_id)) {
            unlinks.add(d.entry_id)
            d.entry_id_link = null
            // The recovery pass may have recorded this link before the
            // repair saw the conflict — drop it so this same load already
            // resolves the draft as unsaved (no second refresh needed).
            recoveredLinks.delete(d.entry_id)
          }
        }
      }
      if (unlinks.size) {
        try {
          await queryDirect(`UPDATE public.food_survey_entries SET saved_item_id = NULL WHERE id = ANY($1::int[])`, [[...unlinks]])
        } catch {}
      }
    }

    const savedItemIdsClaimed = new Set() // `${item_id}::${branch}` — cards already shown IN that branch
    const itemsShownSomewhere = new Set() // items claimed by ANY draft row (guards the trailing pass)
    for (const d of drafts.values()) {
      // Collapse to one row PER RESOLVED PRODUCT PER BRANCH, not per draft
      // name: the same product resubmitted twice at the SAME branch (price
      // signature matches) renders once, while a genuinely different product
      // keeps its own card. But ONE saved item legitimately serves MANY
      // branches — the same bank item refined from Abeokuta's Samvita is
      // also Kano's Semovita card, each with its own branch price. A cycle-
      // wide claim set would silently HIDE the second branch's card (the
      // "Samvita disappeared after saving" regression), so the claim is
      // scoped to (item, branch).
      let saved = null
      const linkedId = surveyLinkCol ? recoveredLinks.get(d.entry_id) ?? d.entry_id_link ?? null : null
      if (linkedId != null && itemById.has(linkedId)) {
        saved = itemById.get(linkedId)
      } else {
        // No persistent link (legacy rows) or the linked item was deleted —
        // fall back to the old name-only match.
        saved = itemByName.get(d.norm_name)
      }
      // Capture the resolution BEFORE the cancelled suppression — a cancelled
      // draft that DID resolve to a product still identifies that product and
      // must keep it from resurfacing below.
      const resolvedItem = saved
      // A CANCELLED item must not surface in the Outsourced list even when a
      // name-only match still finds it — the admin deliberately removed it,
      // so the draft renders as "Not worked on yet" instead of linking back.
      if (saved && saved.is_active === false) saved = null
      if (saved && d.cancelled) {
        // The admin cancelled this product: the draft row still shows (per the
        // Survey requirement) but as a Cancelled card of its own — no saved
        // resolution, no shop price, no Edit & save flow.
        saved = null
      }
      if (saved) {
        const claimKey = `${saved.item_id}::${d.branch_id ?? 'none'}`
        if (savedItemIdsClaimed.has(claimKey)) continue // same product, already shown IN THIS BRANCH
        savedItemIdsClaimed.add(claimKey)
        itemsShownSomewhere.add(saved.item_id)
      } else if (d.cancelled && resolvedItem) {
        // Cancelled draft: claim the product it would have resolved to, so
        // the saved-items pass can't resurrect the very same item as an
        // un-cancelled row after a refresh. Without this, a cancelled entry
        // reads back from the database as Cancelled on its own card yet ALSO
        // resurfaces as a live “Saved items — no survey draft” card
        // (the real Samvita "cancel → refresh → came back" report).
        itemsShownSomewhere.add(resolvedItem.item_id)
        savedItemIdsClaimed.add(`${resolvedItem.item_id}::${d.branch_id ?? 'none'}`)
      }
      rows.push({ ...decorate(saved || {}), saved: !!saved, draft: d })
    }
    // Keep already-saved outsourced items editable even if the survey entry
    // was deleted or renamed away. Skips items that already resolved to a
    // draft above (any name) — otherwise a refined/renamed item appeared a
    // SECOND time as a nameless "Saved items — no survey draft" row on the
    // last page, which is where the surprise jump came from.
    if (sourceCol) {
      for (const it of items || []) {
        if ((it.source || '') !== 'outsourced') continue
        if (itemsHasActive && it.is_active === false) continue // cancelled items stay out of the list
        if (itemByName.get(norm(it.name)) !== it) continue
        if (draftedNames.has(norm(it.name))) continue
        if (savedItemIdsClaimed.has(it.item_id) || itemsShownSomewhere.has(it.item_id)) continue
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

    // A single-item patch carrying only name/SKU/category/unit is a field
    // edit (the Image Bank inline rename / reclassify) — it must not be
    // gated on an image_url.
    const isFieldEdit =
      itemIds.length === 1 &&
      (body.name !== undefined || body.sku !== undefined || body.category !== undefined || body.unit !== undefined)

    if (!imageUrl && !isFieldEdit) return NextResponse.json({ ok: false, error: 'image_url is required — pick an image from the bank' }, { status: 400 })
    if (!itemIds.length) return NextResponse.json({ ok: false, error: 'No items selected' }, { status: 400 })
    if (itemIds.length > 500) return NextResponse.json({ ok: false, error: 'Select at most 500 items per batch' }, { status: 400 })

    // Field edits write exactly the field(s) the client sent; image
    // assignments write image_url. Mixing them is not supported.
    // category/unit: empty string clears the value — the shop/reports read
    // these, so blanking is allowed deliberately (an admin can land an item
    // back in "no category" to redo it), while name/sku stay non-empty
    // because the card needs something to display.
    const updatePatch = isFieldEdit
      ? Object.fromEntries(
          [
            ['name', body.name !== undefined ? String(body.name).trim() : undefined],
            ['sku', body.sku !== undefined ? String(body.sku).trim().toUpperCase() : undefined],
            ['category', body.category !== undefined ? String(body.category).trim() : undefined],
            ['unit', body.unit !== undefined ? String(body.unit).trim() : undefined],
          ].filter(([, v]) => v !== undefined)
        )
      : { image_url: imageUrl }

    if (updatePatch.name === '') return NextResponse.json({ ok: false, error: 'Item name cannot be empty' }, { status: 400 })
    if (updatePatch.sku === '') return NextResponse.json({ ok: false, error: 'SKU cannot be empty' }, { status: 400 })

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

// DELETE ?item_id= — CANCEL an item (not a hard row delete).
//
// The admin's removal request: is_active → false. Effects:
//   • the shop (v_inventory_status + member queries), the price importers,
//     the "pick an existing item" list and the Image Bank's active cards all
//     read is_active — the item disappears from every one of them at once;
//   • branch_item_prices, markups and order history stay untouched, so past
//     orders keep their receipts and a future cycle can still re-add it;
//   • the SKUS uniqueness constraint needs a free code for the NEXT item
//     with that name — retiring moves this row's SKU to RETIRED-<old SKU>
//     (the restore handler reclaims it), so creating a new "Knorr Cubes"
//     after cancelling an old one cannot collide;
//   • the Image Bank's Deleted items panel lists the row with a Restore
//     button (and, if the admin changed their mind, one click is all it
//     takes to bring the item back).
export async function DELETE(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const itemId = Number(searchParams.get('item_id'))
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ ok: false, error: 'item_id is required' }, { status: 400 })
    }

    const mode = String(searchParams.get('mode') || '')

    // ── Branch-scoped cancel/restore (Outsourced items) ────────────────
    // Cancelling an outsourced card is a decision about ONE branch's survey
    // entry ("this product is not needed in Akure"), not about the shared
    // catalog item other branches may price. It flags only that
    // food_survey_entries row; the item, its Image Bank picture, its prices
    // in other branches and the General list are untouched. The entry keeps
    // showing in the branch's Survey with its Cancelled badge, and the
    // Outsourced list renders it as a Cancelled card until restored.
    if (mode === 'cancel-draft' || mode === 'restore-draft') {
      const entryId = Number(searchParams.get('entry_id'))
      if (!Number.isInteger(entryId) || entryId <= 0) {
        return NextResponse.json({ ok: false, error: 'entry_id is required for a branch-scoped cancel' }, { status: 400 })
      }
      if (!(await ensureEntryCancelledColumn())) {
        return NextResponse.json({ ok: false, error: 'cancelled column unavailable' }, { status: 500 })
      }
      const cancel = mode === 'cancel-draft'
      const res = await queryDirect(
        `UPDATE public.food_survey_entries SET cancelled = $1 WHERE id = $2 RETURNING id, item_name, saved_item_id`,
        [cancel, entryId]
      )
      const row = res?.rows?.[0]
      if (!row) return NextResponse.json({ ok: false, error: 'Survey entry not found' }, { status: 404 })
      return NextResponse.json({ ok: true, entry_id: row.id, item_name: row.item_name, cancelled: cancel, draft_cancelled: cancel })
    }

    // is_active must exist before any cancel/restore write — the lazy-DDL
    // fallback for deployments that have not run the migration file yet.
    await ensureItemActiveColumn()

    // Restore: bring an earlier-cancelled item back into circulation. The
    // SKU was re-homed to a RETIRED- tombstone while cancelled (see the
    // cancel path) — reclaim it first unless another active item took the
    // code in the meantime (then keep the tombstone so uniqueness holds).
    if (mode === 'restore') {
      const { data: item } = await supabase
        .from('items')
        .select('item_id, sku, name, is_active')
        .eq('item_id', itemId)
        .maybeSingle()
      if (!item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })
      if (item.is_active !== false) {
        return NextResponse.json({ ok: true, item_id: item.item_id, restored: false })
      }
      const baseSku = String(item.sku || '').startsWith('RETIRED-')
        ? String(item.sku).slice('RETIRED-'.length)
        : String(item.sku || '')
      if (baseSku) {
        try {
          const { data: skuOwner } = await supabase.from('items').select('item_id').eq('sku', baseSku).maybeSingle()
          if (!skuOwner || Number(skuOwner?.item_id) === item.item_id) {
            await supabase.from('items').update({ sku: baseSku }).eq('item_id', item.item_id)
          }
        } catch {}
      }
      const { error } = await supabase.from('items').update({ is_active: true }).eq('item_id', item.item_id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      // Undo the Cancelled badges the cancel pass stamped on the survey entries.
      try {
        if (await ensureEntryCancelledColumn()) {
          await queryDirect(`UPDATE public.food_survey_entries SET cancelled = FALSE WHERE saved_item_id = $1 AND cancelled IS TRUE`, [item.item_id])
        }
      } catch {}
      return NextResponse.json({ ok: true, item_id: item.item_id, restored: true, sku: baseSku || item.sku })
    }

    // Common first step: fetch the item.
    const { data: item, error: fetchErr } = await supabase
      .from('items')
      .select('item_id, sku, name, image_url, is_active')
      .eq('item_id', itemId)
      .maybeSingle()
    if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
    if (!item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })
    if (item.is_active === false) {
      return NextResponse.json({ ok: true, item_id: item.item_id, cancelled: true, already: true })
    }

    // How many branch/cycle price rows reference this item? Diagnostic only —
    // cancel keeps them (order history), it never deletes them.
    let pricedCount = 0
    try {
      const priced = await queryDirect(
        `SELECT COUNT(*)::int AS n FROM public.branch_item_prices WHERE item_id = $1`,
        [item.item_id]
      )
      pricedCount = Number(priced?.rows?.[0]?.n ?? 0)
    } catch {}

    // ── CANCEL (is_active=false) ──────────────────────────────────────
    const cancelPatch = { is_active: false }
    // Tombstone the SKU so the unique index frees the code for the next
    // item with the same name, and so POST's sku-matching upsert can never
    // resurrect the cancelled twin. The restore handler strips it back.
    if (item.sku && !String(item.sku).startsWith('RETIRED-')) {
      cancelPatch.sku = `RETIRED-${item.sku}`.slice(0, 100)
    }

    const { error } = await supabase
      .from('items')
      .update(cancelPatch)
      .eq('item_id', item.item_id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Flag every survey entry that resolves to this item — each submission
    // card in the Survey keeps its entry but now shows a Cancelled badge.
    let cancelledEntries = 0
    try {
      if (await ensureEntryCancelledColumn()) {
        await queryDirect(
          `UPDATE public.food_survey_entries SET cancelled = TRUE WHERE saved_item_id = $1 AND cancelled IS NOT TRUE`,
          [item.item_id]
        )
        const cnt = await queryDirect(
          `SELECT COUNT(*)::int AS n FROM public.food_survey_entries WHERE saved_item_id = $1 AND cancelled IS TRUE`,
          [item.item_id]
        )
        cancelledEntries = Number(cnt?.rows?.[0]?.n ?? 0)
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      item_id: item.item_id,
      cancelled: true,
      priced_branches: pricedCount,
      cancelled_survey_entries: cancelledEntries,
    })
  } catch (e) {
    console.error('Items management DELETE error:', e)
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
    // The food_survey_entries id (from draft.draft_id) — declared here so the
    // pin-the-draft step below (outside the outsourced block) can read it.
    let surveyEntryId = null

    // Outsourced edits are branch-scoped: the price/markup are written only
    // for the draft's branch, not broadcast to every branch in the cycle.
    if (section === 'outsourced') {
      // The Items Import editor sends draft.branch_id (plus draft_id, the
      // food_survey_entries id, so this save can pin the draft to the item.
      // Other clients (for example a future "add outsourced item" flow) may
      // post branch_id directly on the payload instead.
      const draft = body.draft
      const entryId = Number(draft?.draft_id ?? NaN)
      if (Number.isFinite(entryId) && entryId > 0) surveyEntryId = entryId
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
      // The admin may rename/re-SKU the item; if the target code already
      // belongs to a DIFFERENT item (the usual "Knorr Cubes → Knorr Chicken
      // Cubes" rename: the old name's derived SKU is taken), suffix the SKU
      // (-2, -3, …) instead of failing the whole save with a Postgres
      // duplicate-key error the admin cannot act on.
      let effPatch = patch
      if (patch.sku) {
        const { data: owner } = await supabase.from('items').select('item_id').eq('sku', patch.sku).maybeSingle()
        if (owner && Number(owner.item_id) !== itemId) {
          let candidate = ''
          // Cap the probe so a pathological catalog can't loop forever.
          for (let n = 2; n < 100; n++) {
            candidate = `${patch.sku}-${n}`
            const { data: cOwner } = await supabase.from('items').select('item_id').eq('sku', candidate).maybeSingle()
            if (!cOwner || Number(cOwner.item_id) === itemId) break
            candidate = ''
          }
          effPatch = { ...patch, sku: candidate || `${patch.sku}-${Date.now().toString(36).toUpperCase()}` }
        }
      }
      const { data, error } = await supabase.from('items').update(effPatch).eq('item_id', itemId).select('item_id, sku, name').single()
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      itemRow = data
    } else {
      // A retired item hides its SKU behind the RETIRED- tombstone (see the
      // DELETE handler), so the base-SKU lookup only ever finds an ACTIVE
      // item — creating a new product can never silently resurrect the
      // retired one.
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

    // ── 1b. Pin the rep's survey draft to this item row (outsourced saves)
    // The link is what lets the Outsourced list keep showing "Worked on"
    // after the admin renames the item during refinement.
    if (section === 'outsourced' && Number.isFinite(surveyEntryId) && surveyEntryId > 0) {
      try {
        await queryDirect(`UPDATE public.food_survey_entries SET saved_item_id = $1 WHERE id = $2`, [itemRow.item_id, surveyEntryId])
      } catch (e) {
        console.warn('Survey entry link update skipped:', e?.message || e)
      }
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
