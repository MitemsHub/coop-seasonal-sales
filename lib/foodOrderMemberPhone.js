// Food reports need the member's phone beside the member name. Orders only
// store the member_id snapshot, so resolve phones in bounded batches to keep
// the PostgREST URL well below its length limit (exports can span 1,000 rows).
const MEMBER_PHONE_CHUNK = 200

export async function attachMemberPhones(supabase, orders = []) {
  const rows = Array.isArray(orders) ? orders : []
  if (!rows.length) return rows

  const ids = Array.from(
    new Set(rows.map((o) => String(o?.member_id ?? '').trim()).filter(Boolean))
  )
  if (!ids.length) return rows.map((o) => ({ ...o, member_phone: '' }))

  const phoneById = new Map()
  for (let i = 0; i < ids.length; i += MEMBER_PHONE_CHUNK) {
    const { data, error } = await supabase
      .from('members')
      .select('member_id,phone')
      .in('member_id', ids.slice(i, i + MEMBER_PHONE_CHUNK))

    // A missing/denied members lookup must not take the whole report down;
    // the row still renders with an empty phone.
    if (error) continue
    for (const member of data || []) {
      phoneById.set(String(member.member_id), String(member.phone || '').trim())
    }
  }

  return rows.map((o) => ({
    ...o,
    member_phone: phoneById.get(String(o?.member_id ?? '').trim()) || '',
  }))
}
