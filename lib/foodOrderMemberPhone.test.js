import { describe, expect, it } from 'vitest'
import { attachMemberPhones } from './foodOrderMemberPhone'

function mockSupabase({ phoneRows = [], error = null } = {}) {
  const calls = []
  const supabase = {
    from: (table) => ({
      select: (columns) => ({
        in: async (column, ids) => {
          calls.push({ table, columns, column, ids })
          return {
            data: typeof phoneRows === 'function' ? phoneRows(ids) : phoneRows,
            error,
          }
        },
      }),
    }),
  }
  return { supabase, calls }
}

describe('attachMemberPhones', () => {
  it('maps phones by member id and leaves unknown members blank', async () => {
    const { supabase } = mockSupabase({
      phoneRows: [
        { member_id: 'M1', phone: ' 08030000001 ' },
        { member_id: 3, phone: '08030000003' },
      ],
    })

    const orders = [
      { member_id: 'M1' },
      { member_id: 'M2' },
      { member_id: 3 },
      { member_id: 'M1' },
    ]

    const result = await attachMemberPhones(supabase, orders)

    expect(result.map((o) => o.member_phone)).toEqual([
      '08030000001',
      '',
      '08030000003',
      '08030000001',
    ])
    expect(orders[0]).not.toHaveProperty('member_phone')
  })

  it('splits large exports into bounded member lookups', async () => {
    const { supabase, calls } = mockSupabase({
      phoneRows: (ids) => ids.map((id) => ({ member_id: id, phone: `p-${id}` })),
    })
    const orders = Array.from({ length: 201 }, (_, i) => ({ member_id: `M${i}` }))

    const result = await attachMemberPhones(supabase, orders)

    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.ids.length)).toEqual([200, 1])
    expect(result[200].member_phone).toBe('p-M200')
  })

  it('keeps the report usable when the member lookup fails', async () => {
    const { supabase } = mockSupabase({ error: { message: 'members unavailable' } })

    const result = await attachMemberPhones(supabase, [{ member_id: 'M1' }])

    expect(result[0].member_phone).toBe('')
  })
})
