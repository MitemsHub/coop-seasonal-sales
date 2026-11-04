// lib/notifyStandFollowers.js
// Tells everyone following a stand that it has something new. Called when the
// admin approves a product — a vendor's draft is never announced, because
// members cannot see or buy it yet.
//
// Inserted one row at a time: member_notifications dedupes on dedupe_key, and a
// single duplicate inside a batch insert would abort the whole statement.
export async function notifyStandFollowers(supabase, { vendorId, productId, productName, vendorName = '' }) {
  const vid = Math.trunc(Number(vendorId))
  const pid = Math.trunc(Number(productId))
  if (!Number.isFinite(vid) || vid <= 0 || !Number.isFinite(pid) || pid <= 0) return 0

  const { data: follows, error } = await supabase
    .from('exhibition_stand_follows')
    .select('member_id')
    .eq('vendor_id', vid)
  if (error || !follows?.length) return 0

  const title = vendorName ? `${vendorName} listed something new` : 'A stand you follow listed something new'
  const message = `${productName || 'A new product'} is now available at the exhibition.`

  let sent = 0
  for (const f of follows) {
    const memberId = String(f.member_id || '').trim().toUpperCase()
    if (!memberId) continue
    const { error: insErr } = await supabase.from('member_notifications').insert({
      member_id: memberId,
      module: 'exhibition',
      event: 'stand_new_product',
      order_id: `P${pid}`,
      title,
      message,
      dedupe_key: `${memberId}:exhibition:P${pid}:stand_new_product`,
    })
    if (!insErr) sent++
  }
  return sent
}

export default notifyStandFollowers
