'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import DraggableModal from '../../../components/DraggableModal'
import ProtectedRoute from '../../../components/ProtectedRoute'

function safeJsonFactory() {
  return async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }
}

const toastMotion = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function maskAccountNumber(s) {
  const v = String(s || '').replace(/[^\d]/g, '')
  if (!v) return '—'
  if (v.length <= 4) return v
  return `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
}

function RamBanksContent() {
  const searchParams = useSearchParams()
  const [rows, setRows] = useState([])
  const [term, setTerm] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [didLoadOnce, setDidLoadOnce] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)

  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankLoc, setBankLoc] = useState(null)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [savingBank, setSavingBank] = useState(false)

  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceLoc, setInvoiceLoc] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [uploading, setUploading] = useState(false)

  const [paying, setPaying] = useState(false)

  const [invoiceEditOpen, setInvoiceEditOpen] = useState(false)
  const [invoiceEditRow, setInvoiceEditRow] = useState(null)
  const [invoiceEditRef, setInvoiceEditRef] = useState('')
  const [invoiceEditNotes, setInvoiceEditNotes] = useState('')
  const [invoiceEditDate, setInvoiceEditDate] = useState('')
  const [invoiceEditAmount, setInvoiceEditAmount] = useState('')
  const [invoiceSaving, setInvoiceSaving] = useState(false)

  const [invoiceDeleteOpen, setInvoiceDeleteOpen] = useState(false)
  const [invoiceDeleteRow, setInvoiceDeleteRow] = useState(null)
  const [invoiceDeleting, setInvoiceDeleting] = useState(false)

  const fetchCtl = useRef(null)
  const fetchSeq = useRef(0)
  const autoOpenRef = useRef(false)
  const didInitRef = useRef(false)
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchRows = async () => {
    const seq = ++fetchSeq.current
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const qs = new URLSearchParams({
        active: activeOnly ? '1' : '0',
      })
      const res = await fetch(`/api/admin/ram/vendor-banks/locations?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/locations')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      if (seq !== fetchSeq.current) return
      setRows(json.locations || [])
    } catch (e) {
      if (seq !== fetchSeq.current) return
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setRows([])
    } finally {
      if (seq === fetchSeq.current) {
        setLoading(false)
        setDidLoadOnce(true)
      }
    }
  }

  useEffect(() => {
    fetchRows()
    didInitRef.current = true
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const wantsActive = String(searchParams?.get('active') || '') === '1'
    const wantsAll = String(searchParams?.get('active') || '') === '0'
    if (wantsAll && activeOnly) setActiveOnly(false)
    if (wantsActive && !activeOnly) setActiveOnly(true)
  }, [searchParams, activeOnly])

  useEffect(() => {
    if (!didInitRef.current) return
    fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly])

  useEffect(() => {
    if (autoOpenRef.current) return
    const locationId =
      searchParams?.get('delivery_location_id') ||
      searchParams?.get('ram_delivery_location_id') ||
      searchParams?.get('location_id') ||
      ''
    if (!locationId) return

    const open = String(searchParams?.get('open') || '')
    const wantsInvoices = open === 'invoices' || String(searchParams?.get('invoices') || '') === '1'
    if (!wantsInvoices) return

    if (activeOnly) {
      setActiveOnly(false)
      return
    }

    const loc = (rows || []).find((r) => String(r?.id) === String(locationId))
    if (!loc) return
    autoOpenRef.current = true
    loadInvoices(loc)
  }, [searchParams, rows, activeOnly])

  const filtered = useMemo(() => {
    const t = String(term || '').trim().toLowerCase()
    if (!t) return rows || []
    return (rows || []).filter((r) => {
      const a = `${r.delivery_location || ''} ${r.name || ''} ${r.phone || ''} ${r.bank?.bank_name || ''} ${r.bank?.account_name || ''} ${
        r.bank?.account_number || ''
      }`.toLowerCase()
      return a.includes(t)
    })
  }, [rows, term])

  const openBank = (loc) => {
    setBankLoc(loc || null)
    setBankName(String(loc?.bank?.bank_name || ''))
    setAccountName(String(loc?.bank?.account_name || ''))
    setAccountNumber(String(loc?.bank?.account_number || ''))
    setBankModalOpen(true)
  }

  const saveBank = async () => {
    const id = Number(bankLoc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (savingBank) return
    setSavingBank(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/vendor-banks/set-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          delivery_location_id: id,
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
        }),
      })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/set-account')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setRows((prev) => (prev || []).map((r) => (Number(r.id) === id ? { ...r, bank: json.bank } : r)))
      setMsg({ type: 'success', text: 'Bank details saved' })
      setBankModalOpen(false)
      setBankLoc(null)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to save' })
    } finally {
      setSavingBank(false)
    }
  }

  const loadInvoices = async (loc) => {
    const id = Number(loc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    setInvoiceLoading(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams({ delivery_location_id: String(id) })
      const res = await fetch(`/api/admin/ram/vendor-banks/invoices/list?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/invoices/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load invoices')
      setInvoices(json.invoices || [])
      setInvoiceLoc(loc || null)
      setInvoiceListOpen(true)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to load invoices' })
      setInvoices([])
    } finally {
      setInvoiceLoading(false)
    }
  }

  const openUpload = (loc) => {
    setInvoiceLoc(loc || null)
    setInvoiceRef('')
    setInvoiceNotes('')
    setInvoiceFile(null)
    setInvoiceUploadOpen(true)
  }

  const uploadInvoice = async () => {
    const id = Number(invoiceLoc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (!invoiceFile) return
    if (uploading) return
    setUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.set('delivery_location_id', String(id))
      fd.set('invoice_ref', invoiceRef)
      fd.set('notes', invoiceNotes)
      fd.set('file', invoiceFile)
      const res = await fetch('/api/admin/ram/vendor-banks/invoices/upload', { method: 'POST', body: fd })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/invoices/upload')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed')
      setRows((prev) => (prev || []).map((r) => (Number(r.id) === id ? { ...r, invoice_count: Number(r.invoice_count || 0) + 1 } : r)))
      setInvoiceUploadOpen(false)
      setInvoiceFile(null)
      await loadInvoices(invoiceLoc)
      setMsg({ type: 'success', text: 'Invoice uploaded' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  const togglePaid = async (loc, nextIsPaid) => {
    const id = Number(loc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (paying) return
    setPaying(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/vendor-banks/set-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ delivery_location_id: id, is_paid: !!nextIsPaid }),
      })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/set-paid')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      setRows((prev) =>
        (prev || []).map((r) => (Number(r.id) === id ? { ...r, paid: { ...(r.paid || {}), ...json.paid, is_paid: !!json?.paid?.is_paid } } : r))
      )
      setMsg({ type: 'success', text: nextIsPaid ? 'Marked as Paid' : 'Marked as Unpaid' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update' })
    } finally {
      setPaying(false)
    }
  }

  const openEditInvoice = (inv) => {
    setInvoiceEditRow(inv || null)
    setInvoiceEditRef(String(inv?.invoice_ref || ''))
    setInvoiceEditNotes(String(inv?.notes || ''))
    setInvoiceEditDate(String(inv?.invoice_date || ''))
    setInvoiceEditAmount(inv?.amount != null && inv?.amount !== '' ? String(inv.amount) : '')
    setInvoiceEditOpen(true)
  }

  const saveInvoiceEdits = async () => {
    const id = Number(invoiceEditRow?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (invoiceSaving) return
    setInvoiceSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/vendor-banks/invoices/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          invoice_id: id,
          invoice_ref: invoiceEditRef,
          notes: invoiceEditNotes,
          invoice_date: invoiceEditDate,
          amount: invoiceEditAmount,
        }),
      })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/invoices/update')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      setInvoices((prev) => (prev || []).map((r) => (Number(r.id) === id ? json.invoice : r)))
      setInvoiceEditOpen(false)
      setInvoiceEditRow(null)
      setMsg({ type: 'success', text: 'Invoice updated' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update' })
    } finally {
      setInvoiceSaving(false)
    }
  }

  const confirmDeleteInvoice = (inv) => {
    setInvoiceDeleteRow(inv || null)
    setInvoiceDeleteOpen(true)
  }

  const deleteInvoice = async () => {
    const id = Number(invoiceDeleteRow?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (invoiceDeleting) return
    setInvoiceDeleting(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/ram/vendor-banks/invoices/delete?invoice_id=${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      const json = await safeJson(res, '/api/admin/ram/vendor-banks/invoices/delete')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to delete')
      setInvoices((prev) => (prev || []).filter((r) => Number(r.id) !== id))
      const locId = Number(invoiceLoc?.id)
      if (Number.isFinite(locId) && locId > 0) {
        setRows((prev) =>
          (prev || []).map((r) => (Number(r.id) === locId ? { ...r, invoice_count: Math.max(0, Number(r.invoice_count || 0) - 1) } : r))
        )
      }
      setInvoiceDeleteOpen(false)
      setInvoiceDeleteRow(null)
      setMsg({ type: 'success', text: 'Invoice deleted' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to delete' })
    } finally {
      setInvoiceDeleting(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="text-base sm:text-lg md:text-xl font-semibold break-words">Admin — Ram Sales — Banks</h1>
          <div className="text-xs sm:text-sm text-gray-600">Vendor bank details and invoices for delivery locations.</div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {msg ? (
          <motion.div
            key={`${msg.type}-${msg.text}`}
            {...toastMotion}
            className={`mb-4 rounded-lg border p-3 text-sm ${
              msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'
            }`}
          >
            {msg.text}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[420px] border-2 border-gray-200 rounded-xl px-3 py-2 text-sm"
                placeholder="Search (location, vendor, bank, account...)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <button
                type="button"
                onClick={fetchRows}
                disabled={loading}
                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="h-4 w-4" />
                Active only
              </label>
            </div>
          </div>
          <div className="text-xs text-gray-600">Locations: {filtered.length.toLocaleString()}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 text-left">Delivery Location</th>
                <th className="p-2 text-left">Vendor</th>
                <th className="p-2 text-left">Bank</th>
                <th className="p-2 text-left">Account Name</th>
                <th className="p-2 text-left">Account No</th>
                <th className="p-2 text-right">Invoices</th>
                <th className="p-2 text-right">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(!didLoadOnce || loading) ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b last:border-b-0 animate-pulse">
                    <td className="p-2" colSpan={8}>
                      <div className="h-4 w-full rounded bg-gray-100" />
                    </td>
                  </tr>
                ))
              ) : !filtered.length ? (
                <tr>
                  <td className="p-3 text-gray-600" colSpan={8}>
                    No delivery locations found.
                  </td>
                </tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="p-2 align-top">
                    <div className="font-medium">{r.delivery_location || '—'}</div>
                    <div className="text-gray-600">{r.is_active ? '' : 'Inactive'}</div>
                  </td>
                  <td className="p-2 align-top">
                    <div className="font-medium">{r.name || '—'}</div>
                    <div className="text-gray-600">{r.phone || ''}</div>
                    <div className="text-gray-600">{r.rep_code ? `Code: ${r.rep_code}` : ''}</div>
                  </td>
                  <td className="p-2 align-top">{r.bank?.bank_name || '—'}</td>
                  <td className="p-2 align-top">{r.bank?.account_name || '—'}</td>
                  <td className="p-2 align-top font-mono">{r.bank?.account_number ? maskAccountNumber(r.bank.account_number) : '—'}</td>
                  <td className="p-2 align-top text-right">{Number(r.invoice_count || 0).toLocaleString()}</td>
                  <td className="p-2 align-top text-right">
                    {r?.paid?.is_paid ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Paid</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">Unpaid</span>
                    )}
                  </td>
                  <td className="p-2 align-top text-right">
                    <div className="flex justify-end">
                      <select
                        defaultValue=""
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm bg-white disabled:opacity-50"
                        onChange={(e) => {
                          const v = e.target.value
                          e.target.value = ''
                          if (!v) return
                          if (v === 'bank') openBank(r)
                          if (v === 'invoices') loadInvoices(r)
                          if (v === 'upload') openUpload(r)
                          if (v === 'paid') togglePaid(r, true)
                          if (v === 'unpaid') togglePaid(r, false)
                        }}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="bank">{r.bank ? 'Update Bank' : 'Add Bank'}</option>
                        <option value="upload">Upload Invoice</option>
                        <option value="invoices">View Invoices</option>
                        {r?.paid?.is_paid ? <option value="unpaid">Mark Unpaid</option> : <option value="paid">Mark Paid</option>}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={bankModalOpen}
        onClose={() => {
          if (savingBank) return
          setBankModalOpen(false)
          setBankLoc(null)
        }}
        title={`Bank Details — ${bankLoc?.delivery_location || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => {
                setBankModalOpen(false)
                setBankLoc(null)
              }}
              disabled={savingBank}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
              onClick={saveBank}
              disabled={savingBank}
            >
              {savingBank ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Bank</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Account Name</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Account Number</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceListOpen}
        onClose={() => {
          if (invoiceLoading) return
          setInvoiceListOpen(false)
        }}
        title={`Invoices — ${invoiceLoc?.delivery_location || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700"
              onClick={() => setInvoiceListOpen(false)}
            >
              Close
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-xs text-gray-600">Total: {invoices.length.toLocaleString()}</div>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 text-left">File</th>
                  <th className="p-2 text-left">Ref</th>
                  <th className="p-2 text-left">Cycle</th>
                  <th className="p-2 text-left">Uploaded</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!invoices.length && (
                  <tr>
                    <td className="p-2 text-gray-600" colSpan={5}>
                      {invoiceLoading ? 'Loading…' : 'No invoices uploaded.'}
                    </td>
                  </tr>
                )}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-b-0">
                    <td className="p-2">
                      <div className="font-medium">{inv.file_name}</div>
                      <div className="text-gray-600">{inv.mime_type}</div>
                    </td>
                    <td className="p-2">{inv.invoice_ref || '—'}</td>
                    <td className="p-2">{inv.ram_cycle_id != null ? String(inv.ram_cycle_id) : '—'}</td>
                    <td className="p-2">{inv.created_at ? new Date(inv.created_at).toLocaleString() : ''}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        {inv.url ? (
                          <a href={inv.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold inline-block">
                            Open
                          </a>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
                          onClick={() => openEditInvoice(inv)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                          onClick={() => confirmDeleteInvoice(inv)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceEditOpen}
        onClose={() => {
          if (invoiceSaving) return
          setInvoiceEditOpen(false)
          setInvoiceEditRow(null)
        }}
        title={`Edit Invoice — ${invoiceEditRow?.file_name || ''}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => {
                setInvoiceEditOpen(false)
                setInvoiceEditRow(null)
              }}
              disabled={invoiceSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
              onClick={saveInvoiceEdits}
              disabled={invoiceSaving}
            >
              {invoiceSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Invoice reference</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={invoiceEditRef} onChange={(e) => setInvoiceEditRef(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Amount</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={invoiceEditAmount} onChange={(e) => setInvoiceEditAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Invoice date (YYYY-MM-DD)</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={invoiceEditDate} onChange={(e) => setInvoiceEditDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Notes</div>
            <input className="w-full border rounded px-3 py-2 text-sm" value={invoiceEditNotes} onChange={(e) => setInvoiceEditNotes(e.target.value)} />
          </div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceDeleteOpen}
        onClose={() => {
          if (invoiceDeleting) return
          setInvoiceDeleteOpen(false)
          setInvoiceDeleteRow(null)
        }}
        title="Delete invoice?"
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => {
                setInvoiceDeleteOpen(false)
                setInvoiceDeleteRow(null)
              }}
              disabled={invoiceDeleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
              onClick={deleteInvoice}
              disabled={invoiceDeleting}
            >
              {invoiceDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-gray-700">
          This will permanently delete the invoice file and record{invoiceDeleteRow?.file_name ? `: ${invoiceDeleteRow.file_name}` : ''}.
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceUploadOpen}
        onClose={() => {
          if (uploading) return
          setInvoiceUploadOpen(false)
        }}
        title={`Upload Invoice — ${invoiceLoc?.delivery_location || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => setInvoiceUploadOpen(false)}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50"
              onClick={uploadInvoice}
              disabled={uploading || !invoiceFile}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Invoice file (PDF / JPG / PNG)</div>
            <input
              type="file"
              className="w-full border rounded px-3 py-2 text-sm bg-white"
              accept=".pdf,image/*"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              disabled={uploading}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">Invoice reference (optional)</div>
              <input className="w-full border rounded px-3 py-2 text-sm" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} disabled={uploading} />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">Notes (optional)</div>
              <input className="w-full border rounded px-3 py-2 text-sm" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} disabled={uploading} />
            </div>
          </div>
        </div>
      </DraggableModal>
    </div>
  )
}

export default function RamBanksPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamBanksContent />
    </ProtectedRoute>
  )
}
