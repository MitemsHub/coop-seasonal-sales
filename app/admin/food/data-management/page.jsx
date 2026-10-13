'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DatabaseMigration from '../../../components/DatabaseMigration'
import Button from '../../../components/ui/Button'
import Link from 'next/link'
import { Archive, Link2 } from 'lucide-react'

function DataManagementPageContent() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmClearAll, setConfirmClearAll] = useState('')
  const [confirmClearDelivered, setConfirmClearDelivered] = useState('')
  const [confirmResetInventory, setConfirmResetInventory] = useState('')
  const [processingAction, setProcessingAction] = useState(null)
  const router = useRouter()

  const [cycles, setCycles] = useState([])
  const [loadingCycles, setLoadingCycles] = useState(false)
  const [activeCycleId, setActiveCycleId] = useState(null)
  const [selectedCycleId, setSelectedCycleId] = useState(null)

  const [newCycleCode, setNewCycleCode] = useState('')
  const [newCycleName, setNewCycleName] = useState('')
  const [newCycleStartsAt, setNewCycleStartsAt] = useState('')
  const [newCycleEndsAt, setNewCycleEndsAt] = useState('')
  const [newCycleMakeActive, setNewCycleMakeActive] = useState(true)
  const [newCycleSurveyOpen, setNewCycleSurveyOpen] = useState(false)
  const [creatingCycle, setCreatingCycle] = useState(false)
  const [activatingCycle, setActivatingCycle] = useState(false)
  const [togglingSurvey, setTogglingSurvey] = useState(false)

  const [editingCycle, setEditingCycle] = useState(false)
  const [editCycleCode, setEditCycleCode] = useState('')
  const [editCycleName, setEditCycleName] = useState('')
  const [editCycleStartsAt, setEditCycleStartsAt] = useState('')
  const [editCycleEndsAt, setEditCycleEndsAt] = useState('')
  const [savingCycleEdit, setSavingCycleEdit] = useState(false)

  const [policyLoading, setPolicyLoading] = useState(false)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyMsg, setPolicyMsg] = useState('')
  const [eligibleLoanMaxPensioner, setEligibleLoanMaxPensioner] = useState('')
  const [eligibleLoanMaxRetiree, setEligibleLoanMaxRetiree] = useState('')
  const [eligibleLoanMaxActive, setEligibleLoanMaxActive] = useState('')
  const [graceLoanMaxPensioner, setGraceLoanMaxPensioner] = useState('')
  const [graceLoanMaxRetiree, setGraceLoanMaxRetiree] = useState('')
  const [graceLoanMaxActive, setGraceLoanMaxActive] = useState('')
  const [includeInterestInCap, setIncludeInterestInCap] = useState(true)
  const [loanInterestRatePct, setLoanInterestRatePct] = useState('0')
  const [loanRateSaving, setLoanRateSaving] = useState(false)
  const [limitsEditing, setLimitsEditing] = useState(false)
  const [rateEditing, setRateEditing] = useState(false)

  const loadCycles = async () => {
    try {
      setLoadingCycles(true)
      const res = await fetch('/api/admin/cycles', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load cycles')
      setCycles(json.cycles || [])
      setActiveCycleId(json.active_cycle_id ?? null)
      setSelectedCycleId(prev => {
        if (prev != null) return prev
        if (json.active_cycle_id != null) return json.active_cycle_id
        if ((json.cycles || []).length > 0) return json.cycles[0].id
        return null
      })
    } catch (e) {
      setMessage(`Error: ${e.message}`)
    } finally {
      setLoadingCycles(false)
    }
  }

  useEffect(() => {
    loadCycles()
  }, [])

  const loadFoodCyclePolicy = async (cycleId) => {
    if (cycleId == null) return
    setPolicyLoading(true)
    setPolicyMsg('')
    try {
      const qs = new URLSearchParams({ cycle_id: String(cycleId) })
      const res = await fetch(`/api/admin/food/cycle-policy?${qs.toString()}`, { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load policy')
      const p = json.policy || {}
      setEligibleLoanMaxPensioner(String(Number(p?.eligible?.pensioner || 0)))
      setEligibleLoanMaxRetiree(String(Number(p?.eligible?.retiree || 0)))
      setEligibleLoanMaxActive(String(Number(p?.eligible?.active || 0)))
      setGraceLoanMaxPensioner(String(Number(p?.grace?.pensioner || 0)))
      setGraceLoanMaxRetiree(String(Number(p?.grace?.retiree || 0)))
      setGraceLoanMaxActive(String(Number(p?.grace?.active || 0)))
      setIncludeInterestInCap(p?.include_interest_in_cap !== false)
      setLoanInterestRatePct(String(Number(p?.loan_interest_rate_pct || 0)))
      setLimitsEditing(false)
      setRateEditing(false)
    } catch (e) {
      setPolicyMsg(`Error: ${e.message}`)
      setEligibleLoanMaxPensioner('0')
      setEligibleLoanMaxRetiree('0')
      setEligibleLoanMaxActive('0')
      setGraceLoanMaxPensioner('0')
      setGraceLoanMaxRetiree('0')
      setGraceLoanMaxActive('0')
      setIncludeInterestInCap(true)
      setLoanInterestRatePct('0')
      setLimitsEditing(false)
      setRateEditing(false)
    } finally {
      setPolicyLoading(false)
    }
  }

  useEffect(() => {
    if (selectedCycleId == null) return
    setLimitsEditing(false)
    setRateEditing(false)
    loadFoodCyclePolicy(selectedCycleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycleId])

  const saveFoodCyclePolicy = async () => {
    if (selectedCycleId == null) return
    if (policySaving) return
    setPolicySaving(true)
    setPolicyMsg('')
    try {
      const eP = eligibleLoanMaxPensioner === '' ? 0 : Number(eligibleLoanMaxPensioner)
      const eR = eligibleLoanMaxRetiree === '' ? 0 : Number(eligibleLoanMaxRetiree)
      const eA = eligibleLoanMaxActive === '' ? 0 : Number(eligibleLoanMaxActive)
      const gP = graceLoanMaxPensioner === '' ? 0 : Number(graceLoanMaxPensioner)
      const gR = graceLoanMaxRetiree === '' ? 0 : Number(graceLoanMaxRetiree)
      const gA = graceLoanMaxActive === '' ? 0 : Number(graceLoanMaxActive)
      const nums = [eP, eR, eA, gP, gR, gA]
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('All limits must be non-negative numbers')
      const rPct = loanInterestRatePct === '' ? 0 : Number(loanInterestRatePct)
      if (!Number.isFinite(rPct) || rPct < 0) throw new Error('Loan rate must be a non-negative number')

      const res = await fetch('/api/admin/food/cycle-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          cycle_id: selectedCycleId,
          eligible: { pensioner: Math.trunc(eP), retiree: Math.trunc(eR), active: Math.trunc(eA) },
          grace: { pensioner: Math.trunc(gP), retiree: Math.trunc(gR), active: Math.trunc(gA) },
          include_interest_in_cap: !!includeInterestInCap,
          loan_interest_rate_pct: rPct,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save policy')
      setPolicyMsg('Food cycle policy saved successfully')
      const p = json.policy || {}
      setEligibleLoanMaxPensioner(String(Number(p?.eligible?.pensioner || 0)))
      setEligibleLoanMaxRetiree(String(Number(p?.eligible?.retiree || 0)))
      setEligibleLoanMaxActive(String(Number(p?.eligible?.active || 0)))
      setGraceLoanMaxPensioner(String(Number(p?.grace?.pensioner || 0)))
      setGraceLoanMaxRetiree(String(Number(p?.grace?.retiree || 0)))
      setGraceLoanMaxActive(String(Number(p?.grace?.active || 0)))
      setIncludeInterestInCap(p?.include_interest_in_cap !== false)
      setLoanInterestRatePct(String(Number(p?.loan_interest_rate_pct || 0)))
      setLimitsEditing(false)
      return true
    } catch (e) {
      setPolicyMsg(`Error: ${e.message}`)
      return false
    } finally {
      setPolicySaving(false)
    }
  }

  const saveFoodLoanRate = async () => {
    if (selectedCycleId == null) return
    if (loanRateSaving || policySaving) return
    setLoanRateSaving(true)
    setPolicyMsg('')
    try {
      const eP = eligibleLoanMaxPensioner === '' ? 0 : Number(eligibleLoanMaxPensioner)
      const eR = eligibleLoanMaxRetiree === '' ? 0 : Number(eligibleLoanMaxRetiree)
      const eA = eligibleLoanMaxActive === '' ? 0 : Number(eligibleLoanMaxActive)
      const gP = graceLoanMaxPensioner === '' ? 0 : Number(graceLoanMaxPensioner)
      const gR = graceLoanMaxRetiree === '' ? 0 : Number(graceLoanMaxRetiree)
      const gA = graceLoanMaxActive === '' ? 0 : Number(graceLoanMaxActive)
      const nums = [eP, eR, eA, gP, gR, gA]
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('All limits must be non-negative numbers')

      const rPct = loanInterestRatePct === '' ? 0 : Number(loanInterestRatePct)
      if (!Number.isFinite(rPct) || rPct < 0) throw new Error('Loan rate must be a non-negative number')

      const res = await fetch('/api/admin/food/cycle-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          cycle_id: selectedCycleId,
          eligible: { pensioner: Math.trunc(eP), retiree: Math.trunc(eR), active: Math.trunc(eA) },
          grace: { pensioner: Math.trunc(gP), retiree: Math.trunc(gR), active: Math.trunc(gA) },
          include_interest_in_cap: !!includeInterestInCap,
          loan_interest_rate_pct: rPct,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save loan rate')
      setPolicyMsg('Food loan interest rate saved successfully')
      const p = json.policy || {}
      setLoanInterestRatePct(String(Number(p?.loan_interest_rate_pct || 0)))
      setRateEditing(false)
      return true
    } catch (e) {
      setPolicyMsg(`Error: ${e.message}`)
      return false
    } finally {
      setLoanRateSaving(false)
    }
  }

  const createCycle = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (creatingCycle) return
    setCreatingCycle(true)
    setMessage('')
    try {
      const payload = {
        code: newCycleCode.trim(),
        name: newCycleName.trim(),
        make_active: !!newCycleMakeActive
      }
      if (newCycleSurveyOpen) payload.survey_open = true
      if (newCycleStartsAt) payload.starts_at = newCycleStartsAt
      if (newCycleEndsAt) payload.ends_at = newCycleEndsAt

      const res = await fetch('/api/admin/cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to create cycle')
      setMessage(`Cycle created: ${json.cycle?.name || json.cycle?.code || 'New cycle'}`)
      setNewCycleCode('')
      setNewCycleName('')
      setNewCycleStartsAt('')
      setNewCycleEndsAt('')
      setNewCycleSurveyOpen(false)
      await loadCycles()
      if (json.active_cycle_id != null) setSelectedCycleId(json.active_cycle_id)
      if (json.active_cycle_id != null) loadFoodCyclePolicy(json.active_cycle_id)
    } catch (e2) {
      setMessage(`Error: ${e2.message}`)
    } finally {
      setCreatingCycle(false)
    }
  }

  const setActiveCycle = async () => {
    if (activatingCycle) return
    if (selectedCycleId == null) return
    setActivatingCycle(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/cycles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: selectedCycleId })
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to set active cycle')
      setMessage('Active cycle updated successfully')
      await loadCycles()
      if (selectedCycleId != null) loadFoodCyclePolicy(selectedCycleId)
    } catch (e) {
      setMessage(`Error: ${e.message}`)
    } finally {
      setActivatingCycle(false)
    }
  }

  // Open/close the item survey (/survey) for the selected cycle. Opening one
  // cycle closes the survey for all the others; the cycle's end date (if any)
  // still auto-closes it in code.
  const toggleSurveyOpen = async () => {
    if (selectedCycleId == null || togglingSurvey) return
    const target = cycles.find(c => c.id === selectedCycleId)
    const open = !target?.survey_open
    setTogglingSurvey(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/cycles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: selectedCycleId, survey_open: open })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update the survey status')
      setMessage(open
        ? 'Survey opened — reps can now submit the /survey form for this cycle.'
        : 'Survey closed — reps can no longer submit or edit responses.')
      await loadCycles()
    } catch (e) {
      setMessage(`Error: ${e.message}`)
    } finally {
      setTogglingSurvey(false)
    }
  }

  const startEditCycle = () => {
    if (selectedCycleId == null) return
    const cycle = cycles.find(c => c.id === selectedCycleId)
    if (!cycle) return
    setEditCycleCode(cycle.code || '')
    setEditCycleName(cycle.name || '')
    setEditCycleStartsAt(cycle.starts_at ? cycle.starts_at.substring(0, 10) : '')
    setEditCycleEndsAt(cycle.ends_at ? cycle.ends_at.substring(0, 10) : '')
    setEditingCycle(true)
  }

  const saveEditCycle = async () => {
    if (selectedCycleId == null || savingCycleEdit) return
    setSavingCycleEdit(true)
    setMessage('')
    try {
      const payload = {
        id: selectedCycleId,
        code: editCycleCode.trim(),
        name: editCycleName.trim()
      }
      if (editCycleStartsAt) payload.starts_at = editCycleStartsAt
      else payload.starts_at = null
      if (editCycleEndsAt) payload.ends_at = editCycleEndsAt
      else payload.ends_at = null

      const res = await fetch('/api/admin/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to update cycle')
      setMessage('Cycle updated successfully')
      setEditingCycle(false)
      await loadCycles()
    } catch (e2) {
      setMessage(`Error: ${e2.message}`)
    } finally {
      setSavingCycleEdit(false)
    }
  }

  const cancelEditCycle = () => {
    setEditingCycle(false)
  }

  const clearAllOrders = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Prevent simultaneous operations
    if (loading || processingAction) {
      return
    }
    
    if (confirmClearAll !== 'CLEAR CYCLE ORDERS') {
      setMessage('Please type "CLEAR CYCLE ORDERS" to confirm')
      return
    }

    setLoading(true)
    setProcessingAction('clearAll')
    setMessage('Clearing orders for selected cycle...')

    try {
      const response = await fetch('/api/admin/data-management/clear-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: selectedCycleId != null ? JSON.stringify({ cycle_id: selectedCycleId }) : undefined
      })
      
      const result = await response.json()
      
      if (result.ok) {
        setMessage(`Successfully cleared ${result.deletedCount} orders`)
        setConfirmClearAll('')
      } else {
        setMessage(`Error: ${result.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    }

    setLoading(false)
    setProcessingAction(null)
  }

  const clearDeliveredOrders = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Prevent simultaneous operations
    if (loading || processingAction) {
      return
    }
    
    if (confirmClearDelivered !== 'CLEAR DELIVERED') {
      setMessage('Please type "CLEAR DELIVERED" to confirm')
      return
    }

    setLoading(true)
    setProcessingAction('clearDelivered')
    setMessage('Clearing delivered orders...')

    try {
      const response = await fetch('/api/admin/data-management/clear-delivered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: selectedCycleId != null ? JSON.stringify({ cycle_id: selectedCycleId }) : undefined
      })
      
      const result = await response.json()
      
      if (result.ok) {
        setMessage(`Successfully cleared ${result.deletedCount} delivered orders`)
        setConfirmClearDelivered('')
      } else {
        setMessage(`Error: ${result.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    }

    setLoading(false)
    setProcessingAction(null)
  }

  const resetInventory = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Prevent simultaneous operations
    if (loading || processingAction) {
      return
    }
    
    if (confirmResetInventory !== 'RESET INVENTORY') {
      setMessage('Please type "RESET INVENTORY" to confirm')
      return
    }

    setLoading(true)
    setProcessingAction('resetInventory')
    setMessage('Resetting inventory quantities...')

    try {
      const response = await fetch('/api/admin/data-management/reset-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: selectedCycleId != null ? JSON.stringify({ cycle_id: selectedCycleId }) : undefined
      })
      
      const result = await response.json()
      
      if (result.ok) {
        setMessage(`Successfully reset ${result.updatedCount} inventory items`)
        setConfirmResetInventory('')
      } else {
        setMessage(`Error: ${result.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    }

    setLoading(false)
    setProcessingAction(null)
  }

  const exportBackup = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Prevent simultaneous operations
    if (loading || processingAction) {
      return
    }
    
    setLoading(true)
    setProcessingAction('exportBackup')
    setMessage('Creating backup...')

    try {
      const exportUrl = selectedCycleId != null
        ? `/api/admin/data-management/export-backup?cycle_id=${encodeURIComponent(String(selectedCycleId))}`
        : '/api/admin/data-management/export-backup'
      const response = await fetch(exportUrl, { credentials: 'same-origin' })
      
      if (response.ok) {
        const blob = await response.blob()
        const downloadUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = `coop-backup-${new Date().toISOString().split('T')[0]}.xlsx`
        a.click()
        URL.revokeObjectURL(downloadUrl)
        setMessage('Backup exported successfully as Excel file with multiple sheets')
      } else {
        const result = await response.json()
        setMessage(`Error: ${result.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    }

    setLoading(false)
    setProcessingAction(null)
  }

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-2">
        <h1 className="text-h2 font-semibold col-span-1">Admin · Data Management</h1>
        <Button variant="secondary" onClick={() => router.back()} className="justify-self-end col-span-1">
          ← Back
        </Button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg mb-6 ${
          message.includes('Error') 
            ? 'bg-danger-bg text-danger-fg border border-danger-border' 
            : 'bg-success-bg text-success-fg border border-success-border'
        }`}>
          {message}
        </div>
      )}

      <div className="grid gap-2 lg:gap-3 xl:gap-4">
        <DatabaseMigration />

        {/* Items tools moved to Items Management — pointers so old muscle memory still lands somewhere */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-info-border bg-info-bg px-3.5 py-2.5 text-xs text-info-fg">
          <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          <span>
            Items tools moved: Food Price Repricer &amp; Items/Prices Import →{' '}
            <Link href="/admin/food/items-import" className="font-semibold underline">Items Import</Link>, and Item
            Image Management →{' '}
            <Link href="/admin/food/item-images" className="font-semibold underline">Image Bank</Link>
          </span>
        </div>

        <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
          <h2 className="text-sm font-semibold text-fg mb-1">🗓️ Cycles</h2>
          <p className="text-xs text-muted mb-3">
            Cycles isolate quarterly/seasonal sales data. New uploads automatically attach to the currently active cycle.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-line-subtle rounded-xl p-3 bg-subtle/40">
              <div className="text-sm font-medium text-fg mb-2">Select Cycle for Admin Actions</div>
              <select
                value={selectedCycleId ?? ''}
                onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                disabled={loadingCycles || cycles.length === 0}
              >
                {cycles.length === 0 ? (
                  <option value="">No cycles found</option>
                ) : (
                  cycles.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code}){c.is_active ? ' · Active' : ''}{c.survey_open ? ' · Survey open' : ''}
                    </option>
                  ))
                )}
              </select>
              <div className="mt-2 flex gap-2 flex-wrap">
                <Button onClick={setActiveCycle} loading={activatingCycle} disabled={selectedCycleId == null}>
                  {activatingCycle ? 'Setting…' : 'Set Selected as Active'}
                </Button>
                <Button
                  variant={cycles.find(c => c.id === selectedCycleId)?.survey_open ? 'secondary' : 'brand'}
                  onClick={toggleSurveyOpen}
                  loading={togglingSurvey}
                  disabled={selectedCycleId == null || togglingSurvey}
                  title="Open or close the item survey (/survey) reps fill for this cycle"
                >
                  {cycles.find(c => c.id === selectedCycleId)?.survey_open ? 'Close Survey' : 'Open Survey'}
                </Button>
                {!editingCycle && (
                  <Button variant="secondary" onClick={startEditCycle} disabled={selectedCycleId == null}>
                    Edit Cycle
                  </Button>
                )}
                <Button variant="secondary" onClick={loadCycles} loading={loadingCycles} disabled={loadingCycles}>
                  {loadingCycles ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
              <div className="mt-2 text-xs text-muted">
                Active cycle id: {activeCycleId ?? '—'}
              </div>

              {editingCycle && (
                <div className="mt-3 border border-line-subtle rounded-xl p-3 bg-subtle/40">
                  <div className="text-sm font-medium text-fg mb-2">Edit Selected Cycle</div>
                  <div className="grid gap-2">
                    <input
                      type="text"
                      value={editCycleCode}
                      onChange={(e) => setEditCycleCode(e.target.value)}
                      placeholder="Code (e.g., 2026-Q2)"
                      className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                      required
                    />
                    <input
                      type="text"
                      value={editCycleName}
                      onChange={(e) => setEditCycleName(e.target.value)}
                      placeholder="Name (e.g., Fresh Food Q2 2026)"
                      className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                      required
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-muted mb-1">Starts At</div>
                        <input
                          type="date"
                          value={editCycleStartsAt}
                          onChange={(e) => setEditCycleStartsAt(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                        />
                      </div>
                      <div>
                        <div className="text-xs text-muted mb-1">Ends At</div>
                        <input
                          type="date"
                          value={editCycleEndsAt}
                          onChange={(e) => setEditCycleEndsAt(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button onClick={saveEditCycle} loading={savingCycleEdit} disabled={savingCycleEdit}>
                        {savingCycleEdit ? 'Saving…' : 'Save Changes'}
                      </Button>
                      <Button variant="secondary" onClick={cancelEditCycle} disabled={savingCycleEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={createCycle} className="border border-line-subtle rounded-xl p-3 bg-subtle/40">
              <div className="text-sm font-medium text-fg mb-2">Create New Cycle</div>
              <div className="grid gap-2">
                <input
                  type="text"
                  value={newCycleCode}
                  onChange={(e) => setNewCycleCode(e.target.value)}
                  placeholder="Code (e.g., 2026-Q2)"
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  required
                />
                <input
                  type="text"
                  value={newCycleName}
                  onChange={(e) => setNewCycleName(e.target.value)}
                  placeholder="Name (e.g., Fresh Food Q2 2026)"
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  required
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={newCycleStartsAt}
                    onChange={(e) => setNewCycleStartsAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  />
                  <input
                    type="date"
                    value={newCycleEndsAt}
                    onChange={(e) => setNewCycleEndsAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={newCycleMakeActive}
                    onChange={(e) => setNewCycleMakeActive(e.target.checked)}
                  />
                  Make this cycle active immediately
                </label>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={newCycleSurveyOpen}
                    onChange={(e) => setNewCycleSurveyOpen(e.target.checked)}
                  />
                  Open the item survey for this cycle right away
                </label>
                <Button type="submit" loading={creatingCycle} disabled={creatingCycle} className="w-full sm:w-auto">
                  {creatingCycle ? 'Creating…' : 'Create Cycle'}
                </Button>
              </div>
            </form>
          </div>
        </div>

        <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
          <h2 className="text-sm font-semibold text-fg mb-1">💳 Food Loan Limits (Selected Cycle)</h2>
          <p className="text-xs text-muted mb-3">
            Set maximum Loan amounts per cycle for Eligible members and Non-Eligible (Grace) members.
          </p>

          <div className="border border-line-subtle rounded-xl p-3 bg-subtle/40">
            <div className="text-sm font-medium text-fg mb-3">Eligible (Loan)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted mb-1">Pensioner</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={eligibleLoanMaxPensioner}
                  onChange={(e) => setEligibleLoanMaxPensioner(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  disabled={policyLoading || policySaving || selectedCycleId == null || !limitsEditing}
                />
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Retiree</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={eligibleLoanMaxRetiree}
                  onChange={(e) => setEligibleLoanMaxRetiree(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  disabled={policyLoading || policySaving || selectedCycleId == null || !limitsEditing}
                />
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Active (Other)</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={eligibleLoanMaxActive}
                  onChange={(e) => setEligibleLoanMaxActive(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  disabled={policyLoading || policySaving || selectedCycleId == null || !limitsEditing}
                />
              </div>
            </div>
            <div className="mt-2 text-xs text-muted">Applies to Loan orders that pass eligibility.</div>
          </div>

          <div className="mt-3 border border-line-subtle rounded-xl p-3 bg-subtle/40">
            <div className="text-sm font-medium text-fg mb-3">Non-Eligible (Grace Loan)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted mb-1">Pensioner</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={graceLoanMaxPensioner}
                  onChange={(e) => setGraceLoanMaxPensioner(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  disabled={policyLoading || policySaving || selectedCycleId == null || !limitsEditing}
                />
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Retiree</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={graceLoanMaxRetiree}
                  onChange={(e) => setGraceLoanMaxRetiree(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  disabled={policyLoading || policySaving || selectedCycleId == null || !limitsEditing}
                />
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Active (Other)</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={graceLoanMaxActive}
                  onChange={(e) => setGraceLoanMaxActive(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                  disabled={policyLoading || policySaving || selectedCycleId == null || !limitsEditing}
                />
              </div>
            </div>
            <div className="mt-2 text-xs text-muted">If eligibility fails, allowed once per cycle up to this max.</div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="flex items-center justify-between gap-3 border border-line-subtle rounded-xl p-3 bg-subtle/40">
              <div>
                <div className="text-sm font-medium text-fg">Include Interest In Limit</div>
                <div className="text-xs text-muted">
                  When ON, interest is counted inside the max. When OFF, max applies to principal only.
                </div>
              </div>
              <label
                className={`flex items-center gap-2 cursor-pointer select-none ${!limitsEditing ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={() => setIncludeInterestInCap((v) => !v)}
              >
                <div className={`w-12 h-6 rounded-full px-1 flex items-center ${includeInterestInCap ? 'bg-success-fg justify-end' : 'bg-muted justify-start'}`}>
                  <div className="w-4 h-4 bg-surface rounded-full shadow" />
                </div>
                <span className={`text-sm font-medium ${includeInterestInCap ? 'text-success-fg' : 'text-muted'}`}>
                  {includeInterestInCap ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            <div className="border border-line-subtle rounded-xl p-3 bg-subtle/40">
              <div className="text-sm font-medium text-fg mb-2">Loan Interest Rate (Selected Cycle)</div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <div className="text-xs text-muted mb-1">Rate (%)</div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={loanInterestRatePct}
                    onChange={(e) => setLoanInterestRatePct(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface"
                    disabled={policyLoading || policySaving || loanRateSaving || selectedCycleId == null || !rateEditing}
                  />
                </div>
                <Button
                  type="button"
                  onClick={async () => {
                    if (!rateEditing) {
                      setRateEditing(true)
                      return
                    }
                    await saveFoodLoanRate()
                  }}
                  loading={loanRateSaving}
                  disabled={policySaving || policyLoading || loanRateSaving || selectedCycleId == null}
                >
                  {loanRateSaving ? 'Saving…' : (rateEditing ? 'Save' : 'Edit')}
                </Button>
              </div>
              <div className="mt-2 text-xs text-muted">
                Applies to Loan orders for this cycle.
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-2 flex-wrap">
            <Button
              type="button"
              onClick={async () => {
                if (!limitsEditing) {
                  setLimitsEditing(true)
                  return
                }
                await saveFoodCyclePolicy()
              }}
              loading={policySaving}
              disabled={policySaving || policyLoading || selectedCycleId == null}
            >
              {policySaving ? 'Saving…' : (limitsEditing ? 'Save' : 'Edit')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadFoodCyclePolicy(selectedCycleId)}
              loading={policyLoading}
              disabled={policySaving || policyLoading || selectedCycleId == null}
            >
              {policyLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          {policyMsg && (
            <div
              className={`mt-3 p-2 rounded text-sm ${
                policyMsg.startsWith('Error') ? 'bg-danger-bg text-danger-fg border border-danger-border' : 'bg-success-bg text-success-fg border border-success-border'
              }`}
            >
              {policyMsg}
            </div>
          )}
        </div>

        {/* Backup Data */}
        <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
          <h2 className="text-sm font-semibold text-fg mb-1">💾 Backup Data</h2>
          <p className="text-xs text-muted mb-3">
            Download data for the selected cycle as an Excel file with separate sheets for each data type.
          </p>
          <Button
              type="button"
              onClick={exportBackup}
              loading={processingAction === 'exportBackup'}
              disabled={processingAction !== null}
              leftIcon={Archive}
              className="w-full sm:w-auto"
            >
            {processingAction === 'exportBackup' ? 'Downloading...' : 'Download Backup'}
          </Button>
        </div>
      </div>

      <div className="mt-6 sm:mt-8 p-3 sm:p-4 bg-subtle rounded-lg">
        <h3 className="text-sm sm:text-base font-medium text-fg mb-2">💡 Recommended Workflow for a New Cycle:</h3>
        <ol className="list-decimal list-inside space-y-1 text-xs sm:text-sm text-muted">
          <li>Create the new cycle and set it as Active</li>
          <li>Upload your new items/prices/inventory for the active cycle</li>
          <li>Use cycle-specific Backup any time you want an export snapshot</li>
          <li>Only use Clear/Reset actions when you are intentionally cleaning a specific cycle</li>
        </ol>
      </div>
    </div>
  )
}

export default function DataManagementPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <DataManagementPageContent />
    </ProtectedRoute>
  )
}
