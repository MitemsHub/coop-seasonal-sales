'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import DraggableModal from '../../../components/DraggableModal'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { Landmark, RefreshCw, Trash2 } from 'lucide-react'

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
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · Banks</h1>
        <p className="text-sm text-muted">Vendor bank details and invoices for delivery locations.</p>
      </div>

      <AnimatePresence mode="wait">
        {msg ? (
          <motion.div
            key={`${msg.type}-${msg.text}`}
            {...toastMotion}
            className={`mb-4 rounded-xl border p-4 text-sm ${
              msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
            }`}
          >
            {msg.text}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="ui-card p-4 mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[420px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Search (location, vendor, bank, account...)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <button
                type="button"
                onClick={fetchRows}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
              >
                <RefreshCw className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} />
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="h-4 w-4 rounded border-line text-brand focus:ring-brand" />
                Active only
              </label>
            </div>
          </div>
          <div className="text-sm text-muted">Locations: <span className="font-medium text-fg">{filtered.length.toLocaleString()}</span></div>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Delivery Location</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Vendor</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Bank</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Account Name</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Account No</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Invoices</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Status</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(!didLoadOnce || loading) ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-line">
                    <td className="p-3"><div className="sakani-skeleton h-4 w-32 rounded" /></td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-40 rounded" /></td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-24 rounded" /></td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-36 rounded" /></td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-20 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-10 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-16 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-8 w-24 rounded" /></td>
                  </tr>
                ))
              ) : !filtered.length ? (
                <tr>
                  <td className="p-10 text-center" colSpan={8}>
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                        <Landmark className="h-6 w-6 text-subtext" />
                      </div>
                      <p className="text-sm font-medium text-fg">No delivery locations found</p>
                      <p className="text-xs text-muted">Vendor bank records will appear here.</p>
                    </div>
                  </td>
                </tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-b-0 transition-colors duration-150 ease-sakani hover:bg-subtle">
                  <td className="p-3 align-top">
                    <div className="font-medium text-fg">{r.delivery_location || '—'}</div>
                    <div className="text-xs text-subtext">{r.is_active ? '' : 'Inactive'}</div>
                  </td>
                  <td className="p-3 align-top">
                    <div className="font-medium text-fg">{r.name || '—'}</div>
                    <div className="text-xs text-subtext">{r.phone || ''}</div>
                    <div className="text-xs text-subtext">{r.rep_code ? `Code: ${r.rep_code}` : ''}</div>
                  </td>
                  <td className="p-3 align-top">{r.bank?.bank_name || '—'}</td>
                  <td className="p-3 align-top">{r.bank?.account_name || '—'}</td>
                  <td className="p-3 align-top font-mono text-xs">{r.bank?.account_number ? maskAccountNumber(r.bank.account_number) : '—'}</td>
                  <td className="p-3 align-top text-right">{Number(r.invoice_count || 0).toLocaleString()}</td>
                  <td className="p-3 align-top text-right">
                    {r?.paid?.is_paid ? (
                      <span className="inline-flex items-center rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">Paid</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-muted">Unpaid</span>
                    )}
                  </td>
                  <td className="p-3 align-top text-right">
                    <div className="flex justify-end">
                      <select
                        defaultValue=""
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
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
        title={`Bank Details · ${bankLoc?.delivery_location || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
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
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
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
            <div className="text-xs font-medium text-subtext mb-1">Bank</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Account Name</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Account Number</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceListOpen}
        onClose={() => {
          if (invoiceLoading) return
          setInvoiceListOpen(false)
        }}
        title={`Invoices · ${invoiceLoc?.delivery_location || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
              onClick={() => setInvoiceListOpen(false)}
            >
              Close
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-muted">Total: <span className="font-medium text-fg">{invoices.length.toLocaleString()}</span></div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-subtle border-b border-line">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">File</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Ref</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Cycle</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Uploaded</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!invoices.length && (
                  <tr>
                    <td className="p-2 text-muted" colSpan={5}>
                      {invoiceLoading ? 'Loading…' : 'No invoices uploaded.'}
                    </td>
                  </tr>
                )}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-line last:border-b-0 transition-colors duration-150 ease-sakani hover:bg-subtle">
                    <td className="p-2">
                      <div className="font-medium text-fg">{inv.file_name}</div>
                      <div className="text-xs text-subtext">{inv.mime_type}</div>
                    </td>
                    <td className="p-2">{inv.invoice_ref || '—'}</td>
                    <td className="p-2">{inv.ram_cycle_id != null ? String(inv.ram_cycle_id) : '—'}</td>
                    <td className="p-2">{inv.created_at ? new Date(inv.created_at).toLocaleString() : ''}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        {inv.url ? (
                          <a href={inv.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover">
                            Open
                          </a>
                        ) : (
                          <span className="text-subtext">—</span>
                        )}
                        <button
                          type="button"
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
                          onClick={() => openEditInvoice(inv)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg bg-danger-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110"
                          onClick={() => confirmDeleteInvoice(inv)}
                        >
                          <Trash2 className="h-3 w-3" />
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
        title={`Edit Invoice · ${invoiceEditRow?.file_name || ''}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
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
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
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
            <div className="text-xs font-medium text-subtext mb-1">Invoice reference</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={invoiceEditRef} onChange={(e) => setInvoiceEditRef(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Amount</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={invoiceEditAmount} onChange={(e) => setInvoiceEditAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Invoice date (YYYY-MM-DD)</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={invoiceEditDate} onChange={(e) => setInvoiceEditDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Notes</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={invoiceEditNotes} onChange={(e) => setInvoiceEditNotes(e.target.value)} />
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
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
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
              className="inline-flex items-center gap-2 rounded-lg bg-danger-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              onClick={deleteInvoice}
              disabled={invoiceDeleting}
            >
              {invoiceDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-muted">
          This will permanently delete the invoice file and record{invoiceDeleteRow?.file_name ? `: ${invoiceDeleteRow.file_name}` : ''}.
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceUploadOpen}
        onClose={() => {
          if (uploading) return
          setInvoiceUploadOpen(false)
        }}
        title={`Upload Invoice · ${invoiceLoc?.delivery_location || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => setInvoiceUploadOpen(false)}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-success-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
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
            <div className="text-xs font-medium text-subtext mb-1">Invoice file (PDF / JPG / PNG)</div>
            <input
              type="file"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-on-accent hover:file:bg-brand-hover focus:border-brand focus:outline-none"
              accept=".pdf,image/*"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              disabled={uploading}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-subtext mb-1">Invoice reference (optional)</div>
              <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} disabled={uploading} />
            </div>
            <div>
              <div className="text-xs font-medium text-subtext mb-1">Notes (optional)</div>
              <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} disabled={uploading} />
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
