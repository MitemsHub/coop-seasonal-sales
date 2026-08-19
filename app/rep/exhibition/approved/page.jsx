'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import RepExhibitionOrdersContent from '../orders-content'

export default function RepExhibitionApprovedPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepExhibitionOrdersContent status="Approved" />
    </ProtectedRoute>
  )
}
