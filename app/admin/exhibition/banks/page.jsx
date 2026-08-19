'use client'

// app/admin/exhibition/banks/page.jsx
// Exhibition vendor bank accounts — the co-op's record of where to pay each
// vendor stand after a season. One current account per vendor per cycle, plus
// the uploaded payout invoices for each vendor (mirrors the ram banks page).
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Store, Trash2 } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DraggableModal from '../../../components/DraggableModal'
import Button from '../../../components/ui/Button'
import Select from '../../../components/ui/Select'
import Skeleton from '../../../components/ui/Skeleton'

const PAGE_SIZE = 15

const toastMotion = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function maskAccountNumber(s) {
  const v = String(s || '').replace(/\D/g, '')
  if (!v) return '—'
  if (v.length <= 4) return v
  return `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
}

function AdminExhibitionBanksContent() {
  const [vendors, setVendors] = useState([])
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [term, setTerm] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)

  const [modalOpen, setModalOpen] = useState(false)
  const [bankVendor, setBankVendor] = useState(null)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')

  // Invoice state (mirrors the ram banks page)
  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceLoc, setInvoiceLoc] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [uploading, setUploading] = useState(false)

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
  const safeJson = useCallback(async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }, [])

  const loadCycles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/exhibition/cycles', { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/exhibition/cycles')
      if (json?.ok) {
        const list = json.cycles || []
        setCycles(list)
        if (!cycleId) {
          const active = list.find((c) => c.status === 'active') || list[0]
          if (active) setCycleId(String(active.id))
        }
      }
    } catch {
      setCycles([])
    }
  }, [cycleId, safeJson])

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const qs = new URLSearchParams()
      if (cycleId) qs.set('cycle_id', cycleId)
      if (term.trim()) qs.set('q', term.trim())
      const res = await fetch(`/api/admin/exhibition/vendor-banks/vendors?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/exhibition/vendor-banks/vendors')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setVendors(json.vendors || [])
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setVendors([])
    } finally {
      setLoading(false)
    }
  }, [cycleId, term, safeJson])

  useEffect(() => {
    loadCycles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId])

  const filtered = useMemo(() => {
    const t = String(term || '').trim().toLowerCase()
    if (!t) return vendors
    return vendors.filter((v) => {
      const a = `${v.name || ''} ${v.code || ''} ${v.phone || ''} ${v.branch_name || ''} ${v.bank?.bank_name || ''} ${v.bank?.account_name || ''} ${v.bank?.account_number || ''}`.toLowerCase()
      return a.includes(t)
    })
  }, [vendors, term])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const paged = useMemo(() => {
    if (safePage <= 0) return []
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const openBank = (v) => {
    setBankVendor(v)
    setBankName(String(v.bank?.bank_name || ''))
    setAccountName(String(v.bank?.account_name || ''))
    setAccountNumber(String(v.bank?.account_number || ''))
    setModalOpen(true)
  }

  const saveBank = async () => {
    const id = Number(bankVendor?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (saving) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/vendor-banks/set-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          vendor_id: id,
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
        }),
      })
      const json = await safeJson(res, '/api/admin/exhibition/vendor-banks/set-account')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setVendors((prev) => (prev || []).map((v) => (Number(v.id) === id ? { ...v, bank: json.bank } : v)))
      setMsg({ type: 'success', text: 'Bank details saved' })
      setModalOpen(false)
      setBankVendor(null)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const loadInvoices = async (v) => {
    const id = Number(v?.id)
    if (!Number.isFinite(id) || id <= 0) return
    setInvoiceLoading(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams({ vendor_id: String(id) })
      if (cycleId) qs.set('cycle_id', cycleId)
      const res = await fetch(`/api/admin/exhibition/vendor-banks/invoices/list?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/exhibition/vendor-banks/invoices/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load invoices')
      setInvoices(json.invoices || [])
      setInvoiceLoc(v || null)
      setInvoiceListOpen(true)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to load invoices' })
      setInvoices([])
    } finally {
      setInvoiceLoading(false)
    }
  }

  const openUpload = (v) => {
    setInvoiceLoc(v || null)
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
      fd.set('vendor_id', String(id))
      fd.set('invoice_ref', invoiceRef)
      fd.set('notes', invoiceNotes)
      fd.set('file', invoiceFile)
      const res = await fetch('/api/admin/exhibition/vendor-banks/invoices/upload', { method: 'POST', body: fd })
      const json = await safeJson(res, '/api/admin/exhibition/vendor-banks/invoices/upload')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed')
      setVendors((prev) => (prev || []).map((r) => (Number(r.id) === id ? { ...r, invoice_count: Number(r.invoice_count || 0) + 1 } : r)))
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
      const res = await fetch('/api/admin/exhibition/vendor-banks/invoices/update', {
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
      const json = await safeJson(res, '/api/admin/exhibition/vendor-banks/invoices/update')
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
      const res = await fetch(`/api/admin/exhibition/vendor-banks/invoices/delete?invoice_id=${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      const json = await safeJson(res, '/api/admin/exhibition/vendor-banks/invoices/delete')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to delete')
      setInvoices((prev) => (prev || []).filter((r) => Number(r.id) !== id))
      const locId = Number(invoiceLoc?.id)
      if (Number.isFinite(locId) && locId > 0) {
        setVendors((prev) =>
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-semibold">Admin · Coop Exhibition · Banks</h1>
          <div className="text-xs sm:text-sm text-muted">Vendor payout accounts and invoices per exhibition season</div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:items-center">
          <Select value={cycleId} onChange={(e) => { setCycleId(e.target.value); setPage(1) }} className="sm:w-60">
            <option value="">All cycles</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </Select>
          <input
            value={term}
            onChange={(e) => { setTerm(e.target.value); setPage(1) }}
            placeholder="Search vendor / bank / account"
            className="w-full sm:w-72 px-3 py-2 border border-line rounded-lg text-sm bg-surface"
          />
          <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {msg && (
          <motion.div
            {...toastMotion}
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              msg.type === 'error' ? 'bg-danger-bg text-danger-fg border-danger-border' : 'bg-success-bg text-success-fg border-success-border'
            }`}
          >
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="text-left px-3 py-2 border-b">Vendor</th>
                <th className="text-left px-3 py-2 border-b">Branch</th>
                <th className="text-left px-3 py-2 border-b">Bank</th>
                <th className="text-left px-3 py-2 border-b">Account Name</th>
                <th className="text-left px-3 py-2 border-b">Account No.</th>
                <th className="text-center px-3 py-2 border-b">Invoices</th>
                <th className="text-right px-3 py-2 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !filtered.length && (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk_${i}`}>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-40" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-3 py-3 border-b text-center"><Skeleton className="mx-auto h-4 w-8" /></td>
                    <td className="px-3 py-3 border-b text-right"><Skeleton className="ml-auto h-8 w-24" /></td>
                  </tr>
                ))
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center">
                    <Store className="mx-auto mb-2 h-8 w-8 text-muted" strokeWidth={1.5} />
                    <p className="text-sm text-muted">No vendors found{cycleId ? ' for this cycle' : ''}.</p>
                  </td>
                </tr>
              )}

              {paged.map((v) => (
                <tr key={v.id} className="hover:bg-subtle">
                  <td className="px-3 py-2 border-b">
                    <div className="font-medium text-fg">{v.name || '—'}</div>
                    <div className="font-mono text-xs text-subtext">{v.code}</div>
                    <div className="text-xs text-subtext">{v.phone || ''}</div>
                  </td>
                  <td className="px-3 py-2 border-b text-muted">{v.branch_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{v.bank?.bank_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{v.bank?.account_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{maskAccountNumber(v.bank?.account_number || '')}</td>
                  <td className="px-3 py-2 border-b text-center">
                    {Number(v.invoice_count || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => loadInvoices(v)}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2.5 py-0.5 text-xs font-semibold text-brand hover:brightness-95"
                        title="View invoices"
                      >
                        {Number(v.invoice_count || 0).toLocaleString()}
                      </button>
                    ) : (
                      <span className="text-muted text-xs">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 border-b text-right">
                    <select
                      defaultValue=""
                      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg focus:border-brand focus:outline-none disabled:opacity-50"
                      disabled={loading}
                      onChange={(e) => {
                        const act = e.target.value
                        e.target.value = ''
                        if (!act) return
                        if (act === 'bank') openBank(v)
                        if (act === 'upload') openUpload(v)
                        if (act === 'invoices') loadInvoices(v)
                      }}
                    >
                      <option value="" disabled>Actions</option>
                      <option value="bank">{v.bank ? 'Edit bank' : 'Set bank'}</option>
                      <option value="upload">Upload Invoice</option>
                      <option value="invoices">View Invoices</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
            <span className="text-xs text-muted">
              {filtered.length.toLocaleString()} vendor{filtered.length === 1 ? '' : 's'} · Page {safePage} of {pageCount.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" leftIcon={ChevronLeft} disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </Button>
              <Button variant="ghost" size="sm" rightIcon={ChevronRight} disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <DraggableModal open={modalOpen} onClose={() => setModalOpen(false)} title={`Bank Details · ${bankVendor?.name || ''}`}>
        <div className="space-y-3">
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={saving}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={saving}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            inputMode="numeric"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={saving}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveBank}>
              Save
            </Button>
          </div>
        </div>
      </DraggableModal>

      {/* Invoices list */}
      <DraggableModal
        open={invoiceListOpen}
        onClose={() => {
          if (invoiceLoading) return
          setInvoiceListOpen(false)
        }}
        title={`Invoices · ${invoiceLoc?.name || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInvoiceListOpen(false)}>
              Close
            </Button>
            <Button leftIcon={Trash2} variant="brand" onClick={() => { setInvoiceListOpen(false); openUpload(invoiceLoc) }}>
              Upload Invoice
            </Button>
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
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Amount</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Uploaded</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!invoices.length && (
                  <tr>
                    <td className="p-2 text-muted" colSpan={5}>
                      {invoiceLoading ? 'Loading…' : 'No invoices uploaded for this vendor.'}
                    </td>
                  </tr>
                )}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-line last:border-b-0 hover:bg-subtle">
                    <td className="p-2">
                      <div className="font-medium text-fg">{inv.file_name}</div>
                      <div className="text-xs text-subtext">{inv.mime_type}</div>
                    </td>
                    <td className="p-2">{inv.invoice_ref || '—'}</td>
                    <td className="p-2">{inv.amount != null ? Number(inv.amount).toLocaleString() : '—'}</td>
                    <td className="p-2">{inv.created_at ? new Date(inv.created_at).toLocaleString() : ''}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        {inv.url ? (
                          <a href={inv.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover">
                            Open
                          </a>
                        ) : (
                          <span className="text-subtext">—</span>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => openEditInvoice(inv)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" leftIcon={Trash2} onClick={() => confirmDeleteInvoice(inv)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DraggableModal>

      {/* Upload invoice */}
      <DraggableModal
        open={invoiceUploadOpen}
        onClose={() => {
          if (uploading) return
          setInvoiceUploadOpen(false)
        }}
        title={`Upload Invoice · ${invoiceLoc?.name || 'Vendor'}`}
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInvoiceUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button loading={uploading} disabled={uploading || !invoiceFile} onClick={uploadInvoice}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-muted mb-1">Invoice file (PDF / JPG / PNG)</div>
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
              <div className="text-xs font-medium text-muted mb-1">Invoice reference (optional)</div>
              <input
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-muted mb-1">Notes (optional)</div>
              <input
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                disabled={uploading}
              />
            </div>
          </div>
        </div>
      </DraggableModal>

      {/* Edit invoice */}
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
            <Button variant="secondary" onClick={() => { setInvoiceEditOpen(false); setInvoiceEditRow(null) }} disabled={invoiceSaving}>
              Cancel
            </Button>
            <Button loading={invoiceSaving} onClick={saveInvoiceEdits}>
              Save
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-medium text-muted mb-1">Invoice reference</div>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={invoiceEditRef}
              onChange={(e) => setInvoiceEditRef(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted mb-1">Amount</div>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={invoiceEditAmount}
              onChange={(e) => setInvoiceEditAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted mb-1">Invoice date (YYYY-MM-DD)</div>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={invoiceEditDate}
              onChange={(e) => setInvoiceEditDate(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted mb-1">Notes</div>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={invoiceEditNotes}
              onChange={(e) => setInvoiceEditNotes(e.target.value)}
            />
          </div>
        </div>
      </DraggableModal>

      {/* Delete invoice */}
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
            <Button variant="secondary" onClick={() => { setInvoiceDeleteOpen(false); setInvoiceDeleteRow(null) }} disabled={invoiceDeleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={invoiceDeleting} onClick={deleteInvoice}>
              {invoiceDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-muted">
          This will permanently delete the invoice file and record{invoiceDeleteRow?.file_name ? `: ${invoiceDeleteRow.file_name}` : ''}.
        </div>
      </DraggableModal>
    </div>
  )
}

export default function AdminExhibitionBanksPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <AdminExhibitionBanksContent />
    </ProtectedRoute>
  )
}
