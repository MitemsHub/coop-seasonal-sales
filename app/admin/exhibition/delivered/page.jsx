'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import ExhibitionOrdersContent from '../orders-content'

export default function ExhibitionDeliveredPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionOrdersContent status="Delivered" />
    </ProtectedRoute>
  )
}
