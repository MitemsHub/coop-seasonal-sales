// lib/itemOverrides.test.js
// Branch-owned display fields for OUTSOURCED items: the helpers must keep
// branches independent — editing Coop Secretariat's card must never rewrite
// Abuja/Head Office's card.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./directDb', () => ({ queryDirect: vi.fn() }))
import { queryDirect } from './directDb'
import {
  ensureOverrideTable,
  loadOverrides,
  coalesceItem,
  snapshotItemForOtherBranches,
  writeOverride,
} from './itemOverrides'

const SHARED = { name: 'Indomitables Noodles', category: 'Instant foods', unit: 'Carton', image_url: 'a.png', price: 9500 }

beforeEach(() => {
  queryDirect.mockReset()
  queryDirect.mockResolvedValue({ rows: [], rowCount: 0 })
})

afterEach(() => {
  // force ensureOverrideTable to re-run (it lazily caches across tests)
  vi.resetModules()
})

describe('coalesceItem — branch override wins field by field', () => {
  it('uses the branch override where it is set', () => {
    const merged = coalesceItem(
      { ...SHARED },
      { name: 'Branch name', category: 'Branch cat', unit: 'Branch unit', image_url: 'b.png' }
    )
    expect(merged.name).toBe('Branch name')
    expect(merged.category).toBe('Branch cat')
    expect(merged.unit).toBe('Branch unit')
    expect(merged.image_url).toBe('b.png')
    // non-display fields untouched
    expect(merged.price).toBe(SHARED.price)
  })

  it('falls back to the shared copy where the override is null', () => {
    const merged = coalesceItem({ ...SHARED }, { name: null, category: null, unit: null, image_url: null })
    expect(merged.name).toBe(SHARED.name)
    expect(merged.category).toBe(SHARED.category)
    expect(merged.unit).toBe(SHARED.unit)
    expect(merged.image_url).toBe(SHARED.image_url)
  })

  it('treats a blanked category/unit as a deliberate clerical clear', () => {
    const merged = coalesceItem({ ...SHARED }, { category: '', unit: '' })
    expect(merged.category).toBe('')
    expect(merged.unit).toBe('')
    // name never renders empty
    expect(merged.name).toBe(SHARED.name)
  })

  it('returns the shared row when there is no override', () => {
    expect(coalesceItem({ ...SHARED }, null)).toEqual(SHARED)
    expect(coalesceItem(null, null)).toBeNull()
  })
})

describe('loadOverrides — resilient reads', () => {
  it('maps rows by branch::item', async () => {
    queryDirect.mockResolvedValue({
      rows: [
        { branch_id: '7', item_id: '23', name: 'B', category: 'C', unit: 'U', image_url: 'i.png' },
      ],
    })
    const map = await loadOverrides([23, 24])
    expect(queryDirect).toHaveBeenCalledWith(
      expect.stringContaining('FROM public.item_branch_overrides'),
      [[23, 24]]
    )
    expect(map.get('7::23')).toEqual({ name: 'B', category: 'C', unit: 'U', image_url: 'i.png' })
    expect(map.get('7::24')).toBeUndefined()
  })

  it('returns an empty map when the table does not exist yet', async () => {
    queryDirect.mockRejectedValue(new Error('relation "item_branch_overrides" does not exist'))
    const map = await loadOverrides([1])
    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(0)
  })

  it('returns an empty map for empty/invalid ids without querying', async () => {
    const map = await loadOverrides([0, 'x', null])
    expect(map.size).toBe(0)
    expect(queryDirect).not.toHaveBeenCalled()
  })
})

describe('snapshotItemForOtherBranches — freeze the other branches before an edit', () => {
  it('freezes every branch that prices the item EXCEPT the branch being edited', async () => {
    await ensureOverrideTable()
    const ok = await snapshotItemForOtherBranches(23, 7, { name: 'N', category: 'C', unit: 'U', image_url: 'i.png' })
    expect(ok).toBe(true)
    const insertCall = queryDirect.mock.calls.find(
      ([sql]) => sql.includes('FROM public.branch_item_prices') && sql.includes('ON CONFLICT (branch_id, item_id) DO NOTHING')
    )
    expect(insertCall).toBeTruthy()
    // $6 binds the excluded branch → branch 7 keeps its own copy while
    // every OTHER branch is pinned to the current shared copy.
    expect(insertCall[1]).toEqual([23, 'N', 'C', 'U', 'i.png', 7])
  })

  it('never fails the save when its own writes are fine but the freeze was off', async () => {
    // ensureOverrideTable may already be warm (cached); the write itself is
    // what must go through regardless.
    const ok = await snapshotItemForOtherBranches(23, null, { name: 'N' })
    expect(ok).toBe(true)
    expect(queryDirect.mock.calls.some(([sql]) => sql.includes('FROM public.branch_item_prices'))).toBe(true)
  })

  it('swallows DDL problems instead of failing the save', async () => {
    queryDirect.mockRejectedValue(new Error('permission denied'))
    await expect(snapshotItemForOtherBranches(23, 7, { name: 'N' })).resolves.toBe(false)
  })
})

describe('writeOverride — patch semantics', () => {
  it('upserts the branch copy, updating only supplied fields', async () => {
    await writeOverride({ branchId: 7, itemId: 23, name: 'New', unit: 'Sachet' })
    const call = queryDirect.mock.calls.find(([sql]) => sql.includes('ON CONFLICT (branch_id, item_id) DO UPDATE'))
    expect(call).toBeTruthy()
    // name, unit supplied; category/image_url null → the SQL keeps the stored
    // value (CASE ... IS NULL THEN keep ELSE EXCLUDED).
    expect(call[1]).toEqual([7, 23, 'New', null, 'Sachet', null])
  })

  it('writes an empty category verbatim (deliberate clear), not null', async () => {
    await writeOverride({ branchId: 7, itemId: 23, name: 'New', category: '' })
    const call = queryDirect.mock.calls.find(([sql]) => sql.includes('ON CONFLICT (branch_id, item_id) DO UPDATE'))
    expect(call[1][3]).toBe('')
  })

  it('swallows write errors and reports failure', async () => {
    queryDirect.mockRejectedValue(new Error('conn failed'))
    await expect(writeOverride({ branchId: 7, itemId: 23 })).resolves.toBe(false)
  })
})
