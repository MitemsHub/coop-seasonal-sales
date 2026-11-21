'use client'

// app/hooks/useExhibitionBranch.js
// The member exhibition's delivery location, plus the catalogue for it.
//
// Every exhibition surface is branch-scoped and the choice is remembered per
// member, so the pick, its persistence and the "saved branch no longer exists"
// correction live here instead of being copied into each page. Returns the code
// and name the catalogue actually served, even before the member has picked one.
import { useEffect, useMemo, useState } from 'react'
import useExhibitionCatalog from './useExhibitionCatalog'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'exhibitionDeliveryBranch'

export default function useExhibitionBranch() {
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  const [selectedBranch, setSelectedBranch] = useState(() => {
    try { return localStorage.getItem(`${STORAGE_KEY}_${memberId}`) || '' } catch { return '' }
  })

  const { catalog, error, loading } = useExhibitionCatalog(selectedBranch)
  const availableBranches = useMemo(() => catalog?.availableBranches || [], [catalog])

  // One branch open → pick it once so the member is never asked. A saved pickup
  // location that no longer has stands must not strand the shop on an empty
  // catalogue, so it is replaced by a branch that does.
  useEffect(() => {
    if (!availableBranches.length) return
    if (availableBranches.some((b) => b.code === selectedBranch)) return
    const code = availableBranches[0].code
    setSelectedBranch(code)
    try { localStorage.setItem(`${STORAGE_KEY}_${memberId}`, code) } catch {}
  }, [availableBranches, selectedBranch, memberId])

  const changeBranch = (code) => {
    setSelectedBranch(code)
    try { localStorage.setItem(`${STORAGE_KEY}_${memberId}`, code) } catch {}
  }

  // Show the branch the catalogue actually served, even before the member has
  // picked one, so labels never read empty while the page is already loaded.
  const branchCode =
    availableBranches.find((b) => b.code === selectedBranch)?.code ||
    availableBranches.find((b) => b && b.name === catalog?.branch)?.code ||
    ''
  const branchName =
    availableBranches.find((b) => b.code === branchCode)?.name || catalog?.branch || ''

  return { catalog, error, loading, availableBranches, branchCode, branchName, changeBranch }
}
