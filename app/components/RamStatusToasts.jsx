// app/components/RamStatusToasts.jsx
'use client'

// Renders nothing. Watches the signed-in member's ram orders and fires a
// toast when staff approve, cancel, restore, or deliver one of them (and
// records the event into the member notifications inbox).
// Mounted in the root layout (inside ToastProvider) so it runs across the
// member area; it no-ops for guests and staff roles.
import { useAuth } from '../contexts/AuthContext'
import useModuleStatusToasts from '../hooks/useModuleStatusToasts'

export default function RamStatusToasts() {
  const { user } = useAuth()
  const memberId = user?.type === 'member' ? String(user?.id || '').trim().toUpperCase() : ''
  useModuleStatusToasts('ram', memberId)
  return null
}
