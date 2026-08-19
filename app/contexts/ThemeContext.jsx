'use client'

// app/contexts/ThemeContext.jsx
// Sakani-style light/dark theming — toggles the `.dark` class on <html>.
// The preference is persisted PER ROLE under `theme:<role>` in localStorage,
// so an admin, a rep, a member and a guest each keep their own light/dark choice.
// A legacy single `theme` key is honored for the first read and then retired.
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'

const ThemeContext = createContext(null)

const LEGACY_KEY = 'theme'
const ROLES = ['admin', 'rep', 'member']

// Role of the signed-in user at this instant.
// On the very first render (before AuthContext restores the session from
// the httpOnly cookie), fall back to 'guest'. The ThemeProvider's follow
// effect will update the role once AuthContext loads.
function getStoredRole() {
  return 'guest'
}

function roleKey(role) {
  return `theme:${role || 'guest'}`
}

// Read-only lookup: the per-role key first, then the legacy single key.
function readThemeFor(role) {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(roleKey(role))
    if (stored === 'dark' || stored === 'light') return stored
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy === 'dark' || legacy === 'light') return legacy
  } catch {}
  return null
}

function resolveTheme(saved) {
  if (saved === 'dark' || saved === 'light') return saved
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function ThemeProvider({ children }) {
  const { userType, loading } = useAuth()
  // Neutral defaults for the first render so the server and the first client
  // render agree (reading localStorage in a useState initializer would cause a
  // hydration mismatch whenever the stored theme differs from the default).
  // The persisted preference is hydrated in a mount effect below, and the
  // apply/persist effect is gated on `hydrated` so the .dark class set by the
  // head script before first paint is never torn down in between.
  const [theme, setTheme] = useState('light')
  const [role, setRole] = useState('guest')
  const [hydrated, setHydrated] = useState(false)

  // Hydrate the persisted theme + role after mount.
  // Use a best-effort read from localStorage for the role hint (set by the
  // inline script in layout.jsx before React hydrates). Once AuthContext
  // loads, the follow effect below will override this.
  useEffect(() => {
    let r = 'guest'
    try {
      const raw = window.localStorage.getItem('user')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && ROLES.includes(parsed.type)) r = parsed.type
      }
    } catch {}
    setRole(r)
    setTheme(resolveTheme(readThemeFor(r)))
    setHydrated(true)
  }, [])

  // Follow the active role: once auth has restored the session (loading=false),
  // load that role's saved theme whenever the role actually changes. Roles with
  // no saved preference simply keep the theme that is currently on screen.
  useEffect(() => {
    if (loading) return
    const next = userType || 'guest'
    if (next === role) return
    setRole(next)
    setTheme((current) => readThemeFor(next) || current)
  }, [loading, userType, role])

  // Apply the theme to <html> and persist it under the active role's key.
  useEffect(() => {
    if (!hydrated) return
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    try {
      window.localStorage.setItem(roleKey(role), theme)
    } catch {}
  }, [theme, role, hydrated])

  // One-time migration: the legacy 'theme' key has now been adopted by the
  // active role (see readThemeFor + the save effect above), so retire it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(LEGACY_KEY)
    } catch {}
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
