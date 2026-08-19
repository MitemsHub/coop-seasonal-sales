'use client'

import { useAuth } from '../contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

// Roles whose pages are guarded server-side by an httpOnly cookie (middleware
// page protection + protected APIs). When the localStorage user is missing on
// a cold load — fresh browser context, cleared storage, or after the landing
// page dropped the client state — we re-validate that cookie before redirecting
// away, otherwise a valid admin/rep/vendor/member session would bounce home.
const SESSION_ENDPOINTS = {
  admin: '/api/admin/pin/session',
  rep: '/api/rep/session',
  vendor: '/api/vendor/session',
  member: '/api/members/session',
}

export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user, userType, loading, login } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const redirectRef = useRef(false)
  // One-shot server re-validation when the client user is missing on mount.
  const [serverChecking, setServerChecking] = useState(false)
  const sessionCheckedRef = useRef(false)

  const gateRoles = allowedRoles.filter((r) => SESSION_ENDPOINTS[r])

  useEffect(() => {
    if (loading) return // Wait for auth to load
    if (serverChecking) return // Cookie re-validation in flight

    // Authenticated: enforce the allowed-role gate once.
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

    // No client user: cookie-gated portals re-validate the httpOnly session
    // cookie once on mount (trying each allowed role's endpoint in order) and
    // hydrate the user from the server instead of bouncing to the landing page.
    if (gateRoles.length > 0 && !sessionCheckedRef.current) {
      sessionCheckedRef.current = true
      setServerChecking(true)
      ;(async () => {
        for (const role of gateRoles) {
          try {
            const res = await fetch(SESSION_ENDPOINTS[role], { cache: 'no-store' })
            if (!res.ok) continue
            const json = await res.json()
            if (!json?.ok) continue
            // Member endpoints nest the claims under `member`; admin/rep/vendor
            // return them flat. Read both so the restored user matches a normal
            // login (name + branch fields included, not just the id).
            const memberClaims = json.member && typeof json.member === 'object' ? json.member : {}
            const branchId = json.branch_id ?? memberClaims.branch_id
            const branchCode = json.branch_code ?? memberClaims.branch_code
            const id = json.id || memberClaims.member_id || memberClaims.id || role
            login({
              type: role,
              id,
              authenticated: true,
              ...(json.module ? { module: json.module } : {}),
              ...(branchId != null ? { branchId } : {}),
              ...(branchCode ? { branchCode } : {}),
              ...(memberClaims.name ? { name: memberClaims.name } : {}),
            })
            return
          } catch {
            // try the next role
          }
        }
      })().finally(() => setServerChecking(false))
      return
    }

    // No user and nothing to restore — redirect to home
    if (pathname !== '/') router.replace('/')
  }, [user, userType, loading, serverChecking, gateRoles, login, router, pathname, allowedRoles])

  // Show loading while checking authentication or re-validating the cookie
  if (loading || serverChecking) {
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
