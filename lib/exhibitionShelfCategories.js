// lib/exhibitionShelfCategories.js
// The shop's shelves are the only product categories the exhibition uses. A
// fresh cycle used to start with an empty category table, so the vendor and
// admin product forms had nothing to pick from and every listing was classified
// from its name after the fact. Both category endpoints call this first, which
// makes the picker work on any cycle without a manual seed step.
import { SHELVES } from './exhibitionShelf'

// "Other goods" is the fallback shelf, not something a person should choose:
// leaving the picker on Automatic lets the engine decide, and a listing that
// still lands nowhere shows up as Other.
export const SHELF_OPTIONS = SHELVES.filter((shelf) => shelf.key !== 'other').map(
  (shelf, index) => ({
    key: shelf.key,
    label: shelf.label,
    sortOrder: (index + 1) * 10,
  })
)

export async function ensureShelfCategories(supabase, cycleId) {
  const id = Number(cycleId)
  if (!id) return []

  const read = () =>
    supabase
      .from('exhibition_categories')
      .select('id, name, sort_order')
      .eq('cycle_id', id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

  let { data, error } = await read()
  // Module never migrated — nothing to create yet.
  if (error) {
    if (String(error?.code || '') === '42P01') return []
    throw error
  }

  const existing = new Set((data || []).map((row) => String(row.name).trim().toLowerCase()))
  const missing = SHELF_OPTIONS.filter((shelf) => !existing.has(shelf.label.toLowerCase()))
  if (missing.length) {
    const { error: insertError } = await supabase.from('exhibition_categories').insert(
      missing.map((shelf) => ({ cycle_id: id, name: shelf.label, sort_order: shelf.sortOrder }))
    )
    // A parallel request may have inserted them first; that is fine, just read.
    if (insertError && String(insertError.code || '') !== '23505') {
      if (String(insertError.code || '') === '42P01') return []
      throw insertError
    }
    const reread = await read()
    if (reread.error) throw reread.error
    data = reread.data
  }

  return data || []
}
