import { verify } from '@/lib/signingEdge'

// Reads the vendor_token cookie and returns the vendor's context, or null.
// The middleware already guards /api/vendor/* — this is a second, explicit
// check inside each route so handlers can trust the claims below.
export async function getVendorContext(req) {
  const token = req.cookies.get('vendor_token')?.value
  if (!token) return null
  // signingEdge's verify uses Web Crypto (async) — must be awaited.
  const claim = await verify(token)
  if (!claim || claim.role !== 'vendor') return null
  const vendorId = Number(claim.vendor_id)
  const cycleId = Number(claim.cycle_id)
  const branchId = Number(claim.branch_id)
  if (!Number.isFinite(vendorId) || vendorId <= 0) return null
  return {
    vendor_id: vendorId,
    cycle_id: Number.isFinite(cycleId) && cycleId > 0 ? cycleId : null,
    branch_id: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
    vendor_code: String(claim.vendor_code || ''),
  }
}
