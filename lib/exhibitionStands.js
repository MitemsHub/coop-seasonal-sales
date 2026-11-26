// lib/exhibitionStands.js
// Stand helpers shared by the member exhibition home and the stands directory:
// the same "which stands have something to sell" rule, product counts and
// search, so the two lists can never disagree.
import { shelfSummaryForVendor } from './exhibitionShelf'
import { vendorDeclared } from './exhibitionVendorCategories'

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

// A member searching "solar" or "fashion" is looking for what a stand sells,
// not only for its business name — so the stand's declared category, the
// shelves inferred from its products, its hall and its address all count.
export function searchStands(stands = [], query = '', products = []) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return stands
  const byVendor = new Map()
  for (const p of products) {
    const id = Number(p.vendor_id)
    if (!byVendor.has(id)) byVendor.set(id, [])
    byVendor.get(id).push(p)
  }
  return stands.filter((v) => {
    const inferred = shelfSummaryForVendor(v, byVendor.get(Number(v.id)) || []).map((s) => s.label)
    const hay = [
      v.name,
      vendorDeclared(v.name) || v.category || '',
      inferred.join(' '),
      v.address,
      v.hall,
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
