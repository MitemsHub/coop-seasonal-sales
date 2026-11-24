"use client"
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { Input } from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Label from '../../../components/ui/Label'
import Button from '../../../components/ui/Button'
import ExportButton from '../../../components/ui/ExportButton'
import Modal from '../../../components/ui/Modal'
import { FileSpreadsheet } from 'lucide-react'

export default function AdminMarkupsPage() {
  const [branches, setBranches] = useState([])
  const [priceBranchCode, setPriceBranchCode] = useState('')
  const [markupBranchCode, setMarkupBranchCode] = useState('')
  const [loadingBranches, setLoadingBranches] = useState(true)

  const [cycles, setCycles] = useState([])
  const [selectedCycleId, setSelectedCycleId] = useState(null)
  const [loadingCycles, setLoadingCycles] = useState(false)

  const [sku, setSku] = useState('')
  const [amount, setAmount] = useState(500)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

  const [priceSku, setPriceSku] = useState('')
  const [basePrice, setBasePrice] = useState(0)
  const [savingPrice, setSavingPrice] = useState(false)

  const [markups, setMarkups] = useState([])
  const [loadingMarkups, setLoadingMarkups] = useState(false)
  const [message, setMessage] = useState('')

  // Table enhancements: filters and pagination
  const [searchTerm, setSearchTerm] = useState('')
  const [activeFilter, setActiveFilter] = useState('all') // 'all' | 'active' | 'inactive'
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)

  // Bulk upload states
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadLog, setUploadLog] = useState('')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)

  // Bulk delivery location update states
  const [bulkBranchCode, setBulkBranchCode] = useState('')
  const [bulkSkus, setBulkSkus] = useState('')
  const [bulkCycleId, setBulkCycleId] = useState('')
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  // Confirmation step: the destructive call only runs after the admin has seen
  // the branch, the cycle and the exact preview of what will be removed.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkConfirmPayload, setBulkConfirmPayload] = useState(null)
  const [bulkPreview, setBulkPreview] = useState(null)
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false)
  const [bulkPreviewError, setBulkPreviewError] = useState('')
  // Undo: every removal saves a snapshot of the lines it deleted, so a mistaken
  // SKU/branch/cycle can be restored without re-adding lines by hand.
  const [bulkSnapshots, setBulkSnapshots] = useState([])
  const [bulkRestoring, setBulkRestoring] = useState(null)
  const [bulkRestoreNotice, setBulkRestoreNotice] = useState('')
  // A restore that only partially succeeded leaves the snapshot open; these
  // lines spell out exactly what a second Restore click will retry.
  const [bulkRestoreLeft, setBulkRestoreLeft] = useState([])

  const Spinner = ({ className = 'h-4 w-4 text-on-accent' }) => (
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )

  const [editingRowKey, setEditingRowKey] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [editActive, setEditActive] = useState(true)

  useEffect(() => {
    async function loadBranches() {
      try {
        setLoadingBranches(true)
        const { data, error } = await supabase
          .from('branches')
          .select('code, name')
          .order('name', { ascending: true })
        if (error) throw error
        setBranches(data || [])
        if (data && data.length > 0) {
          setPriceBranchCode(data[0].code)
          setMarkupBranchCode(data[0].code)
        }
      } catch (err) {
        setMessage(`Failed to load branches: ${err.message}`)
      } finally {
        setLoadingBranches(false)
      }
    }
    loadBranches()
  }, [supabase])

  useEffect(() => {
    async function loadCycles() {
      try {
        setLoadingCycles(true)
        const res = await fetch('/api/admin/cycles', { cache: 'no-store', credentials: 'same-origin' })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load cycles')
        setCycles(json.cycles || [])
        setSelectedCycleId(prev => {
          if (prev != null) return prev
          if (json.active_cycle_id != null) return json.active_cycle_id
          if ((json.cycles || []).length > 0) return json.cycles[0].id
          return null
        })
      } catch (e) {
        setMessage(`Failed to load cycles: ${e.message}`)
      } finally {
        setLoadingCycles(false)
      }
    }
    loadCycles()
  }, [])

  useEffect(() => {
    if (!markupBranchCode) return
    async function loadMarkups() {
      try {
        setLoadingMarkups(true)
        setMessage('')
        const cycleQuery = selectedCycleId != null ? `&cycle_id=${encodeURIComponent(selectedCycleId)}` : ''
        const res = await fetch(`/api/admin/markups?branch_code=${encodeURIComponent(markupBranchCode)}${cycleQuery}`)
        const json = await res.json()
        if (!json.ok) throw new Error(json.error || 'Failed to fetch markups')
        setMarkups(json.markups || [])
      } catch (err) {
        setMessage(`Failed to load markups: ${err.message}`)
      } finally {
        setLoadingMarkups(false)
      }
    }
    loadMarkups()
  }, [markupBranchCode, selectedCycleId])

  async function updateBasePrice(e) {
    e.preventDefault()
    try {
      setSavingPrice(true)
      setMessage('')
      const res = await fetch('/api/admin/markups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          branch_code: priceBranchCode,
          sku: priceSku.trim(),
          price: Number(basePrice),
          cycle_id: selectedCycleId
        })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update price')
      setMessage(json.message || 'Price updated')
    } catch (err) {
      setMessage(`Price update failed: ${err.message}`)
    } finally {
      setSavingPrice(false)
    }
  }

  async function upsertMarkup(e) {
    e.preventDefault()
    try {
      setSaving(true)
      setMessage('')
      const res = await fetch('/api/admin/markups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_code: markupBranchCode, sku: sku.trim(), amount: Number(amount), cycle_id: selectedCycleId })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to save markup')
      setMessage(json.message || 'Markup saved')
      // Refresh list
      const cycleQuery = selectedCycleId != null ? `&cycle_id=${encodeURIComponent(selectedCycleId)}` : ''
      const listRes = await fetch(`/api/admin/markups?branch_code=${encodeURIComponent(markupBranchCode)}${cycleQuery}`)
      const listJson = await listRes.json()
      setMarkups(listJson.markups || [])
    } catch (err) {
      setMessage(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function removeMarkup(itemSku) {
    try {
      setRemoving(true)
      setMessage('')
      const res = await fetch('/api/admin/markups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_code: markupBranchCode, sku: itemSku, cycle_id: selectedCycleId })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to remove markup')
      setMessage(json.message || 'Markup removed')
      setMarkups(prev => prev.filter(m => (m.items?.sku || '') !== itemSku))
    } catch (err) {
      setMessage(`Remove failed: ${err.message}`)
    } finally {
      setRemoving(false)
    }
  }

  const startEditRow = (m) => {
    const rowKey = `${m.item_id}:${m.cycle_id || ''}`
    setEditingRowKey(rowKey)
    setEditAmount(String(Number(m.amount || 0)))
    setEditActive(!!m.active)
  }

  const cancelEditRow = () => {
    setEditingRowKey(null)
    setEditAmount('')
    setEditActive(true)
  }

  const saveEditRow = async (m) => {
    try {
      const sku = String(m.items?.sku || '').trim()
      if (!sku) throw new Error('Missing SKU')
      const amt = Number(editAmount)
      if (!Number.isFinite(amt) || amt < 0) throw new Error('Invalid markup amount')

      setSaving(true)
      setMessage('')

      const res = await fetch('/api/admin/markups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          branch_code: markupBranchCode,
          sku,
          amount: Math.trunc(amt),
          active: !!editActive,
          cycle_id: selectedCycleId
        })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to save markup')
      setMessage(json.message || 'Markup updated')

      setMarkups(prev =>
        (prev || []).map(x => {
          const xKey = `${x.item_id}:${x.cycle_id || ''}`
          const mKey = `${m.item_id}:${m.cycle_id || ''}`
          if (xKey !== mKey) return x
          return { ...x, amount: Math.trunc(amt), active: !!editActive }
        })
      )
      cancelEditRow()
    } catch (err) {
      setMessage(`Update failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Derived filtered and paginated markups
  const filteredMarkups = markups.filter(m => {
    const matchesSearch = (searchTerm || '').trim() === ''
      || (m.items?.sku || '').toLowerCase().includes(searchTerm.toLowerCase())
      || (m.items?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
      || (m.items?.category || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchesActive = activeFilter === 'all'
      ? true
      : activeFilter === 'active' ? !!m.active : !m.active
    return matchesSearch && matchesActive
  })

  const totalPages = Math.max(1, Math.ceil(filteredMarkups.length / itemsPerPage))
  const startIdx = (currentPage - 1) * itemsPerPage
  const paginatedMarkups = filteredMarkups.slice(startIdx, startIdx + itemsPerPage)

  useEffect(() => {
    // Reset to first page when filters change
    setCurrentPage(1)
  }, [searchTerm, activeFilter, markupBranchCode])

  const exportMarkupsExcel = async () => {
    if (!filteredMarkups.length) return
    setExportingExcel(true)
    try {
      const headers = ['Branch', 'SKU', 'Item', 'Category', 'Unit', 'Markup', 'Active']
      const rows = filteredMarkups.map((m) => [
        markupBranchCode,
        m.items?.sku || '',
        m.items?.name || '',
        m.items?.category || '',
        m.items?.unit || '',
        Number(m.amount || 0),
        m.active ? 'TRUE' : 'FALSE',
      ])

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Markups')
      ws.addRow(['Food Distribution · Markups'])
      ws.addRow([`Branch: ${markupBranchCode || 'N/A'} | Cycle: ${selectedCycleId || 'N/A'}`])
      ws.addRow(headers)
      for (const r of rows) ws.addRow(r)

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `markups_${markupBranchCode || 'branch'}_${selectedCycleId || 'cycle'}_${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } finally {
      setExportingExcel(false)
    }
  }

  // Export PDF for filtered markups (uses jspdf + autotable)
  const exportMarkupsPDF = async () => {
    setExportingPDF(true)
    try {
      if (!filteredMarkups.length) {
        alert('No data available for the selected filters.')
        return
      }
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF('l', 'mm', 'a4')
      doc.setFontSize(16)
      doc.text('Branch Prices & Markups', 14, 15)
      doc.setFontSize(10)
      let filterText = `Branch: ${markupBranchCode || 'N/A'}`
      if (searchTerm) filterText += ` | Search: ${searchTerm}`
      if (activeFilter !== 'all') filterText += ` | Active: ${activeFilter}`
      doc.text(filterText, 14, 22)

      const headers = ['SKU', 'Item', 'Category', 'Unit', 'Markup (₦)', 'Active']
      const body = filteredMarkups.map(m => [
        m.items?.sku || '',
        m.items?.name || '',
        m.items?.category || '',
        m.items?.unit || '',
        Number(m.amount || 0),
        m.active ? 'Yes' : 'No',
      ])

      autoTable(doc, {
        head: [headers],
        body,
        startY: 30,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', lineWidth: 0.1, lineColor: [0, 0, 0] },
        headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 10, right: 10 },
        columnStyles: {
          0: { cellWidth: 28 }, // SKU
          1: { cellWidth: 110 }, // Item
          2: { cellWidth: 55 }, // Category
          3: { cellWidth: 22 }, // Unit
          4: { cellWidth: 26, halign: 'right' }, // Markup
          5: { cellWidth: 18 }, // Active
        }
      })

      doc.save(`markups_${markupBranchCode || 'branch'}_${selectedCycleId || 'cycle'}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (error) {
      console.error('PDF export error:', error)
      alert('PDF export failed. Please try again.')
    } finally {
      setExportingPDF(false)
    }
  }

  const bulkUpdateDelivery = async (payloadOverride = null) => {
    try {
      setBulkProcessing(true)
      setBulkResult(null)
      setMessage('')
      let payload = payloadOverride
      if (!payload) {
        const skusArray = bulkSkus.split(',').map((s) => s.trim()).filter(Boolean)
        if (!bulkBranchCode || skusArray.length === 0) {
          setBulkResult({ ok: false, error: 'Please select a branch and enter at least one SKU' })
          return
        }
        if (!bulkCycleId) {
          setBulkResult({ ok: false, error: 'Please select a cycle — removal is scoped to one cycle, so it cannot run across all cycles' })
          return
        }
        payload = {
          branch_code: bulkBranchCode,
          skus: skusArray,
          cycle_id: Number(bulkCycleId),
        }
      }

      const res = await fetch('/api/admin/markups/bulk-location-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to process bulk update')
      setBulkResult(json)
      setMessage(json.message || 'Bulk update completed')
      setBulkConfirmOpen(false)
      setBulkConfirmPayload(null)
      setBulkPreview(null)
      setBulkRestoreNotice('')
      loadBulkSnapshots()
    } catch (err) {
      setBulkResult({ ok: false, error: err.message })
      setMessage(`Bulk update failed: ${err.message}`)
    } finally {
      setBulkProcessing(false)
    }
  }

  // Validate the inputs, then open the confirmation dialog and ask the API
  // what would actually be removed (preview only — nothing is deleted here).
  const openBulkConfirm = async () => {
    setBulkResult(null)
    setMessage('')
    const skusArray = bulkSkus.split(',').map((s) => s.trim()).filter(Boolean)
    if (!bulkBranchCode || skusArray.length === 0) {
      setBulkResult({ ok: false, error: 'Please select a branch and enter at least one SKU' })
      return
    }
    if (!bulkCycleId) {
      setBulkResult({ ok: false, error: 'Please select a cycle — removal is scoped to one cycle, so it cannot run across all cycles' })
      return
    }
    const payload = { branch_code: bulkBranchCode, skus: skusArray, cycle_id: Number(bulkCycleId) }
    setBulkConfirmPayload(payload)
    setBulkPreview(null)
    setBulkPreviewError('')
    setBulkConfirmOpen(true)
    setBulkPreviewLoading(true)
    try {
      const res = await fetch('/api/admin/markups/bulk-location-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, preview: true }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to preview bulk removal')
      setBulkPreview(json)
    } catch (err) {
      setBulkPreviewError(err.message)
    } finally {
      setBulkPreviewLoading(false)
    }
  }

  const loadBulkSnapshots = async () => {
    try {
      const res = await fetch('/api/admin/markups/bulk-location-update/restore', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (res.ok && json.ok) setBulkSnapshots(json.snapshots || [])
    } catch {}
  }

  // Puts a saved removal back: the deleted lines, the recalculated totals, and
  // the previous status of any order the removal had cancelled.
  const restoreBulkRemoval = async (snapshotId) => {
    try {
      setBulkRestoring(snapshotId)
      setBulkRestoreNotice('')
      setBulkRestoreLeft([])
      const res = await fetch('/api/admin/markups/bulk-location-update/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: snapshotId }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Restore failed')
      setBulkRestoreNotice(
        json.message ||
          `Restored ${json.restored_lines || 0} line(s) across ${json.restored_orders?.length || 0} order(s).`
      )
      const left = []
      for (const f of json.remaining?.failed_lines || []) {
        left.push(`Order #${f.order_id} · item ${f.item_id} · ${f.qty} unit(s) still missing — ${f.error}`)
      }
      for (const f of json.remaining?.failed_orders || []) {
        left.push(`Order #${f.order_id} · totals were not recalculated — ${f.error}`)
      }
      if (json.remaining?.snapshot_mark_failed) {
        left.push('The removal could not be marked as restored — run Restore again to close it.')
      }
      setBulkRestoreLeft(left)
      await loadBulkSnapshots()
    } catch (err) {
      setBulkRestoreNotice(`Restore failed: ${err.message}`)
    } finally {
      setBulkRestoring(null)
    }
  }

  useEffect(() => {
    loadBulkSnapshots()
  }, [])

  const dlExcel = async (fileName, rows, sheetName) => {
    if (!rows?.length) return
    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(sheetName || 'Template')

    const headers = Object.keys(rows[0] || {})
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadMarkupsTemplate = () => {
    dlExcel(
      'Markups_Template.xlsx',
      [
        {
          branch_code: 'DUTSE',
          cycle_id: selectedCycleId || '',
          sku: 'RICE50KG',
          amount: 500,
          active: 'TRUE',
        },
      ],
      'Markups'
    ).catch(() => null)
  }

  const uploadMarkups = async () => {
    try {
      setUploading(true)
      setUploadLog('')
      if (!uploadFile) {
        setUploadLog('Please choose a file first.')
        return
      }
      const fd = new FormData()
      fd.append('file', uploadFile)
      if (selectedCycleId != null) fd.append('cycle_id', String(selectedCycleId))
      const res = await fetch('/api/admin/import/markups', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `Upload failed with status ${res.status}`)
      setUploadLog(JSON.stringify(json, null, 2))
      // Refresh current branch markups
      const cycleQuery = selectedCycleId != null ? `&cycle_id=${encodeURIComponent(selectedCycleId)}` : ''
      const listRes = await fetch(`/api/admin/markups?branch_code=${encodeURIComponent(markupBranchCode)}${cycleQuery}`)
      const listJson = await listRes.json()
      if (listJson.ok) setMarkups(listJson.markups || [])
    } catch (e) {
      setUploadLog(`Error: ${e.message}`)
      console.error('Markups upload error:', e)
    } finally {
      setUploading(false)
    }
  }

  // Confirmation-dialog context: the branch/cycle names the admin picked and
  // whether the cycle is a finished season (is_active is the app-wide open flag).
  const bulkBranch = branches.find((b) => b.code === bulkBranchCode) || null
  const bulkCycle = cycles.find((c) => String(c.id) === String(bulkCycleId)) || null
  const bulkCycleClosed = !!bulkCycle && !bulkCycle.is_active
  const bulkConfirmSkus = bulkConfirmPayload?.skus || []
  const bulkConfirmBlocked =
    bulkPreviewLoading || Boolean(bulkPreviewError) || !bulkPreview || bulkPreview.removed_lines === 0

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
        <h1 className="text-h2 font-bold tracking-tight text-fg mb-2">Admin · Food Distribution · Markups</h1>
        <p className="text-sm text-muted mb-6">
          Set fixed markups (e.g., ₦500) per item per branch. Prices in the Shop and Checkout will include these markups.
        </p>

      {message && (
        <div className="mb-4 p-3 rounded border border-line bg-subtle">{message}</div>
      )}

      <div className="mb-4 bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
        <h2 className="text-[15px] font-semibold mb-2">Update Base Price (Per Cycle)</h2>
        <p className="text-sm text-muted mb-3">Updates branch base price for a specific cycle. Existing orders for that branch/item will reprice automatically.</p>
        <form onSubmit={updateBasePrice} className="flex gap-4 items-end flex-wrap">
          <div className="w-full sm:w-72">
            <Label htmlFor="price-branch">Branch</Label>
            <Select
              id="price-branch"
              value={priceBranchCode}
              onChange={e => setPriceBranchCode(e.target.value)}
              disabled={loadingBranches}
              required
            >
              {branches.map(b => (
                <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-72">
            <Label htmlFor="price-cycle">Cycle</Label>
            <Select
              id="price-cycle"
              value={selectedCycleId ?? ''}
              onChange={e => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingCycles || cycles.length === 0}
              required
            >
              {cycles.length === 0 ? (
                <option value="">No cycles found</option>
              ) : (
                cycles.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code}){c.is_active ? ' · Active' : ''}
                  </option>
                ))
              )}
            </Select>
          </div>
          <div className="w-full sm:w-64">
            <Label htmlFor="price-sku">SKU</Label>
            <Input
              id="price-sku"
              type="text"
              value={priceSku}
              onChange={e => setPriceSku(e.target.value)}
              placeholder="e.g., RICE-25KG"
              required
            />
          </div>
          <div className="w-full sm:w-40">
            <Label htmlFor="price-amount">Base Price (₦)</Label>
            <Input
              id="price-amount"
              type="number"
              value={basePrice}
              onChange={e => setBasePrice(e.target.value)}
              min={0}
              step={1}
              required
            />
          </div>
          <Button
            type="submit"
            loading={savingPrice}
            disabled={!priceBranchCode}
          >
            {savingPrice ? 'Updating…' : 'Update Price'}
          </Button>
        </form>
      </div>

      <div className="mb-4 bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
        <h2 className="text-[15px] font-semibold mb-2">Markups (Per Cycle)</h2>
        <div className="flex gap-4 items-end flex-wrap">
        <div className="w-full sm:w-64">
          <Label htmlFor="markup-branch">Branch (for Markups)</Label>
          <Select
            id="markup-branch"
            value={markupBranchCode}
            onChange={e => setMarkupBranchCode(e.target.value)}
            disabled={loadingBranches}
          >
            {branches.map(b => (
              <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-64">
          <Label htmlFor="markup-cycle">Cycle (for Markups)</Label>
          <Select
            id="markup-cycle"
            value={selectedCycleId ?? ''}
            onChange={e => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
            disabled={loadingCycles || cycles.length === 0}
            required
          >
            {cycles.length === 0 ? (
              <option value="">No cycles found</option>
            ) : (
              cycles.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}){c.is_active ? ' · Active' : ''}
                </option>
              ))
            )}
          </Select>
        </div>
        </div>
        <form onSubmit={upsertMarkup} className="mt-4">
          <div className="flex gap-4 items-end flex-wrap">
            <div className="w-full sm:w-64">
              <Label htmlFor="markup-sku">SKU</Label>
              <Input
                id="markup-sku"
                type="text"
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder="e.g., RICE-25KG"
                required
              />
            </div>
            <div className="w-full sm:w-40">
              <Label htmlFor="markup-amount">Markup Amount (₦)</Label>
              <Input
                id="markup-amount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                min={0}
                step={1}
                required
              />
            </div>
            <Button
              type="submit"
              loading={saving}
            >
              {saving ? 'Saving…' : 'Save Markup'}
            </Button>
          </div>
        </form>
      </div>

      {/* Bulk Upload Section */}
      <div className="mb-4 bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
        <h2 className="text-[15px] font-semibold mb-2">Bulk Upload Markups (.xlsx)</h2>
        <p className="text-sm text-muted mb-3">Expected columns: branch_code, cycle_id, sku, amount, active</p>
        {selectedCycleId && (
          <div className="mb-3 px-2 py-1.5 rounded-lg bg-info-bg border border-info-border text-xs text-info-fg">
            Markups will be saved to cycle: <strong>{cycles.find(c => c.id === selectedCycleId)?.name || selectedCycleId}</strong>{cycles.find(c => c.id === selectedCycleId)?.is_active ? ' (Active)' : ''}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => setUploadFile(e.target.files?.[0] || null)}
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-line-subtle rounded-lg bg-surface cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-subtle file:px-3 file:py-1 file:text-sm file:font-medium file:text-fg file:transition-colors hover:file:bg-muted"
          />
          <div className="flex gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={downloadMarkupsTemplate}
              leftIcon={FileSpreadsheet}
            >
              Download Template
            </Button>
            <Button
              onClick={uploadMarkups}
              loading={uploading}
            >
              {uploading ? 'Uploading…' : 'Upload Markups'}
            </Button>
          </div>
        </div>
        {uploadLog && (
          <pre className="mt-3 text-xs bg-subtle border rounded p-2 overflow-auto max-h-48">{uploadLog}</pre>
        )}
      </div>

      <div className="mb-4 bg-surface rounded-xl shadow-lg border border-line-subtle overflow-hidden">
        <div className="p-4 border-b border-line-subtle bg-subtle/60 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="text-sm font-semibold">Current Markups</div>
          <div className="w-full sm:w-72">
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by SKU, item, category"
            />
          </div>
          <div className="w-full sm:w-44">
            <Select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </Select>
          </div>
          <div className="flex gap-2 lg:ml-auto">
            <ExportButton
              format="excel"
              onClick={() => exportMarkupsExcel().catch(() => null)}
              disabled={!filteredMarkups.length || exportingExcel}
              busy={exportingExcel}
            />
            <ExportButton
              format="pdf"
              onClick={exportMarkupsPDF}
              disabled={!filteredMarkups.length || exportingPDF}
              busy={exportingPDF}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-surface sticky top-0 z-10">
              <tr className="text-left border-b">
                <th className="p-3">SKU</th>
                <th className="p-3">Item</th>
                <th className="p-3">Category</th>
                <th className="p-3">Unit</th>
                <th className="p-3">Markup (₦)</th>
                <th className="p-3">Active</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loadingMarkups ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="p-3">
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredMarkups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted">
                    No markups configured for this branch.
                  </td>
                </tr>
              ) : (
                paginatedMarkups.map((m) => (
                  <tr key={`${m.item_id}:${m.cycle_id || ''}`} className="hover:bg-subtle/40">
                    <td className="p-3">{m.items?.sku || '—'}</td>
                    <td className="p-3">{m.items?.name || '—'}</td>
                    <td className="p-3">{m.items?.category || '—'}</td>
                    <td className="p-3">{m.items?.unit || '—'}</td>
                    <td className="p-3">
                      {editingRowKey === `${m.item_id}:${m.cycle_id || ''}` ? (
                        <div className="w-28">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="h-8 px-2 text-xs sm:text-sm"
                          />
                        </div>
                      ) : (
                        Number(m.amount || 0)
                      )}
                    </td>
                    <td className="p-3">
                      {editingRowKey === `${m.item_id}:${m.cycle_id || ''}` ? (
                        <label className="inline-flex items-center gap-2 text-xs sm:text-sm">
                          <input type="checkbox" checked={!!editActive} onChange={(e) => setEditActive(e.target.checked)} />
                          Active
                        </label>
                      ) : (
                        m.active ? 'Yes' : 'No'
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {editingRowKey === `${m.item_id}:${m.cycle_id || ''}` ? (
                        <div className="inline-flex gap-3">
                          <button
                            className="text-accent hover:underline disabled:opacity-60"
                            onClick={() => saveEditRow(m)}
                            disabled={saving}
                            type="button"
                          >
                            Save
                          </button>
                          <button className="text-muted hover:underline" onClick={cancelEditRow} type="button">
                            Cancel
                          </button>
                          <button
                            className="text-danger-fg hover:underline disabled:opacity-60"
                            onClick={() => removeMarkup(m.items?.sku || '')}
                            disabled={removing}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-3">
                          <button className="text-accent hover:underline" onClick={() => startEditRow(m)} type="button">
                            Edit
                          </button>
                          <button
                            className="text-danger-fg hover:underline disabled:opacity-60"
                            onClick={() => removeMarkup(m.items?.sku || '')}
                            disabled={removing}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-line-subtle bg-subtle/60 flex items-center justify-between">
          <div className="text-xs sm:text-sm text-muted">
            Showing {filteredMarkups.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + itemsPerPage, filteredMarkups.length)} of {filteredMarkups.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </Button>
            <span className="text-xs sm:text-sm text-muted">Page {currentPage} of {totalPages}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
      {/* Bulk Delivery Location Update Section */}
      <div className="mb-4 bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
        <h2 className="text-[15px] font-semibold mb-2">Bulk Remove Items from Orders</h2>
        <p className="text-sm text-muted mb-3">
          Remove specific items from all Pending/Posted/Delivered orders of the selected cycle at a delivery branch. Useful when a product becomes unavailable after orders were placed —
          affected orders will have those items removed and totals recalculated. Orders with no remaining items will be automatically cancelled.
        </p>
        <div className="flex gap-4 items-end flex-wrap">
          <div className="w-full sm:w-64">
            <Label htmlFor="bulk-branch">Delivery Branch</Label>
            <Select
              id="bulk-branch"
              value={bulkBranchCode}
              onChange={(e) => setBulkBranchCode(e.target.value)}
              disabled={loadingBranches}
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-80">
            <Label htmlFor="bulk-skus">Item SKUs (comma-separated)</Label>
            <Input
              id="bulk-skus"
              type="text"
              value={bulkSkus}
              onChange={(e) => setBulkSkus(e.target.value)}
              placeholder="e.g., RICE-25KG, GROUNDNUT-OIL"
            />
          </div>
          <div className="w-full sm:w-48">
            <Label htmlFor="bulk-cycle">Cycle</Label>
            <Select
              id="bulk-cycle"
              value={bulkCycleId}
              onChange={(e) => setBulkCycleId(e.target.value)}
            >
              <option value="">Select cycle</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </Select>
          </div>
          <Button
            variant="danger"
            onClick={openBulkConfirm}
            loading={bulkProcessing}
            disabled={!bulkBranchCode || !bulkCycleId || !bulkSkus.trim()}
          >
            {bulkProcessing ? 'Processing…' : 'Remove Items'}
          </Button>
        </div>
        {bulkResult && (
          <div className={`mt-3 p-3 rounded-lg border text-sm ${bulkResult.ok ? 'border-success-border bg-success-bg' : 'border-danger-border bg-danger-bg'}`}>
            {bulkResult.ok ? (
              <div>
                <p className="font-medium">✅ {bulkResult.message}</p>
                {bulkResult.affected_orders > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Affected orders: {bulkResult.affected_orders} | Removed lines: {bulkResult.removed_lines}
                  </p>
                )}
                {bulkResult.snapshot_id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">A snapshot of the removed lines is saved.</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => restoreBulkRemoval(bulkResult.snapshot_id)}
                      loading={bulkRestoring === bulkResult.snapshot_id}
                    >
                      Restore this removal
                    </Button>
                  </div>
                )}
                {bulkRestoreNotice && <p className="mt-2 text-xs text-fg">{bulkRestoreNotice}</p>}
                <RestoreLeftover items={bulkRestoreLeft} />
                {bulkResult.missing_skus?.length > 0 && (
                  <p className="mt-1 text-xs text-warning-fg">
                    ⚠️ SKUs not found: {bulkResult.missing_skus.join(', ')}
                  </p>
                )}
                {bulkResult.errors?.length > 0 && (
                  <p className="mt-1 text-xs text-danger-fg">
                    Errors: {bulkResult.errors.map((e) => `Order #${e.order_id}: ${e.error}`).join('; ')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-danger-fg">❌ {bulkResult.error}</p>
            )}
          </div>
        )}
      </div>

      {bulkSnapshots.length > 0 && (
        <div className="mb-4 bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
          <h2 className="text-[15px] font-semibold mb-1">Recent bulk removals</h2>
          <p className="text-sm text-muted mb-3">
            Restoring puts the deleted lines back at their original prices, recalculates the order totals, and reopens an
            order the removal had cancelled.
          </p>
          <ul className="divide-y divide-line-subtle">
            {bulkSnapshots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    {s.branch_code || '—'} · {formatBulkDate(s.created_at)} · {s.removed_lines} line(s) from{' '}
                    {s.affected_orders} order(s)
                  </p>
                  <p className="text-xs text-muted break-words">
                    {(s.requested_skus || []).join(', ')}
                    {s.retired_skus?.length ? ` · retired: ${s.retired_skus.map((i) => i.sku).join(', ')}` : ''}
                    {s.actor ? ` · by ${s.actor}` : ''}
                  </p>
                </div>
                {s.restored_at ? (
                  <span className="text-xs text-success-fg">Restored</span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => restoreBulkRemoval(s.id)}
                    loading={bulkRestoring === s.id}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {bulkRestoreNotice && <p className="mt-2 text-xs text-fg">{bulkRestoreNotice}</p>}
          <RestoreLeftover items={bulkRestoreLeft} />
        </div>
      )}

      <Modal
        open={bulkConfirmOpen}
        onClose={() => {
          if (!bulkProcessing) setBulkConfirmOpen(false)
        }}
        title="Remove items from orders?"
        description="This deletes the matching order lines and recalculates order totals. A snapshot is saved first, so a mistaken removal can be restored from “Recent bulk removals”."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkConfirmOpen(false)} disabled={bulkProcessing}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => bulkUpdateDelivery(bulkConfirmPayload)}
              loading={bulkProcessing}
              disabled={bulkConfirmBlocked}
            >
              {bulkCycleClosed ? 'Remove items anyway' : 'Remove items'}
            </Button>
          </>
        }
      >
        <dl className="space-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted">Branch</dt>
            <dd className="font-medium text-fg">
              {bulkBranch ? `${bulkBranch.name} (${bulkBranch.code})` : bulkBranchCode}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted">Cycle</dt>
            <dd className="text-fg">
              {bulkCycle ? `${bulkCycle.name}${bulkCycle.code ? ` (${bulkCycle.code})` : ''}` : String(bulkCycleId || '')}
              {bulkCycle && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    bulkCycleClosed ? 'bg-subtle text-warning-fg' : 'bg-subtle text-muted'
                  }`}
                >
                  {bulkCycleClosed ? 'Closed' : 'Active'}
                </span>
              )}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted">Items</dt>
            <dd className="break-words text-fg">{bulkConfirmSkus.join(', ') || '—'}</dd>
          </div>
        </dl>

        {bulkCycleClosed && (
          <div className="mt-3 rounded-lg border border-line bg-subtle p-3 text-xs text-warning-fg">
            <p className="font-medium">This cycle is closed.</p>
            <p className="mt-1">
              Removing items here rewrites totals on orders from a finished season, including Delivered orders that were
              already reported.
            </p>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-line-subtle bg-subtle/60 p-3 text-sm">
          {bulkPreviewLoading ? (
            <p className="flex items-center gap-2 text-muted">
              <Spinner className="h-4 w-4 text-muted" /> Checking what will be removed…
            </p>
          ) : bulkPreviewError ? (
            <p className="text-danger-fg">Could not preview: {bulkPreviewError}</p>
          ) : bulkPreview ? (
            bulkPreview.removed_lines === 0 ? (
              <p className="text-muted">
                No order lines match those SKUs for this branch and cycle — nothing will be removed.
              </p>
            ) : (
              <div className="space-y-1">
                <p className="font-medium text-fg">
                  Will remove {bulkPreview.removed_lines} item line(s) from {bulkPreview.affected_orders} order(s).
                </p>
                {bulkPreview.retired_items?.length > 0 && (
                  <div className="mt-2 rounded-md border border-warning-border bg-warning-bg/60 p-2 text-warning-fg">
                    <p className="font-medium">
                      ⚠️ {bulkPreview.retired_items.length} of these SKU(s) are retired items — no longer sold.
                    </p>
                    <p className="mt-1 text-xs">
                      {bulkPreview.retired_items
                        .map((i) => `${i.sku} (${i.lines} line${i.lines === 1 ? '' : 's'})`)
                        .join(', ')}
                    </p>
                    <p className="mt-1 text-xs">
                      They are only removed from past orders. Untick or delete a retired SKU from the list if you meant to
                      remove something still on sale.
                    </p>
                  </div>
                )}
                {bulkPreview.item_summary?.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted">
                    {bulkPreview.item_summary.map((i) => (
                      <li key={i.sku} className={i.retired ? 'text-warning-fg' : ''}>
                        {i.sku}: {i.lines} line{i.lines === 1 ? '' : 's'} across {i.orders} order
                        {i.orders === 1 ? '' : 's'} · {i.qty} unit{i.qty === 1 ? '' : 's'}
                        {i.retired ? ' · RETIRED' : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {bulkPreview.orders_cancelled > 0 && (
                  <p className="text-muted">
                    {bulkPreview.orders_cancelled} order(s) will have no items left and will be automatically cancelled.
                  </p>
                )}
                {bulkPreview.missing_skus?.length > 0 && (
                  <p className="text-warning-fg">
                    Not found (nothing removed for these): {bulkPreview.missing_skus.join(', ')}
                  </p>
                )}
              </div>
            )
          ) : null}
        </div>
      </Modal>
    </div>
    </ProtectedRoute>
  )
}

function RestoreLeftover({ items }) {
  if (!items?.length) return null
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-danger-fg">
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  )
}

function formatBulkDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
