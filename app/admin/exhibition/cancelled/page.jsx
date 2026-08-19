'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import ExhibitionOrdersContent from '../orders-content'

export default function ExhibitionCancelledPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionOrdersContent status="Cancelled" />
    </ProtectedRoute>
  )
}
