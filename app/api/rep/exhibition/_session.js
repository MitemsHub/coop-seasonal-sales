// app/api/rep/exhibition/_session.js
// Shared auth for rep exhibition routes — the rep_token must be a valid rep
// with a branch_id claim (exhibition is branch-scoped like Food Distribution).
import { verify } from '@/lib/signing'

export function getRepBranch(request) {
  const token = request.cookies.get('rep_token')?.value
  const claim = token && verify(token)
  if (!claim || claim.role !== 'rep') return { ok: false, status: 401, error: 'unauthorized' }
  const branchId = Math.trunc(Number(claim.branch_id))
  if (!Number.isFinite(branchId) || branchId <= 0) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true, branchId, claim }
}
