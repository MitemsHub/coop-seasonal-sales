'use client'

// app/components/ProtectedRoute.jsx
// Page-level auth gate. Checks the AuthContext (which derives its state from
// server-side httpOnly cookies) and redirects unauthorized users.
import { useAuth } from '../contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user, userType, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const redirectRef = useRef(false)

  useEffect(() => {
    if (loading) return // Wait for auth to load from cookie introspection

    // Authenticated but wrong role — redirect to the appropriate portal
    if (user && user.authenticated) {
      if (allowedRoles.length > 0 && !allowedRoles.includes(userType)) {
        if (redirectRef.current) return
        redirectRef.current = true

        let dest = '/'
        switch (userType) {
          case 'member':
            dest = '/shop'
            break
          case 'rep':
            dest = '/rep/pending'
            break
          case 'admin':
            dest = '/admin/food/pending'
            break
          default:
            dest = '/'
        }

        if (dest !== pathname) router.replace(dest)
      }
      return
    }

    // Not authenticated — redirect to home
    // (The middleware already handles server-side protection for protected routes,
    // so this is a client-side fallback for pages that use this wrapper.)
    if (!loading && !user) {
      if (pathname !== '/') router.replace('/')
    }
  }, [user, userType, loading, router, pathname, allowedRoles])

  // Show loading while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="w-full max-w-sm bg-surface rounded-2xl shadow-xl border border-line-subtle px-6 py-6"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-600 flex items-center justify-center shadow-md">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-fg">Loading</div>
              <div className="text-xs text-muted">Preparing your session…</div>
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  // Don't render children if user is not authenticated or doesn't have permission
  if (!user || !user.authenticated || (allowedRoles.length > 0 && !allowedRoles.includes(userType))) {
    return null
  }

  return children
}
