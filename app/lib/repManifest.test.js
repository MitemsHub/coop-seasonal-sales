import { describe, expect, it } from 'vitest'
import { buildManifest } from './repManifest'

const order = {
  order_id: 101,
  member_id: 'CBN-001',
  member_name_snapshot: 'Ada Obi',
  member_phone: '08031234567',
  departments: { name: 'Food' },
  payment_option: 'Cash',
  delivery: { name: 'Awka' },
  order_lines: [
    { qty: 2, unit_price: 500, amount: 1000, items: { name: 'Rice' } },
  ],
}

describe('buildManifest', () => {
  it('includes the member phone on every line', () => {
    const { rows, totalQty, totalAmount } = buildManifest({ orders: [order] })

    expect(rows).toHaveLength(1)
    expect(rows[0].phone).toBe('08031234567')
    expect(totalQty).toBe(2)
    expect(totalAmount).toBe(1000)
  })

  it('allows searching by member phone', () => {
    const { rows } = buildManifest({ orders: [order], search: '08031234567' })

    expect(rows).toHaveLength(1)
  })
})
