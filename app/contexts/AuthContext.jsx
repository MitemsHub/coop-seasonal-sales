'use client'

import { createContext, useContext, useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

const AuthContext = createContext()

function AuthProviderContent({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    // Only check for stored user data, don't auto-authenticate based on URL params
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      try {
        const userData = JSON.parse(storedUser)
        // Clear admin/rep authentication when on home page
        if (window.location.pathname === '/' && (userData.type === 'admin' || userData.type === 'rep')) {
          localStorage.removeItem('user')
          setUser(null)
        } else {
          setUser(userData)
        }
      } catch (e) {
        localStorage.removeItem('user')
      }
    }
    setLoading(false)
  }, [searchParams])

  const login = (userData) => {
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
    setLoading(false)
  }

  const logout = async () => {
    const currentUserType = user?.type
    setUser(null)
    localStorage.removeItem('user')
    setLoading(false)

    try {
      if (currentUserType === 'admin') {
        await fetch('/api/admin/pin/session', { method: 'DELETE', credentials: 'include' }).catch(() => null)
      } else if (currentUserType === 'rep') {
        await fetch('/api/rep/session', { method: 'DELETE', credentials: 'include' }).catch(() => null)
      } else if (currentUserType === 'member') {
        await fetch('/api/members/session', { method: 'DELETE', credentials: 'include' }).catch(() => null)
      }
    } catch {}

    try {
      window.location.replace('/')
    } catch {
      router.replace('/')
    }
  }

  const userType = user?.type || null

  return (
    <AuthContext.Provider value={{ user, userType, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
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
