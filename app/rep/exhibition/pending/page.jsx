'use client'

import ProtectedRoute from '../../../components/ProtectedRoute'
import RepExhibitionOrdersContent from '../orders-content'

export default function RepExhibitionPendingPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepExhibitionOrdersContent status="Pending" />
    </ProtectedRoute>
  )
}
