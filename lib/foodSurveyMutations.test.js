// lib/foodSurveyMutations.test.js
// Unit tests for replaceEntries — the delete+reinsert path used by admin
// submission edits. Its saved_item_id preservation matters because those
// links are what keep refined outsourced items attached to their rep drafts
// in the Items Import list (otherwise an "item jumps to the last page"
// regression re-appears after any submission edit).

// jsdom has no TextEncoder used by crypto's randomBytes? Actually crypto is
// Node's; but vi.mock partial import needs the real module available. Import
// statically after mocks instead.
vi.mock('./foodSurveyPhotos', () => ({ removeSurveyPhotos: vi.fn().mockResolvedValue(undefined) }))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { replaceEntries } from './foodSurveyMutations'
import { removeSurveyPhotos } from './foodSurveyPhotos'

function makeSupabase({ oldEntries = [], insertErr = null } = {}) {
  const inserts = []
  const deletes = []
  return {
    inserts,
    deletes,
    from(table) {
      if (table !== 'food_survey_entries') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: (_c, _v) => Promise.resolve({ data: oldEntries, error: null }),
        }),
        delete: () => ({
          eq: (_c, _v) => {
            deletes.push(true)
            return Promise.resolve({ error: null })
          },
        }),
        insert: (rows) => {
          inserts.push(rows)
          return Promise.resolve({ error: insertErr })
        },
        selectOther: true,
      }
    },
  }
}

// The photo-cleanup .in('photo_url', ...) select needs a different builder
// shape than the OLD-rows select — distinguish them by the projection string.
function withPhotoProbe(supa) {
  const originalFrom = supa.from.bind(supa)
  supa.from = (table) => {
    const b = originalFrom(table)
    const rowsEq = b.select
    b.select = (cols) => {
      if (String(cols || '').includes('saved_item_id')) return rowsEq.call(b, cols)
      return {
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }
    }
    return b
  }
  return supa
}

beforeEach(() => {
  removeSurveyPhotos.mockClear()
})

describe('replaceEntries — saved_item_id link preservation', () => {
  it('re-attaches old saved_item_id links to the reinserted rows (admin edits must not detach refined items)', async () => {
    const oldEntries = [
      { id: 511, submission_id: 77, item_name: 'Coco pop', photo_url: '/uploads/a.jpg', saved_item_id: 291 },
      { id: 512, submission_id: 77, item_name: 'Noodles', photo_url: '/uploads/b.jpg', saved_item_id: 11 },
    ]
    const supa = makeSupabase({ oldEntries })
    withPhotoProbe(supa)

    const res = await replaceEntries(supa, 77, [
      { item_name: 'Coco pop', price: 2660, photo_url: '/uploads/a.jpg' },
      { item_name: 'Noodles', price: 9900, photo_url: '/uploads/b.jpg' },
    ])

    expect(res.error).toBeUndefined()
    expect(supa.deletes.length).toBe(1)
    expect(supa.inserts.length).toBe(1)
    expect(supa.inserts[0].map((r) => r.saved_item_id)).toEqual([291, 11])
  })

  it('links follow the surviving product when the admin removes an edited-out entry', async () => {
    const oldEntries = [
      { id: 1, submission_id: 9, item_name: 'Coco pop', photo_url: '/uploads/a.jpg', saved_item_id: 291 },
      { id: 2, submission_id: 9, item_name: 'Old item', photo_url: null, saved_item_id: 12 },
    ]
    const supa = makeSupabase({ oldEntries })
    withPhotoProbe(supa)

    // The admin deleted "Old item" and kept only Coco pop.
    const res = await replaceEntries(supa, 9, [{ item_name: 'Coco pop', price: 2660, photo_url: '/uploads/a.jpg' }])

    expect(res.error).toBeUndefined()
    // Coco pop keeps its link (291); the removed entry's link is NOT carried.
    expect(supa.inserts[0].map((r) => r.saved_item_id)).toEqual([291])
  })

  it('still inserts cleanly when no old entry had a link (fresh submissions)', async () => {
    const supa = makeSupabase({ oldEntries: [] })
    withPhotoProbe(supa)

    const res = await replaceEntries(supa, 10, [
      { item_name: 'Tea', price: 500, photo_url: '/uploads/t.jpg' },
      { item_name: 'Bread', price: 1200, photo_url: '/uploads/b.jpg' },
    ])

    expect(res.error).toBeUndefined()
    expect(supa.inserts[0].every((r) => r.saved_item_id == null)).toBe(true)
  })

  it('does not break when the link column does not exist (legacy schema)', async () => {
    // Simulate PostgREST rejecting the saved_item_id projection by making
    // the OLD-rows select swallow that column (undefined) — the preserve
    // pass must still work because it only reads present values.
    const oldEntries = [{ id: 3, submission_id: 12, item_name: 'Tea', photo_url: null }] // no saved_item_id field at all
    const supa = makeSupabase({ oldEntries })
    withPhotoProbe(supa)

    const res = await replaceEntries(supa, 12, [{ item_name: 'Tea', price: 500, photo_url: null }])
    expect(res.error).toBeUndefined()
    // No old link to carry → the insert row gets null (column still written,
    // which is safe for any schema that has it; pre-column schemas simply
    // never call this new select projection).
    expect(supa.inserts[0][0].saved_item_id).toBeNull()
  })
})
