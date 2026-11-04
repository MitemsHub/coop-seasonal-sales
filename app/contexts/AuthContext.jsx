'use client'

// app/contexts/AuthContext.jsx
// Auth state management using server-side httpOnly cookies.
// No auth data is stored in localStorage — the server sets/clears httpOnly
// cookies via session endpoints, and this context introspects them on mount.
import { createContext, useContext, useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter } from 'next/navigation'

const AuthContext = createContext()

// Map each role to its session introspection endpoint.
// These endpoints verify the httpOnly cookie and return the session claims.
const SESSION_ENDPOINTS = {
  admin: '/api/admin/pin/session',
  rep: '/api/rep/session',
  vendor: '/api/vendor/session',
  member: '/api/members/session',
}

// Map each role to its session clear endpoint.
const LOGOUT_ENDPOINTS = {
  admin: '/api/admin/pin/session',
  rep: '/api/rep/session',
  vendor: '/api/vendor/session',
  member: '/api/members/session',
}

/**
 * Try to restore the session from the httpOnly cookie by calling each
 * role's introspection endpoint. Returns the user object or null.
 */
async function introspectSession() {
  // Probe every role at once. This used to run sequentially, so every cold
  // load of a protected page paid up to four round trips before the portal
  // could render anything; in parallel it costs one. Priority is preserved by
  // taking the first hit in declaration order (admin → rep → vendor → member).
  const probes = Object.entries(SESSION_ENDPOINTS).map(async ([role, endpoint]) => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store', credentials: 'include' })
      if (!res.ok) return null
      const json = await res.json().catch(() => null)
      if (!json?.ok) return null
      return { role, json }
    } catch {
      // A failed probe just means that role is not signed in.
      return null
    }
  })

  const results = await Promise.all(probes)
  const hit = results.find(Boolean)
  if (!hit) return null

  const { role, json } = hit

  // Admin/rep/vendor return flat claims; member nests them under `member`.
  const memberClaims = json.member && typeof json.member === 'object' ? json.member : {}
  const branchId = json.branch_id ?? memberClaims.branch_id
  const branchCode = json.branch_code ?? memberClaims.branch_code
  const branchName = json.branch_name ?? memberClaims.branch_name
  const department = json.department ?? memberClaims.department
  const id = json.id || memberClaims.member_id || memberClaims.id || role

  return {
    type: role,
    id,
    authenticated: true,
    ...(json.module ? { module: json.module } : {}),
    ...(branchId != null ? { branchId } : {}),
    ...(branchCode ? { branchCode } : {}),
    ...(branchName ? { branchName } : {}),
    // A department rep's scope lives in the httpOnly cookie — without it
    // a reload would silently widen the view back to the whole branch.
    ...(department ? { department } : {}),
    ...(memberClaims.name ? { name: memberClaims.name } : {}),
  }
}

function AuthProviderContent({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // On mount, introspect the httpOnly cookie to restore the session.
  // This replaces the old localStorage.getItem('user') pattern.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // If we're on the home page and not yet authenticated, skip the
      // introspection — it avoids an unnecessary round-trip for guests.
      if (typeof window !== 'undefined' && window.location.pathname === '/') {
        setLoading(false)
        return
      }
      const restored = await introspectSession()
      if (!cancelled) {
        setUser(restored)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /**
   * Login — called after a successful authentication (admin PIN, rep login,
   * member signup/login). The server has already set the httpOnly cookie by
   * this point; we just need to update the client-side state.
   */
  const login = useCallback((userData) => {
    setUser(userData)
    setLoading(false)
  }, [])

  /**
   * Logout — clears the server-side httpOnly cookie and the client state,
   * then redirects to the home page.
   */
  const logout = useCallback(async () => {
    const role = user?.type
    setUser(null)
    setLoading(false)

    // Clear the server-side session cookie
    if (role && LOGOUT_ENDPOINTS[role]) {
      try {
        await fetch(LOGOUT_ENDPOINTS[role], {
          method: 'DELETE',
          credentials: 'include',
        }).catch(() => {})
      } catch {}
    }

    try {
      window.location.replace('/')
    } catch {
      router.replace('/')
    }
  }, [user?.type, router])

  /**
   * Refresh — re-introspects the server session. Useful after actions
   * that might change the session (e.g., password reset).
   */
  const refresh = useCallback(async () => {
    setLoading(true)
    const restored = await introspectSession()
    setUser(restored)
    setLoading(false)
    return restored
  }, [])

  const userType = user?.type || null

  return (
    <AuthContext.Provider value={{ user, userType, login, logout, refresh, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }) {
  return (
    <Suspense fallback={null}>
      <AuthProviderContent>{children}</AuthProviderContent>
    </Suspense>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
