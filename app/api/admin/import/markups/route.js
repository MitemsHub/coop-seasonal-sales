// app/api/admin/import/markups/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { transactionalQuery } from '../../../../../lib/directDb'
import * as XLSX from 'xlsx/xlsx.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const chunk = (arr, size = 500) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const parseBool = (val) => {
  const s = String(val ?? '').trim().toLowerCase()
  if (!s) return true
  if (['true', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'no', 'n', '0'].includes(s)) return false
  return true
}

const hasColumn = async (supabase, table, column) => {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

const resolveCycleId = async (supabase, cycleIdParam) => {
  if (cycleIdParam != null && Number.isFinite(Number(cycleIdParam))) return Number(cycleIdParam)

  let { data: active, error: activeErr } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (activeErr) {
    const msg = String(activeErr?.message || '')
    if (!/is_active/i.test(msg)) throw activeErr
    active = null
  }
  if (active?.id) return active.id

  const { data: latest, error: latestErr } = await supabase.from('cycles').select('id').order('id', { ascending: false }).limit(1).maybeSingle()
  if (latestErr) throw latestErr
  if (!latest?.id) throw new Error('No cycle found')
  return latest.id
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

    // Expected headers:
    // branch_code, cycle_id, sku, amount, active
    if (!rows.length) return NextResponse.json({ ok: false, error: 'No rows found' }, { status: 400 })

    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')
    const formCycleIdParam = formData.get('cycle_id')
    const defaultCycleId = markupsHasCycle ? await resolveCycleId(supabase, formCycleIdParam) : null

    // Fetch branches and items maps
    const { data: branches, error: bErr } = await supabase.from('branches').select('id,code')
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    const branchByCode = new Map((branches || []).map(b => [String(b.code).trim().toUpperCase(), b.id]))

    const { data: itemsAll, error: iErr } = await supabase.from('items').select('item_id,sku')
    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 })
    const itemIdBySku = new Map((itemsAll || []).map(i => [String(i.sku).trim().toUpperCase(), i.item_id]))

    const upserts = []
    const unknownBranches = new Set()
    const missingSkus = new Set()

    for (const r of rows) {
      const branch_code = String(r.branch_code || '').trim().toUpperCase()
      const rowCycleId = markupsHasCycle ? (Number(String(r.cycle_id || '').trim()) || null) : null
      const sku = String(r.sku || '').trim().toUpperCase()
      const amount = Number(String(r.amount || '0').replace(/[, ]/g, '')) || 0
      const active = parseBool(r.active)

      const branch_id = branchByCode.get(branch_code)
      const item_id = itemIdBySku.get(sku)
      if (!branch_id) unknownBranches.add(branch_code)
      if (!item_id) missingSkus.add(sku)
      if (!branch_id || !item_id) continue

      const payload = { branch_id, item_id, amount, active }
      if (markupsHasCycle) payload.cycle_id = rowCycleId || defaultCycleId
      upserts.push(payload)
    }

    let affected = 0
    for (const part of chunk(upserts, 500)) {
      const { error: upErr } = await supabase
        .from('branch_item_markups')
        .upsert(part, { onConflict: markupsHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id' })
      if (upErr && String(upErr.message || '').toLowerCase().includes('no unique or exclusion constraint matching the on conflict specification')) {
        // Fallback: upsert without ON CONFLICT isn't possible via Supabase,
        // so do manual select/update/insert under an advisory lock.
        // Lock key 7102 = arbitrary stable constant for branch_item_markups import.
        await transactionalQuery(7102, async (q) => {
          for (const row of part) {
            if (markupsHasCycle) {
              const { rows } = await q(
                'SELECT id FROM branch_item_markups WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1',
                [row.branch_id, row.item_id, row.cycle_id]
              )
              if (rows.length) {
                await q('UPDATE branch_item_markups SET amount = $1, active = $2 WHERE id = $3', [row.amount, row.active, rows[0].id])
              } else {
                await q(
                  'INSERT INTO branch_item_markups (branch_id, item_id, cycle_id, amount, active) VALUES ($1, $2, $3, $4, $5)',
                  [row.branch_id, row.item_id, row.cycle_id, row.amount, row.active]
                )
              }
            } else {
              const { rows } = await q(
                'SELECT id FROM branch_item_markups WHERE branch_id = $1 AND item_id = $2 LIMIT 1',
                [row.branch_id, row.item_id]
              )
              if (rows.length) {
                await q('UPDATE branch_item_markups SET amount = $1, active = $2 WHERE id = $3', [row.amount, row.active, rows[0].id])
              } else {
                await q(
                  'INSERT INTO branch_item_markups (branch_id, item_id, amount, active) VALUES ($1, $2, $3, $4)',
                  [row.branch_id, row.item_id, row.amount, row.active]
                )
              }
            }
          }
        })
        affected += part.length
        continue
      }
      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
      affected += part.length
    }

    return NextResponse.json({ 
      ok: true, 
      markupsUpserted: affected, 
      unknownBranches: [...unknownBranches].filter(Boolean),
      missingSkus: [...missingSkus].filter(Boolean)
    })
  } catch (e) {
    console.error('Import markups error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
