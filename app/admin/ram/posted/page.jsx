'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute from '../../../components/ProtectedRoute'
export default function RamPostedPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/ram/pending')
  }, [router])

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-6 text-sm text-muted">Redirecting…</div>
    </ProtectedRoute>
  )
}
