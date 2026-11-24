// lib/optionalColumn.test.js
// The bulk-removal routes must keep working on a database that is missing
// items.is_active or order_lines.branch_item_price_id; these cover the retry
// rule they both now share.

import { describe, it, expect } from 'vitest'
import {
  insertWithOptionalField,
  isOptionalColumnProblem,
  selectWithOptionalColumn,
} from './optionalColumn'

const missingColumn = (column) => ({
  code: '42703',
  message: `column ${column} does not exist`,
})

describe('isOptionalColumnProblem', () => {
  it('recognises a missing column by code or by name in the message', () => {
    expect(isOptionalColumnProblem(missingColumn('is_active'), 'is_active')).toBe(true)
    expect(isOptionalColumnProblem({ code: 'PGRST204', message: 'nope' }, 'is_active')).toBe(true)
    expect(
      isOptionalColumnProblem({ message: 'Could not find the is_active column' }, 'is_active')
    ).toBe(true)
    expect(isOptionalColumnProblem(null, 'is_active')).toBe(false)
    expect(isOptionalColumnProblem({ code: '42P01', message: 'relation does not exist' }, 'is_active')).toBe(false)
  })
})

describe('selectWithOptionalColumn', () => {
  it('runs the full column list once when the database has the column', async () => {
    const calls = []
    const query = async (cols) => {
      calls.push(cols)
      return { data: [{ item_id: 1, sku: 'RICE50KG', is_active: false }], error: null }
    }
    const res = await selectWithOptionalColumn('item_id, sku, is_active', 'is_active', query)
    expect(calls).toEqual(['item_id, sku, is_active'])
    expect(res.data[0].is_active).toBe(false)
  })

  it('retries once without the missing column', async () => {
    const calls = []
    const query = async (cols) => {
      calls.push(cols)
      if (cols.includes('is_active')) return { data: null, error: missingColumn('is_active') }
      return { data: [{ item_id: 1, sku: 'RICE50KG' }], error: null }
    }
    const res = await selectWithOptionalColumn('item_id, sku, is_active', 'is_active', query)
    expect(calls).toEqual(['item_id, sku, is_active', 'item_id, sku'])
    expect(res.error).toBeNull()
    expect(res.data).toEqual([{ item_id: 1, sku: 'RICE50KG' }])
  })

  it('does not retry for an unrelated failure', async () => {
    const calls = []
    const query = async (cols) => {
      calls.push(cols)
      return { data: null, error: { code: '42P01', message: 'relation "items" does not exist' } }
    }
    const res = await selectWithOptionalColumn('item_id, sku, is_active', 'is_active', query)
    expect(calls).toHaveLength(1)
    expect(res.error.code).toBe('42P01')
  })
})

describe('insertWithOptionalField', () => {
  const row = { id: 1, order_id: 10, item_id: 1, branch_item_price_id: 700, qty: 7, amount: 1000 }

  it('inserts the row as-is when the reference is still valid', async () => {
    const sent = []
    const res = await insertWithOptionalField(row, 'branch_item_price_id', async (r) => {
      sent.push(r)
      return { error: null }
    })
    expect(res.error).toBeNull()
    expect(sent).toEqual([row])
  })

  it('retries without the field when its row was replaced (23503)', async () => {
    const sent = []
    const res = await insertWithOptionalField(row, 'branch_item_price_id', async (r) => {
      sent.push(r)
      return 'branch_item_price_id' in r
        ? { error: { code: '23503', message: 'violates foreign key constraint' } }
        : { error: null }
    })
    expect(res.error).toBeNull()
    expect(sent).toHaveLength(2)
    expect(sent[1]).not.toHaveProperty('branch_item_price_id')
    expect(sent[1]).toMatchObject({ id: 1, order_id: 10, qty: 7, amount: 1000 })
  })

  it('retries when the column itself is missing', async () => {
    const sent = []
    await insertWithOptionalField(row, 'branch_item_price_id', async (r) => {
      sent.push(r)
      return 'branch_item_price_id' in r ? { error: missingColumn('branch_item_price_id') } : { error: null }
    })
    expect(sent[1]).not.toHaveProperty('branch_item_price_id')
  })

  it('leaves other failures and rows without the field alone', async () => {
    const sent = []
    const dup = await insertWithOptionalField(row, 'branch_item_price_id', async (r) => {
      sent.push(r)
      return { error: { code: '23505', message: 'duplicate key value' } }
    })
    expect(dup.error.code).toBe('23505')
    expect(sent).toHaveLength(1)

    const noField = await insertWithOptionalField({ id: 2 }, 'branch_item_price_id', async (r) => {
      sent.push(r)
      return { error: missingColumn('branch_item_price_id') }
    })
    expect(noField.error.code).toBe('42703')
    expect(sent).toHaveLength(2)
  })
})
