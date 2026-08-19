// app/components/FoodStatusToasts.jsx
'use client'

// Renders nothing. Watches the signed-in member's food orders and fires a
// toast when staff post, deliver, cancel, or restore one of them.
// Mounted in the root layout (inside ToastProvider) so it runs across the
// member area; it no-ops for guests and staff roles.
import { useAuth } from '../contexts/AuthContext'
import useModuleStatusToasts from '../hooks/useModuleStatusToasts'

export default function FoodStatusToasts() {
  const { user } = useAuth()
  const memberId = user?.type === 'member' ? String(user?.id || '').trim().toUpperCase() : ''
  useModuleStatusToasts('food', memberId)
  return null
}
