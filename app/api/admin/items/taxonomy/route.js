// app/api/admin/items/taxonomy/route.js
// The category + unit pick lists used across Items Import.
//   GET  → merged lists: everything already in use (items, survey catalog)
//          plus admin-added entries from item_taxonomy, plus the default
//          unit set.
//   POST { kind: 'category' | 'unit', value } → add a list entry (idempotent).
//
// item_taxonomy is created on demand (same lazy-DDL pattern the items API
// uses for items.source), so adding a category works before the migration
// file has been run by hand. Adding an entry only extends the *pick lists*;
// an item only carries the category/unit you save on it, and that save
// writes the shared items row the shop, reports and previews all read.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { queryDirect } from '../../../../../lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ')

const DEFAULT_UNITS = ['Bag', 'Carton', 'Gallon', 'Bucket', 'Crate', 'Piece', 'Kg', 'Log', 'Tin', 'Bale']

const ensureTaxonomyTable = async () => {
  try {
    await queryDirect(
      `CREATE TABLE IF NOT EXISTS public.item_taxonomy (
         kind VARCHAR(10) NOT NULL CHECK (kind IN ('category', 'unit')),
         value TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (kind, value)
       )`
    )
    return true
  } catch (e) {
    console.warn('item_taxonomy ensure skipped:', e?.message || e)
    return false
  }
}

export async function GET() {
  try {
    const supabase = createClient()
    await ensureTaxonomyTable()

    const [{ data: items }, { data: catalog }] = await Promise.all([
      supabase.from('items').select('category'),
      supabase.from('food_survey_catalog').select('name, unit'),
    ])

    let custom = []
    try {
      const { data } = await supabase.from('item_taxonomy').select('kind, value').order('value')
      custom = data || []
    } catch {
      // table missing and DDL failed — the in-use lists still work
    }

    const categories = new Set()
    const units = new Set(DEFAULT_UNITS)
    for (const it of items || []) {
      const c = norm(it.category)
      if (c) categories.add(c)
    }
    for (const c of catalog || []) {
      const n = norm(c.name)
      if (n) categories.add(n)
      const u = norm(c.unit)
      if (u) units.add(u)
    }
    for (const row of custom) {
      ;(row.kind === 'category' ? categories : units).add(norm(row.value))
    }

    return NextResponse.json({
      ok: true,
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
      units: [...units].sort((a, b) => a.localeCompare(b)),
    })
  } catch (e) {
    console.error('Taxonomy GET error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const kind = body.kind === 'category' || body.kind === 'unit' ? body.kind : null
    const value = norm(body.value)
    if (!kind) return NextResponse.json({ ok: false, error: "kind must be 'category' or 'unit'" }, { status: 400 })
    if (value.length < 2 || value.length > 60) {
      return NextResponse.json({ ok: false, error: 'Value must be between 2 and 60 characters' }, { status: 400 })
    }

    const okTable = await ensureTaxonomyTable()
    if (!okTable) return NextResponse.json({ ok: false, error: 'Taxonomy storage is unavailable' }, { status: 500 })

    const { error } = await supabase
      .from('item_taxonomy')
      .upsert({ kind, value }, { onConflict: 'kind,value', ignoreDuplicates: true })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, kind, value })
  } catch (e) {
    console.error('Taxonomy POST error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
