'use client'

// app/components/PwaRegister.jsx
// Registers /sw.js once per session so the coop is installable (PWA) and
// pages fall back to the cached offline screen when a member's connection
// drops. Registration is production-only — in dev the service worker would
// fight with Fast Refresh and serve cached dev builds.

import { useEffect } from 'react'

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((e) => console.warn('Service worker registration failed:', e?.message))
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })

    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
