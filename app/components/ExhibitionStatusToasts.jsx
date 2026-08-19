// app/components/ExhibitionStatusToasts.jsx
'use client'

// Renders nothing. Watches the signed-in member's exhibition orders and fires
// a toast when a rep or admin approves, cancels, or restores one of them.
// Mounted in the root layout (inside ToastProvider) so it runs across the
// member area; it no-ops for guests and staff roles.
import { useAuth } from '../contexts/AuthContext'
import useModuleStatusToasts from '../hooks/useModuleStatusToasts'

export default function ExhibitionStatusToasts() {
  const { user } = useAuth()
  const memberId = user?.type === 'member' ? String(user?.id || '').trim().toUpperCase() : ''
  useModuleStatusToasts('exhibition', memberId)
  return null
}
