'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import ExhibitionOrdersContent from '../orders-content'

export default function ExhibitionConfirmedPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionOrdersContent status="Confirmed" />
    </ProtectedRoute>
  )
}
