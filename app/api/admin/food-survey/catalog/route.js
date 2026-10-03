// app/api/admin/food-survey/catalog/route.js
// Admin CRUD over the survey item catalog (the list reps see on /survey):
//   GET    → all items (incl. inactive), with per-item submission counts
//   POST   → add an item        { name, category, unit?, sort_order? }
//   PATCH  → edit an item       { id, name?, category?, unit?, sort_order?, active? }
//            or batch reorder    { order: [id, id, …] }  (drag & drop)
//   DELETE ?id= → remove an item (entries keep their snapshot name/category;
//                 catalog_id on entries is set NULL by the FK)
// Middleware enforces the admin session for /api/admin/*.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { supportsUnit } from '@/lib/foodSurveyCatalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

// `unit` only exists after migrations/add-food-survey-unit.sql has run; until
// then the routes below simply drop the column from selects/writes so the
// catalog keeps working (saving a unit answers with a pointer to the file).
const COLUMNS = 'id, name, category, sort_order, active, created_at'
const COLUMNS_WITH_UNIT = 'id, name, category, unit, sort_order, active, created_at'
const ITEM_COLUMNS = 'id, name, category, sort_order, active'
const ITEM_COLUMNS_WITH_UNIT = 'id, name, category, unit, sort_order, active'
const NEEDS_UNIT_MIGRATION =
  'Unit is not set up yet — run migrations/add-food-survey-unit.sql in Supabase, then try again.'

export async function GET() {
  try {
    const supabase = createClient()
    const withUnit = await supportsUnit(supabase)
    const { data, error } = await supabase
      .from('food_survey_catalog')
      .select(withUnit ? COLUMNS_WITH_UNIT : COLUMNS)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error('Catalog list error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to load catalog' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, items: data || [] })
  } catch (e) {
    console.error('Catalog list error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const name = clean(body.name, 255)
    const category = clean(body.category, 100) || 'Other'
    const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : null

    if (name.length < 2) return NextResponse.json({ ok: false, error: 'Enter an item name' }, { status: 400 })

    const supabase = createClient()
    const withUnit = await supportsUnit(supabase)
    const unit = clean(body.unit, 50)
    if (unit && !withUnit) return NextResponse.json({ ok: false, error: NEEDS_UNIT_MIGRATION }, { status: 400 })

    const { data: dupe } = await supabase
      .from('food_survey_catalog')
      .select('id')
      .ilike('name', name.replace(/[%_]/g, '\\$&'))
      .maybeSingle()
    if (dupe) return NextResponse.json({ ok: false, error: `"${name}" is already in the list` }, { status: 409 })

    let sort = sortOrder
    if (sort == null) {
      const { data: maxRow } = await supabase
        .from('food_survey_catalog')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      sort = (Number(maxRow?.sort_order) || 0) + 10
    }

    const { data, error } = await supabase
      .from('food_survey_catalog')
      .insert(withUnit ? { name, category, unit, sort_order: sort } : { name, category, sort_order: sort })
      .select(withUnit ? ITEM_COLUMNS_WITH_UNIT : ITEM_COLUMNS)
      .single()
    if (error) {
      console.error('Catalog insert error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to add item' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, item: data })
  } catch (e) {
    console.error('Catalog add error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    // Batch reorder from the Manage-items drag & drop: rewrite sort_order so
    // the list keeps the exact order the admin dropped it in.
    if (Array.isArray(body.order)) {
      const ids = body.order.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      if (!ids.length) return NextResponse.json({ ok: false, error: 'No items to order' }, { status: 400 })
      const supabase = createClient()
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase
          .from('food_survey_catalog')
          .update({ sort_order: (i + 1) * 10 })
          .eq('id', ids[i])
        if (error) {
          console.error('Catalog reorder error:', error)
          return NextResponse.json({ ok: false, error: 'Failed to save the new order' }, { status: 500 })
        }
      }
      return NextResponse.json({ ok: true, count: ids.length })
    }

    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing item id' }, { status: 400 })
    }

    const supabase = createClient()
    const withUnit = await supportsUnit(supabase)
    const patch = {}
    if (body.name !== undefined) {
      const name = clean(body.name, 255)
      if (name.length < 2) return NextResponse.json({ ok: false, error: 'Enter an item name' }, { status: 400 })
      patch.name = name
    }
    if (body.category !== undefined) {
      const category = clean(body.category, 100)
      if (!category) return NextResponse.json({ ok: false, error: 'Enter a category' }, { status: 400 })
      patch.category = category
    }
    if (body.unit !== undefined) {
      if (!withUnit) return NextResponse.json({ ok: false, error: NEEDS_UNIT_MIGRATION }, { status: 400 })
      patch.unit = clean(body.unit, 50)
    }
    if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0
    if (body.active !== undefined) patch.active = !!body.active
    if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase
      .from('food_survey_catalog')
      .update(patch)
      .eq('id', id)
      .select(withUnit ? ITEM_COLUMNS_WITH_UNIT : ITEM_COLUMNS)
      .maybeSingle()
    if (error) {
      console.error('Catalog update error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to update item' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })
    return NextResponse.json({ ok: true, item: data })
  } catch (e) {
    console.error('Catalog update error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid id' }, { status: 400 })
    }
    const supabase = createClient()
    const { error } = await supabase.from('food_survey_catalog').delete().eq('id', id)
    if (error) {
      console.error('Catalog delete error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to delete item' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Catalog delete error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
