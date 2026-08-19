'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import RepExhibitionOrdersContent from '../orders-content'

export default function RepExhibitionCancelledPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepExhibitionOrdersContent status="Cancelled" />
    </ProtectedRoute>
  )
}
