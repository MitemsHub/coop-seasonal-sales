'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../contexts/AuthContext'
import ProtectedRoute from '../../components/ProtectedRoute'

function RepPendingRedirect() {
  const router = useRouter()
  const { user } = useAuth()

  useEffect(() => {
    if (user?.type !== 'rep' || !user?.authenticated) return
    router.replace('/rep/posted')
  }, [router, user])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="ui-card p-4">
        <div className="text-sm text-muted">Redirecting…</div>
      </div>
    </div>
  )
}

export default function RepPendingPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepPendingRedirect />
    </ProtectedRoute>
  )
}

