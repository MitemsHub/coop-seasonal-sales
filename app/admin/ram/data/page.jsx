'use client'

import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DraggableModal from '../../../components/DraggableModal'

function safeJsonFactory() {
  return async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }
}

function emptyForm() {
  return { delivery_location: '', name: '', phone: '', address: '', rep_code: '', is_active: true, sort_order: '' }
}

function RamDataContent() {
  const [locations, setLocations] = useState([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(emptyForm())
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [shoppingLoading, setShoppingLoading] = useState(false)
  const [shoppingMsg, setShoppingMsg] = useState('')
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const [cycles, setCycles] = useState([])
  const [loadingCycles, setLoadingCycles] = useState(false)
  const [activeCycleId, setActiveCycleId] = useState(null)
  const [selectedCycleId, setSelectedCycleId] = useState(null)
  const [eligiblePensionerQty, setEligiblePensionerQty] = useState('1')
  const [eligibleRetireeQty, setEligibleRetireeQty] = useState('2')
  const [eligibleActiveQty, setEligibleActiveQty] = useState('2')
  const [nonEligiblePensionerQty, setNonEligiblePensionerQty] = useState('1')
  const [nonEligibleRetireeQty, setNonEligibleRetireeQty] = useState('0')
  const [nonEligibleActiveQty, setNonEligibleActiveQty] = useState('1')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyMsg, setPolicyMsg] = useState('')
  const [priceJunior, setPriceJunior] = useState('400000')
  const [priceSenior, setPriceSenior] = useState('500000')
  const [priceExecutive, setPriceExecutive] = useState('600000')
  const [priceUndefined, setPriceUndefined] = useState('0')
  const [loanInterestRatePct, setLoanInterestRatePct] = useState('6')
  const [vendorDeductionRatePct, setVendorDeductionRatePct] = useState('6')
  const [editableFields, setEditableFields] = useState({})
  const [pricingEditing, setPricingEditing] = useState(false)
  const [loanRateEditing, setLoanRateEditing] = useState(false)
  const [vendorRateEditing, setVendorRateEditing] = useState(false)

  const [newCycleCode, setNewCycleCode] = useState('')
  const [newCycleName, setNewCycleName] = useState('')
  const [newCycleStartsAt, setNewCycleStartsAt] = useState('')
  const [newCycleEndsAt, setNewCycleEndsAt] = useState('')
  const [newCycleMakeActive, setNewCycleMakeActive] = useState(true)
  const [creatingCycle, setCreatingCycle] = useState(false)
  const [activatingCycle, setActivatingCycle] = useState(false)
  const [cycleSetup, setCycleSetup] = useState(null)

  const pageSize = 10

  const loadCycles = async () => {
    try {
      setLoadingCycles(true)
      const res = await fetch('/api/admin/ram/cycles', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load cycles')
      setCycles(json.cycles || [])
      setActiveCycleId(json.active_cycle_id ?? null)
      setSelectedCycleId(() => {
        if (json.active_cycle_id != null) return json.active_cycle_id
        if ((json.cycles || []).length > 0) return json.cycles[0].id
        return null
      })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to load cycles' })
    } finally {
      setLoadingCycles(false)
    }
  }

  const fetchLocations = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams({
        ...(selectedCycleId != null ? { cycle_id: String(selectedCycleId) } : {}),
      })
      const res = await fetch(`/api/admin/ram/delivery-locations?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setLocations(json.locations || [])
      setPage(1)
    } catch (e) {
      setLocations([])
      setMsg({ type: 'error', text: e?.message || 'Failed to load' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCycles()
    fetchLocations()
  }, [])

  useEffect(() => {
    if (selectedCycleId == null) return
    fetchLocations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycleId])

  useEffect(() => {
    setEditableFields({})
    setPricingEditing(false)
    setLoanRateEditing(false)
    setVendorRateEditing(false)
  }, [selectedCycleId])

  useEffect(() => {
    const id = selectedCycleId == null ? null : Number(selectedCycleId)
    const c = (cycles || []).find((x) => Number(x?.id) === id) || null
    setPolicyMsg('')
    setEligiblePensionerQty(String(c?.eligible_loan_qty_pensioner ?? 1))
    setEligibleRetireeQty(String(c?.eligible_loan_qty_retiree ?? 2))
    setEligibleActiveQty(String(c?.eligible_loan_qty_active ?? 2))
    setNonEligiblePensionerQty(String(c?.grace_loan_qty_pensioner ?? 1))
    setNonEligibleRetireeQty(String(c?.grace_loan_qty_retiree ?? 0))
    setNonEligibleActiveQty(String(c?.grace_loan_qty_active ?? 1))
    setPriceJunior(String(c?.price_junior ?? 400000))
    setPriceSenior(String(c?.price_senior ?? 500000))
    setPriceExecutive(String(c?.price_executive ?? 600000))
    setPriceUndefined(String(c?.price_undefined ?? 0))
    setLoanInterestRatePct(String(Number.isFinite(Number(c?.loan_interest_rate_pct)) ? Number(c?.loan_interest_rate_pct) : 6))
    setVendorDeductionRatePct(String(Number.isFinite(Number(c?.vendor_deduction_rate_pct)) ? Number(c?.vendor_deduction_rate_pct) : 6))
  }, [cycles, selectedCycleId])

  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setShoppingLoading(true)
        setShoppingMsg('')
        const res = await fetch('/api/admin/system/ram-shopping', { cache: 'no-store', credentials: 'same-origin' })
        const json = await res.json()
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load status')
        if (!cancelled) setShoppingOpen(!!json.open)
      } catch (e) {
        if (!cancelled) setShoppingMsg(`Error: ${e?.message || 'Failed to load status'}`)
      } finally {
        if (!cancelled) setShoppingLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const saveShoppingStatus = async () => {
    try {
      setShoppingLoading(true)
      setShoppingMsg('')
      const res = await fetch('/api/admin/system/ram-shopping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ open: shoppingOpen }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setShoppingMsg('Ram shopping status saved successfully')
    } catch (e) {
      setShoppingMsg(`Error: ${e?.message || 'Failed to save'}`)
    } finally {
      setShoppingLoading(false)
    }
  }

  const createCycle = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (creatingCycle) return
    setCreatingCycle(true)
    setMsg(null)
    try {
      const payload = {
        code: newCycleCode.trim(),
        name: newCycleName.trim(),
        make_active: !!newCycleMakeActive
      }
      if (newCycleStartsAt) payload.starts_at = newCycleStartsAt
      if (newCycleEndsAt) payload.ends_at = newCycleEndsAt

      const res = await fetch('/api/admin/ram/cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to create cycle')
      setMsg({ type: 'success', text: `Cycle created: ${json.cycle?.name || json.cycle?.code || 'New cycle'}` })
      setNewCycleCode('')
      setNewCycleName('')
      setNewCycleStartsAt('')
      setNewCycleEndsAt('')
      await loadCycles()
      if (json.active_cycle_id != null) setSelectedCycleId(json.active_cycle_id)
      setCycleSetup({ id: json.cycle?.id || null, name: json.cycle?.name || '', code: json.cycle?.code || '' })
    } catch (e2) {
      setMsg({ type: 'error', text: e2?.message || 'Failed to create cycle' })
    } finally {
      setCreatingCycle(false)
    }
  }

  const setActiveCycle = async () => {
    if (activatingCycle) return
    if (selectedCycleId == null) return
    setActivatingCycle(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/cycles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: selectedCycleId })
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to set active cycle')
      setMsg({ type: 'success', text: 'Active cycle updated successfully' })
      await loadCycles()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to set active cycle' })
    } finally {
      setActivatingCycle(false)
    }
  }

  const saveCycleSetting = async (patch) => {
    if (savingPolicy) return
    const cycleId = selectedCycleId == null ? null : Number(selectedCycleId)
    if (!Number.isFinite(cycleId) || cycleId <= 0) return
    setSavingPolicy(true)
    setPolicyMsg('')
    try {
      const payload = { id: cycleId, ...(patch || {}) }
      const res = await fetch('/api/admin/ram/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save')
      const updated = json.cycle
      setCycles((prev) => (prev || []).map((x) => (Number(x?.id) === Number(updated?.id) ? { ...x, ...updated } : x)))
      setPolicyMsg('Saved')
      return true
    } catch (e) {
      setPolicyMsg(`Error: ${e?.message || 'Failed to save'}`)
      return false
    } finally {
      setSavingPolicy(false)
    }
  }

  const savePrices = async () => {
    return saveCycleSetting({
      price_junior: Number(priceJunior),
      price_senior: Number(priceSenior),
      price_executive: Number(priceExecutive),
      price_undefined: Number(priceUndefined),
    })
  }

  const saveLoanInterestRate = async () => {
    const v = loanInterestRatePct === '' ? 0 : Number(loanInterestRatePct)
    if (!Number.isFinite(v) || v < 0) {
      setPolicyMsg('Error: Loan interest rate must be a non-negative number')
      return false
    }
    return saveCycleSetting({ loan_interest_rate_pct: v })
  }

  const saveVendorDeductionRate = async () => {
    const v = vendorDeductionRatePct === '' ? 0 : Number(vendorDeductionRatePct)
    if (!Number.isFinite(v) || v < 0) {
      setPolicyMsg('Error: Vendor deduction rate must be a non-negative number')
      return false
    }
    return saveCycleSetting({ vendor_deduction_rate_pct: v })
  }

  const isEditingField = (key) => !!editableFields?.[key]
  const setEditingField = (key, on) => {
    setEditableFields((prev) => {
      const next = { ...(prev || {}) }
      if (on) next[key] = true
      else delete next[key]
      return next
    })
  }

  const handleInlineEditOrSave = async (key, value) => {
    if (!isEditingField(key)) {
      setEditingField(key, true)
      return
    }
    const n = value === '' ? 0 : Number(value)
    const ok = await saveCycleSetting({ [key]: n })
    if (ok) setEditingField(key, false)
  }

  const toggleCycleActive = async (loc) => {
    if (selectedCycleId == null) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/delivery-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: loc.id, cycle_id: selectedCycleId, cycle_active: !(loc?.cycle_active === true) }),
      })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations (PATCH cycle)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      setLocations((prev) => {
        const next = (prev || []).map((l) => (Number(l.id) === Number(loc.id) ? { ...l, ...json.location } : l))
        if (json?.location?.cycle_active === false) {
          return next.filter((l) => Number(l.id) !== Number(loc.id))
        }
        return next
      })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update' })
    } finally {
      setSaving(false)
    }
  }

  const onFormChange = (key, value) => setForm((p) => ({ ...p, [key]: value }))
  const onEditChange = (key, value) => setEditing((p) => ({ ...p, [key]: value }))

  const createLocation = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const payload = {
        delivery_location: form.delivery_location,
        name: form.name,
        phone: form.phone,
        address: form.address,
        ...(String(form.rep_code).trim() ? { rep_code: String(form.rep_code).trim().toUpperCase() } : { rep_code: null }),
        is_active: !!form.is_active,
        ...(String(form.sort_order).trim() ? { sort_order: Number(form.sort_order) } : {}),
        ...(selectedCycleId != null ? { cycle_id: selectedCycleId } : {}),
      }
      const res = await fetch('/api/admin/ram/delivery-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations (POST)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to create')
      setMsg({ type: 'success', text: 'Delivery location created' })
      setForm(emptyForm())
      fetchLocations()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to create' })
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    if (!editing?.id) return
    setSaving(true)
    setMsg(null)
    try {
      const payload = {
        id: editing.id,
        delivery_location: editing.delivery_location,
        name: editing.name,
        phone: editing.phone,
        address: editing.address,
        rep_code: String(editing.rep_code || '').trim() ? String(editing.rep_code || '').trim().toUpperCase() : null,
        is_active: !!editing.is_active,
        sort_order: String(editing.sort_order).trim() ? Number(editing.sort_order) : null,
      }
      const res = await fetch('/api/admin/ram/delivery-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations (PATCH)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      setMsg({ type: 'success', text: 'Delivery location updated' })
      setEditing(null)
      fetchLocations()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (loc) => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/delivery-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: loc.id, is_active: !loc.is_active }),
      })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations (PATCH active)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      fetchLocations()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update' })
    } finally {
      setSaving(false)
    }
  }

  const refreshAll = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([loadCycles(), fetchLocations()])
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to refresh' })
    } finally {
      setRefreshing(false)
    }
  }

  const filteredLocations = useMemo(() => {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return locations || []
    return (locations || []).filter((l) => {
      const haystack = [
        l?.delivery_location,
        l?.name,
        l?.phone,
        l?.rep_code,
        l?.address,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [locations, query])

  const pageCount = Math.max(1, Math.ceil(filteredLocations.length / pageSize))
  const safePage = Math.min(Math.max(1, Number(page || 1)), pageCount)
  const pagedLocations = filteredLocations.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · Data</h1>
        <p className="text-sm text-muted">Manage ram cycles, pricing, delivery locations and shopping status.</p>
      </div>
      <div className="mb-4 flex justify-end">
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
          onClick={refreshAll}
          disabled={refreshing || loading || loadingCycles}
        >
          {(refreshing || loading || loadingCycles) && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          )}
          <span>{refreshing || loading || loadingCycles ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {!!msg && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="ui-card p-4 mb-4">
        <div className="text-sm font-semibold mb-3">Ram Cycles</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-line bg-subtle/40 p-4">
            <div className="text-xs text-muted mb-2">Set Active Cycle</div>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-subtext mb-1">Cycle</label>
                <select
                  className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                  value={selectedCycleId ?? ''}
                  onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
                  disabled={loadingCycles || cycles.length === 0}
                >
                  {cycles.length === 0 ? (
                    <option value="">No cycles found</option>
                  ) : (
                    cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code}){c.is_active ? ' · Active' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                onClick={setActiveCycle}
                disabled={activatingCycle || selectedCycleId == null || selectedCycleId === activeCycleId}
              >
                {activatingCycle ? 'Updating...' : 'Set Active'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-subtle/40 p-4">
            <div className="text-xs text-muted mb-2">Create New Cycle</div>
            <form onSubmit={createCycle} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Code (e.g. RAM-APR-2026)"
                value={newCycleCode}
                onChange={(e) => setNewCycleCode(e.target.value)}
                required
              />
              <input
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Name (e.g. April 2026)"
                value={newCycleName}
                onChange={(e) => setNewCycleName(e.target.value)}
                required
              />
              <input
                type="datetime-local"
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={newCycleStartsAt}
                onChange={(e) => setNewCycleStartsAt(e.target.value)}
              />
              <input
                type="datetime-local"
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={newCycleEndsAt}
                onChange={(e) => setNewCycleEndsAt(e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs sm:text-sm text-subtext">
                <input type="checkbox" checked={!!newCycleMakeActive} onChange={(e) => setNewCycleMakeActive(e.target.checked)} />
                Make active
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-success-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
                  disabled={creatingCycle}
                >
                  {creatingCycle ? 'Creating...' : 'Create Cycle'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="ui-card overflow-hidden">
            <div className="p-4 border-b border-line">
              <div className="text-sm font-semibold text-fg">Eligible Members (Loan)</div>
              <div className="text-xs text-muted mt-1">Sets the maximum Loan quantity per cycle.</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-subtle border-b border-line">
                  <tr>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Category</th>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Max Qty</th>
                    <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCycles ? (
                    <>
                      {Array.from({ length: 3 }).map((_, i) => (
                        <tr key={`sk-el-${i}`} className="border-b border-line last:border-b-0 animate-pulse">
                          <td className="p-2">
                            <div className="h-4 w-24 sakani-skeleton rounded" />
                          </td>
                          <td className="p-2">
                            <div className="h-9 w-full sakani-skeleton rounded-xl" />
                          </td>
                          <td className="p-2 text-right">
                            <div className="h-9 w-20 sakani-skeleton rounded-lg inline-block" />
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <>
                      <tr className="border-b border-line last:border-b-0 hover:bg-subtle">
                        <td className="p-2 font-medium">Pensioner</td>
                        <td className="p-2">
                          <input
                            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                            value={eligiblePensionerQty}
                            onChange={(e) => setEligiblePensionerQty(e.target.value)}
                            inputMode="numeric"
                            disabled={savingPolicy || selectedCycleId == null || !isEditingField('eligible_loan_qty_pensioner')}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                            onClick={() => handleInlineEditOrSave('eligible_loan_qty_pensioner', eligiblePensionerQty)}
                            disabled={savingPolicy || selectedCycleId == null}
                          >
                            {savingPolicy ? 'Saving...' : (isEditingField('eligible_loan_qty_pensioner') ? 'Save' : 'Edit')}
                          </button>
                        </td>
                      </tr>
                      <tr className="border-b border-line last:border-b-0 hover:bg-subtle">
                        <td className="p-2 font-medium">Retiree</td>
                        <td className="p-2">
                          <input
                            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                            value={eligibleRetireeQty}
                            onChange={(e) => setEligibleRetireeQty(e.target.value)}
                            inputMode="numeric"
                            disabled={savingPolicy || selectedCycleId == null || !isEditingField('eligible_loan_qty_retiree')}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                            onClick={() => handleInlineEditOrSave('eligible_loan_qty_retiree', eligibleRetireeQty)}
                            disabled={savingPolicy || selectedCycleId == null}
                          >
                            {savingPolicy ? 'Saving...' : (isEditingField('eligible_loan_qty_retiree') ? 'Save' : 'Edit')}
                          </button>
                        </td>
                      </tr>
                      <tr className="border-b border-line last:border-b-0 hover:bg-subtle">
                        <td className="p-2 font-medium">Active (Others)</td>
                        <td className="p-2">
                          <input
                            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                            value={eligibleActiveQty}
                            onChange={(e) => setEligibleActiveQty(e.target.value)}
                            inputMode="numeric"
                            disabled={savingPolicy || selectedCycleId == null || !isEditingField('eligible_loan_qty_active')}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                            onClick={() => handleInlineEditOrSave('eligible_loan_qty_active', eligibleActiveQty)}
                            disabled={savingPolicy || selectedCycleId == null}
                          >
                            {savingPolicy ? 'Saving...' : (isEditingField('eligible_loan_qty_active') ? 'Save' : 'Edit')}
                          </button>
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ui-card overflow-hidden">
            <div className="p-4 border-b border-line">
              <div className="text-sm font-semibold text-fg">Non-Eligible Members (Grace / Loan)</div>
              <div className="text-xs text-muted mt-1">Sets the one-time grace quantity for members who are not eligible by loan amount.</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-subtle border-b border-line">
                  <tr>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Category</th>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Max Qty</th>
                    <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCycles ? (
                    <>
                      {Array.from({ length: 3 }).map((_, i) => (
                        <tr key={`sk-ne-${i}`} className="border-b border-line last:border-b-0 animate-pulse">
                          <td className="p-2">
                            <div className="h-4 w-24 sakani-skeleton rounded" />
                          </td>
                          <td className="p-2">
                            <div className="h-9 w-full sakani-skeleton rounded-xl" />
                          </td>
                          <td className="p-2 text-right">
                            <div className="h-9 w-20 sakani-skeleton rounded-lg inline-block" />
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <>
                      <tr className="border-b border-line last:border-b-0 hover:bg-subtle">
                        <td className="p-2 font-medium">Pensioner</td>
                        <td className="p-2">
                          <input
                            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                            value={nonEligiblePensionerQty}
                            onChange={(e) => setNonEligiblePensionerQty(e.target.value)}
                            inputMode="numeric"
                            disabled={savingPolicy || selectedCycleId == null || !isEditingField('grace_loan_qty_pensioner')}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                            onClick={() => handleInlineEditOrSave('grace_loan_qty_pensioner', nonEligiblePensionerQty)}
                            disabled={savingPolicy || selectedCycleId == null}
                          >
                            {savingPolicy ? 'Saving...' : (isEditingField('grace_loan_qty_pensioner') ? 'Save' : 'Edit')}
                          </button>
                        </td>
                      </tr>
                      <tr className="border-b border-line last:border-b-0 hover:bg-subtle">
                        <td className="p-2 font-medium">Retiree</td>
                        <td className="p-2">
                          <input
                            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                            value={nonEligibleRetireeQty}
                            onChange={(e) => setNonEligibleRetireeQty(e.target.value)}
                            inputMode="numeric"
                            disabled={savingPolicy || selectedCycleId == null || !isEditingField('grace_loan_qty_retiree')}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                            onClick={() => handleInlineEditOrSave('grace_loan_qty_retiree', nonEligibleRetireeQty)}
                            disabled={savingPolicy || selectedCycleId == null}
                          >
                            {savingPolicy ? 'Saving...' : (isEditingField('grace_loan_qty_retiree') ? 'Save' : 'Edit')}
                          </button>
                        </td>
                      </tr>
                      <tr className="border-b border-line last:border-b-0 hover:bg-subtle">
                        <td className="p-2 font-medium">Active (Others)</td>
                        <td className="p-2">
                          <input
                            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                            value={nonEligibleActiveQty}
                            onChange={(e) => setNonEligibleActiveQty(e.target.value)}
                            inputMode="numeric"
                            disabled={savingPolicy || selectedCycleId == null || !isEditingField('grace_loan_qty_active')}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                            onClick={() => handleInlineEditOrSave('grace_loan_qty_active', nonEligibleActiveQty)}
                            disabled={savingPolicy || selectedCycleId == null}
                          >
                            {savingPolicy ? 'Saving...' : (isEditingField('grace_loan_qty_active') ? 'Save' : 'Edit')}
                          </button>
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {policyMsg ? <div className="px-4 py-3 text-xs text-subtext border-t border-line">{policyMsg}</div> : null}
          </div>
        </div>

        <div className="mt-4 ui-card p-4">
          <div className="text-sm font-semibold text-fg">Cycle Pricing</div>
          <div className="text-xs text-muted mt-1 mb-3">Sets the unit price per ram category for this cycle.</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <label className="block text-xs font-medium text-subtext mb-1">Junior price</label>
              <input
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                value={priceJunior}
                onChange={(e) => setPriceJunior(e.target.value)}
                inputMode="numeric"
                disabled={loadingCycles || savingPolicy || selectedCycleId == null || !pricingEditing}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-subtext mb-1">Senior price</label>
              <input
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                value={priceSenior}
                onChange={(e) => setPriceSenior(e.target.value)}
                inputMode="numeric"
                disabled={loadingCycles || savingPolicy || selectedCycleId == null || !pricingEditing}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-subtext mb-1">Executive price</label>
              <input
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                value={priceExecutive}
                onChange={(e) => setPriceExecutive(e.target.value)}
                inputMode="numeric"
                disabled={loadingCycles || savingPolicy || selectedCycleId == null || !pricingEditing}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-subtext mb-1">Undefined price</label>
              <input
                className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                value={priceUndefined}
                onChange={(e) => setPriceUndefined(e.target.value)}
                inputMode="numeric"
                disabled={loadingCycles || savingPolicy || selectedCycleId == null || !pricingEditing}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
              onClick={async () => {
                if (!pricingEditing) {
                  setPricingEditing(true)
                  return
                }
                const ok = await savePrices()
                if (ok) setPricingEditing(false)
              }}
              disabled={savingPolicy || selectedCycleId == null}
            >
              {savingPolicy ? 'Saving...' : (pricingEditing ? 'Save Prices' : 'Edit')}
            </button>
          </div>
        </div>

        <div className="mt-4 ui-card p-4">
          <div className="text-sm font-semibold text-fg">Cycle Rates</div>
          <div className="text-xs text-muted mt-1 mb-3">Configure per-cycle rates for Loan interest and vendor payment deductions.</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-subtle/40 p-3">
              <div className="text-xs font-semibold text-fg mb-1">Loan Interest Rate (Selected Cycle)</div>
              <div className="text-xs text-muted mb-2">Applied to members using the Loan payment option.</div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-subtext mb-1">Rate (%)</label>
                  <input
                    className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                    type="number"
                    min="0"
                    step="0.01"
                    value={loanInterestRatePct}
                    onChange={(e) => setLoanInterestRatePct(e.target.value)}
                    disabled={loadingCycles || savingPolicy || selectedCycleId == null || !loanRateEditing}
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                  onClick={async () => {
                    if (!loanRateEditing) {
                      setLoanRateEditing(true)
                      return
                    }
                    const ok = await saveLoanInterestRate()
                    if (ok) setLoanRateEditing(false)
                  }}
                  disabled={savingPolicy || selectedCycleId == null}
                >
                  {savingPolicy ? 'Saving...' : (loanRateEditing ? 'Save' : 'Edit')}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-subtle/40 p-3">
              <div className="text-xs font-semibold text-fg mb-1">Vendor Deduction Rate (Selected Cycle)</div>
              <div className="text-xs text-muted mb-2">Applied to “payment_vendor” (amount paid to vendors) for this cycle.</div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-subtext mb-1">Rate (%)</label>
                  <input
                    className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full"
                    type="number"
                    min="0"
                    step="0.01"
                    value={vendorDeductionRatePct}
                    onChange={(e) => setVendorDeductionRatePct(e.target.value)}
                    disabled={loadingCycles || savingPolicy || selectedCycleId == null || !vendorRateEditing}
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                  onClick={async () => {
                    if (!vendorRateEditing) {
                      setVendorRateEditing(true)
                      return
                    }
                    const ok = await saveVendorDeductionRate()
                    if (ok) setVendorRateEditing(false)
                  }}
                  disabled={savingPolicy || selectedCycleId == null}
                >
                  {savingPolicy ? 'Saving...' : (vendorRateEditing ? 'Save' : 'Edit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ui-card p-4 mb-4">
        <div className="text-sm font-medium mb-3">Add Delivery Location</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="Delivery location code/name"
            value={form.delivery_location}
            onChange={(e) => onFormChange('delivery_location', e.target.value)}
          />
          <input className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" placeholder="Contact name" value={form.name} onChange={(e) => onFormChange('name', e.target.value)} />
          <input className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" placeholder="Phone" value={form.phone} onChange={(e) => onFormChange('phone', e.target.value)} />
          <input
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="Rep passcode"
            value={form.rep_code}
            onChange={(e) => onFormChange('rep_code', e.target.value)}
          />
          <input
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 sm:col-span-2"
            placeholder="Address"
            value={form.address}
            onChange={(e) => onFormChange('address', e.target.value)}
          />
          <input
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="Sort order"
            value={form.sort_order}
            onChange={(e) => onFormChange('sort_order', e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs sm:text-sm text-subtext">
            <input type="checkbox" checked={!!form.is_active} onChange={(e) => onFormChange('is_active', e.target.checked)} />
            Active
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-success-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              onClick={createLocation}
              disabled={saving || !String(form.delivery_location).trim()}
            >
              {saving ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="p-4 border-b border-line bg-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <input
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full sm:max-w-sm"
            placeholder="Search delivery locations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex items-center justify-between sm:justify-end gap-2 text-xs text-subtext">
            <button
              type="button"
              className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
            >
              Prev
            </button>
            <div>
              Page {safePage} / {pageCount}
            </div>
            <button
              type="button"
              className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50"
              onClick={() => setPage(Math.min(pageCount, safePage + 1))}
              disabled={safePage >= pageCount}
            >
              Next
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle border-b border-line">
            <tr>
              <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Delivery Location</th>
              <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Contact</th>
              <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Phone</th>
              <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Rep Passcode</th>
              <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Address</th>
              <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Sort</th>
              <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-subtext">This Cycle</th>
              <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-subtext">Active</th>
              <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-loc-${i}`} className="border-b border-line last:border-b-0">
                    <td className="p-2" colSpan={9}>
                      <div className="h-4 sakani-skeleton rounded w-full" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!loading && filteredLocations.length === 0 && (
              <tr>
                <td className="p-3 text-muted" colSpan={9}>
                  {locations.length === 0 ? 'No delivery locations.' : 'No matches.'}
                </td>
              </tr>
            )}
            {pagedLocations.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-b-0 hover:bg-subtle">
                <td className="p-2 font-medium">{l.delivery_location}</td>
                <td className="p-2">{l.name || ''}</td>
                <td className="p-2">{l.phone || ''}</td>
                <td className="p-2">{l.rep_code || ''}</td>
                <td className="p-2">{l.address || ''}</td>
                <td className="p-2 text-right">{l.sort_order ?? ''}</td>
                <td className="p-2 text-center">
                  <button
                    className={`px-2 py-1 rounded text-xs ${
                      l?.cycle_active ? 'bg-success-bg text-success-fg border border-success-border' : 'bg-subtle text-muted border border-line'
                    } disabled:opacity-50`}
                    onClick={() => toggleCycleActive(l)}
                    disabled={saving || selectedCycleId == null}
                    title={selectedCycleId == null ? 'Select a cycle first' : ''}
                  >
                    {l?.cycle_active ? 'Yes' : 'No'}
                  </button>
                </td>
                <td className="p-2 text-center">
                  <button
                    className={`px-2 py-1 rounded text-xs ${l.is_active ? 'bg-success-bg text-success-fg border border-success-border' : 'bg-subtle text-muted border border-line'} disabled:opacity-50`}
                    onClick={() => toggleActive(l)}
                    disabled={saving}
                  >
                    {l.is_active ? 'Yes' : 'No'}
                  </button>
                </td>
                <td className="p-2 text-right">
                  <button
                    className="inline-flex items-center rounded-lg bg-brand px-3 py-1 text-xs font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                    onClick={() => setEditing({ ...l, sort_order: l.sort_order ?? '', rep_code: l.rep_code || '' })}
                    disabled={saving}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-subtle p-4">
        <div className="text-sm font-semibold text-fg">Ram Shopping Control</div>
        <div className="mt-1 text-sm text-muted">Toggle whether members can start Ram shopping from the portal.</div>
        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none" onClick={() => setShoppingOpen(!shoppingOpen)}>
            <div className={`h-6 w-12 rounded-full px-1 flex items-center ${shoppingOpen ? 'justify-end bg-success' : 'justify-start bg-muted'}`}>
              <div className="h-4 w-4 rounded-full bg-surface shadow" />
            </div>
            <span className={`text-sm font-medium ${shoppingOpen ? 'text-success-fg' : 'text-muted'}`}>{shoppingOpen ? 'Open' : 'Closed'}</span>
          </label>
          <input type="checkbox" checked={shoppingOpen} onChange={(e) => setShoppingOpen(e.target.checked)} className="hidden" />
          <button
            type="button"
            onClick={saveShoppingStatus}
            disabled={shoppingLoading}
            className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani ${shoppingLoading ? 'cursor-not-allowed bg-muted' : 'bg-brand hover:bg-brand-hover'}`}
          >
            {shoppingLoading ? 'Saving…' : 'Save'}
          </button>
        </div>
        {shoppingMsg && (
          <div
            className={`mt-2 p-2 rounded text-sm ${
              shoppingMsg.startsWith('Error') ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
            }`}
          >
            {shoppingMsg}
          </div>
        )}
      </div>

      <DraggableModal
        open={!!editing}
        onClose={() => (saving ? null : setEditing(null))}
        title="Edit Delivery Location"
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle" onClick={() => setEditing(null)} disabled={saving}>
              Close
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-success-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              onClick={saveEdit}
              disabled={saving || !String(editing?.delivery_location || '').trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="Delivery location code/name"
            value={editing?.delivery_location || ''}
            onChange={(e) => onEditChange('delivery_location', e.target.value)}
          />
          <input className="rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" placeholder="Contact name" value={editing?.name || ''} onChange={(e) => onEditChange('name', e.target.value)} />
          <input className="rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" placeholder="Phone" value={editing?.phone || ''} onChange={(e) => onEditChange('phone', e.target.value)} />
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="Rep passcode"
            value={editing?.rep_code || ''}
            onChange={(e) => onEditChange('rep_code', e.target.value)}
          />
          <input className="rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" placeholder="Sort order" value={editing?.sort_order ?? ''} onChange={(e) => onEditChange('sort_order', e.target.value)} />
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 sm:col-span-2"
            placeholder="Address"
            value={editing?.address || ''}
            onChange={(e) => onEditChange('address', e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs sm:text-sm text-subtext">
            <input type="checkbox" checked={!!editing?.is_active} onChange={(e) => onEditChange('is_active', e.target.checked)} />
            Active
          </label>
        </div>
      </DraggableModal>

      <DraggableModal
        open={!!cycleSetup}
        onClose={() => setCycleSetup(null)}
        title="New cycle created. Setup required"
        footer={
          <div className="flex justify-end">
            <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover" onClick={() => setCycleSetup(null)}>
              Okay
            </button>
          </div>
        }
      >
        <div className="text-sm text-fg">
          <div className="font-medium">
            {cycleSetup?.name ? `${cycleSetup.name}${cycleSetup?.code ? ` (${cycleSetup.code})` : ''}` : 'New cycle'}
          </div>
          <div className="mt-2 text-sm text-subtext">Please set up these areas for the new cycle:</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-subtext space-y-1">
            <li>Eligible Members (Loan) max qty</li>
            <li>Non‑Eligible Members (Grace / Loan) max qty</li>
            <li>Cycle Pricing (Junior / Senior / Executive / Undefined)</li>
            <li>Delivery Locations: enable the locations you want under “This Cycle”</li>
            <li>Vendor Banks: add/set vendor accounts and invoices for this cycle</li>
          </ul>
        </div>
      </DraggableModal>
    </div>
  )
}

export default function RamDataPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamDataContent />
    </ProtectedRoute>
  )
}
