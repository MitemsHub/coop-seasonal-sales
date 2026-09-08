// app/api/admin/import/prices/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { queryDirect, transactionalQuery } from '../../../../../lib/directDb'
import * as XLSX from 'xlsx/xlsx.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const chunk = (arr, size = 500) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(req) {
  try {
    const supabase = createClient()
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file) return NextResponse.json({ ok: false, error: 'file is required' }, { status: 400 })

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

    // Preflight: ensure items sequence is correctly positioned to avoid duplicate key on item_id
    try {
      await queryDirect(
        `SELECT setval(pg_get_serial_sequence('public.items','item_id'), (SELECT COALESCE(MAX(item_id), 0) FROM public.items));`
      )
    } catch (seqErr) {
      console.warn('Items sequence preflight skipped:', seqErr?.message || seqErr)
    }

    // Expected headers:
    // sku, item_name, unit, category, branch_code, price
    if (!rows.length) return NextResponse.json({ ok: false, error: 'No rows found' }, { status: 400 })

    // Fetch branches
    const { data: branches, error: bErr } = await supabase.from('branches').select('id,code')
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    const branchByCode = new Map(branches.map(b => [String(b.code).trim().toUpperCase(), b.id]))

    const itemUpserts = []
    const priceUpserts = []
    const unknownBranches = new Set()

    // First collect item rows by sku
    const itemsMap = new Map() // sku -> {sku,name,unit,category}
    for (const r of rows) {
      const sku = String(r.sku || '').trim().toUpperCase()
      const name = String(r.item_name || '').trim()
      const unit = String(r.unit || '').trim()
      const category = String(r.category || '').trim()
      if (!sku || !name) continue
      if (!itemsMap.has(sku)) itemsMap.set(sku, { sku, name: name, unit, category })
    }
    itemUpserts.push(...itemsMap.values())

    // Upsert items with sequence repair and single retry on duplicate key
    let itemsAffected = 0
    for (const part of chunk(itemUpserts, 500)) {
      const doUpsert = async () => {
        return await supabase
          .from('items')
          .upsert(part, { onConflict: 'sku', ignoreDuplicates: false, count: 'exact' })
      }
      let { error: iErr, count } = await doUpsert()
      if (iErr && String(iErr.message || '').includes('duplicate key value') && String(iErr.message || '').includes('items_pkey')) {
        // Attempt sequence repair then retry once
        try {
          await queryDirect(
            `SELECT setval(pg_get_serial_sequence('public.items','item_id'), (SELECT COALESCE(MAX(item_id), 0) FROM public.items));`
          )
        } catch (seqErr) {
          console.warn('Sequence repair failed:', seqErr?.message || seqErr)
        }
        const retry = await doUpsert()
        iErr = retry.error
        count = retry.count
      }
      if (iErr) {
        console.error('Items upsert error:', iErr)
        return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 })
      }
      itemsAffected += count || part.length
    }

    // Fetch items to map ids
    const { data: itemsAll, error: fiErr } = await supabase.from('items').select('item_id,sku')
    if (fiErr) return NextResponse.json({ ok: false, error: fiErr.message }, { status: 500 })
    const itemIdBySku = new Map(itemsAll.map(i => [String(i.sku).trim().toUpperCase(), i.item_id]))

    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }

    // Get active cycle
    const { data: activeCycle, error: cycleErr } = await supabase
      .from('cycles')
      .select('id')
      .eq('is_active', true)
      .maybeSingle()
    if (cycleErr) return NextResponse.json({ ok: false, error: cycleErr.message }, { status: 500 })
    if (!activeCycle?.id) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const pricesHasCycle = await hasColumn('branch_item_prices', 'cycle_id')

    // Build branch_item_prices upserts and inventory movements
    const inventoryMovements = []
    
    // Preflight: ensure branch_item_prices sequence is correctly positioned to avoid duplicate key on id
    try {
      await queryDirect(
        `SELECT setval(pg_get_serial_sequence('public.branch_item_prices','id'), (SELECT COALESCE(MAX(id), 0) FROM public.branch_item_prices));`
      )
    } catch (seqErr) {
      console.warn('Branch item prices sequence preflight skipped:', seqErr?.message || seqErr)
    }

    // Preflight: ensure unique index exists for ON CONFLICT upserts
    try {
      await queryDirect(
        pricesHasCycle
          ? `CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item_cycle ON public.branch_item_prices(branch_id, item_id, cycle_id);`
          : `CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item ON public.branch_item_prices(branch_id, item_id);`
      )
    } catch (idxErr) {
      console.warn('Ensure unique index failed:', idxErr?.message || idxErr)
    }
    
    for (const r of rows) {
      const sku = String(r.sku || '').trim().toUpperCase()
      const branch_code = String(r.branch_code || '').trim().toUpperCase()
      const price = Number(String(r.price || '0').replace(/[, ]/g, '')) || 0

      const item_id = itemIdBySku.get(sku)
      const branch_id = branchByCode.get(branch_code)
      if (!item_id || !branch_id) {
        if (!branch_id) unknownBranches.add(branch_code)
        continue
      }
      const row = { branch_id, item_id, price }
      if (pricesHasCycle) row.cycle_id = activeCycle.id
      priceUpserts.push(row)
    }

    // Upsert prices with conflict on (branch_id, item_id) and retry on sequence error
    let pricesAffected = 0
    for (const part of chunk(priceUpserts, 500)) {
      const doUpsertPrices = async () => {
        return await supabase
          .from('branch_item_prices')
          .upsert(part, { onConflict: pricesHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id', ignoreDuplicates: false, count: 'exact' })
      }
      let { error: pErr, count } = await doUpsertPrices()
      if (pErr && String(pErr.message || '').includes('duplicate key value') && String(pErr.message || '').includes('branch_item_prices_pkey')) {
        // Attempt sequence repair then retry once
        try {
          await queryDirect(
            `SELECT setval(pg_get_serial_sequence('public.branch_item_prices','id'), (SELECT COALESCE(MAX(id), 0) FROM public.branch_item_prices));`
          )
        } catch (seqErr) {
          console.warn('Branch item prices sequence repair failed:', seqErr?.message || seqErr)
        }
        const retry = await doUpsertPrices()
        pErr = retry.error
        count = retry.count
      }
      // Fallback: if upsert failed because ON CONFLICT target is missing, do manual select/update/insert
      // inside a transaction + advisory lock to prevent TOCTOU race conditions.
      // Lock key 7101 = arbitrary stable constant for branch_item_prices import.
      if (pErr && String(pErr.message || '').toLowerCase().includes('no unique or exclusion constraint matching the on conflict specification')) {
        console.warn('Upsert fallback to manual update/insert due to missing unique index')
        await transactionalQuery(7101, async (q) => {
          for (const priceData of part) {
            if (pricesHasCycle) {
              const { rows } = await q(
                'SELECT id FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1',
                [priceData.branch_id, priceData.item_id, priceData.cycle_id]
              )
              if (rows.length) {
                await q('UPDATE branch_item_prices SET price = $1 WHERE id = $2', [priceData.price, rows[0].id])
              } else {
                await q(
                  'INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price) VALUES ($1, $2, $3, $4)',
                  [priceData.branch_id, priceData.item_id, priceData.cycle_id, priceData.price]
                )
              }
            } else {
              const { rows } = await q(
                'SELECT id FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 LIMIT 1',
                [priceData.branch_id, priceData.item_id]
              )
              if (rows.length) {
                await q('UPDATE branch_item_prices SET price = $1 WHERE id = $2', [priceData.price, rows[0].id])
              } else {
                await q(
                  'INSERT INTO branch_item_prices (branch_id, item_id, price) VALUES ($1, $2, $3)',
                  [priceData.branch_id, priceData.item_id, priceData.price]
                )
              }
            }
          }
        })
        pricesAffected += part.length
        continue
      }
      if (pErr) {
        console.error('Prices upsert error:', pErr)
        return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })
      }
      pricesAffected += count || part.length
    }
    
    return NextResponse.json({
      ok: true,
      itemsUpserted: itemsAffected,
      priceRowsUpserted: pricesAffected,
      unknownBranches: [...unknownBranches].filter(Boolean)
    })
  } catch (e) {
    console.error('Import prices error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
