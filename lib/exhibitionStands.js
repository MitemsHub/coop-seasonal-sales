// lib/exhibitionStands.js
// Stand helpers shared by the member exhibition home and the stands directory:
// the same "which stands have something to sell" rule, product counts and
// name/address search, so the two lists can never disagree.

export function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return 'ST'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

export function countVendorProducts(products = []) {
  const map = {}
  for (const p of products) map[p.vendor_id] = (map[p.vendor_id] || 0) + 1
  return map
}

export function standsWithProducts(vendors = [], products = []) {
  const ids = new Set(products.map((p) => p.vendor_id))
  return vendors.filter((v) => ids.has(v.id))
}

export function searchStands(stands = [], query = '') {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return stands
  return stands.filter(
    (v) =>
      String(v.name || '').toLowerCase().includes(q) ||
      String(v.address || '').toLowerCase().includes(q)
  )
}
