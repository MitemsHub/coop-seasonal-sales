'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import ExhibitionOrdersContent from '../orders-content'

export default function ExhibitionApprovedPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionOrdersContent status="Approved" />
    </ProtectedRoute>
  )
}
