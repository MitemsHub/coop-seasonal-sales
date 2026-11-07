'use client'

import ProtectedRoute from '../components/ProtectedRoute'
import ExhibitionStandInvite from '../components/ExhibitionStandInvite'

// The 2026 exhibition is a counter market: invoices are raised at the stand.
// The online catalogue has been retired, so this page only tells members to
// buy at the stand and confirm their invoice.
export default function ExhibitionPage() {
  return (
    <ProtectedRoute allowedRoles={['member']}>
      <ExhibitionStandInvite />
    </ProtectedRoute>
  )
}
