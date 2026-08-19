'use client'

// app/hooks/useExhibitionCatalog.js
// Catalog fetch for the member exhibition — shared by the shop, the
// all-products page and the vendor hub so the loading/error shape never
// drifts between surfaces.
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function useExhibitionCatalog() {
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!memberId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/exhibition/catalog?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!json?.ok) {
          setError(json?.error || 'Failed to load the exhibition')
          setCatalog(null)
        } else {
          setCatalog(json)
        }
      } catch {
        if (!cancelled) setError('Could not reach the Coop right now. Refresh to retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [memberId])

  return { catalog, error, loading, memberId }
}
