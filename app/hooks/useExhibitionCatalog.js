'use client'

// app/hooks/useExhibitionCatalog.js
// Catalog fetch for the member exhibition — shared by the shop, the
// all-products page and the vendor hub so the loading/error shape never
// drifts between surfaces.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function useExhibitionCatalog(branchCode) {
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // The catalogue already resolves a branch server-side (the member's own when
  // none is requested), so remember which code it came back for. The shop's
  // "auto-select the only branch" step sets a branch code right after the first
  // response, and without this the whole catalogue was downloaded a second time
  // for data the page already had.
  const loadedBranchRef = useRef({ code: '' })

  useEffect(() => {
    if (!memberId) return
    if (branchCode && loadedBranchRef.current.code === branchCode) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const qs = new URLSearchParams({ member_id: memberId })
        if (branchCode) qs.set('branch_code', branchCode)
        const res = await fetch(`/api/exhibition/catalog?${qs.toString()}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!json?.ok) {
          setError(json?.error || 'Failed to load the exhibition')
          setCatalog(null)
          loadedBranchRef.current = { code: '' }
        } else {
          setCatalog(json)
          const served = (json.availableBranches || []).find((b) => b && b.name && b.name === json.branch)
          loadedBranchRef.current = { code: served?.code || branchCode || '' }
        }
      } catch {
        if (!cancelled) setError('Could not reach the Coop right now. Refresh to retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [memberId, branchCode])

  return { catalog, error, loading, memberId }
}
