'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import ExhibitionOrdersContent from '../orders-content'

export default function ExhibitionPendingPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionOrdersContent status="Pending" />
    </ProtectedRoute>
  )
}
