'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import DraggableModal from '../../components/DraggableModal'
import ProtectedRoute from '../../components/ProtectedRoute'

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

function RepFoodBanksContent() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [cycle, setCycle] = useState(null)
  const [branch, setBranch] = useState(null)
  const [bank, setBank] = useState(null)
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [paid, setPaid] = useState({ is_paid: false, paid_at: null })

  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [savingBank, setSavingBank] = useState(false)

  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoices, setInvoices] = useState([])
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
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchLocation = async () => {
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const res = await fetch('/api/rep/food/vendor-banks/location', { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/rep/food/vendor-banks/location')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setCycle(json.cycle || null)
      setBranch(json.branch || null)
      setBank(json.bank || null)
      setInvoiceCount(Number(json.invoice_count || 0))
      setPaid(json.paid || { is_paid: false, paid_at: null })
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setCycle(null)
      setBranch(null)
      setBank(null)
      setInvoiceCount(0)
      setPaid({ is_paid: false, paid_at: null })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLocation()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openBank = () => {
    setBankName(String(bank?.bank_name || ''))
    setAccountName(String(bank?.account_name || ''))
    setAccountNumber(String(bank?.account_number || ''))
    setBankModalOpen(true)
  }

  const saveBank = async () => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (savingBank) return
    setSavingBank(true)
    setMsg(null)
    try {
      const res = await fetch('/api/rep/food/vendor-banks/set-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
        }),
      })
      const json = await safeJson(res, '/api/rep/food/vendor-banks/set-account')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setBank(json.bank || null)
      setMsg({ type: 'success', text: 'Bank details saved' })
      setBankModalOpen(false)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to save' })
    } finally {
      setSavingBank(false)
    }
  }

  const loadInvoices = async () => {
    setInvoiceLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/rep/food/vendor-banks/invoices/list', { cache: 'no-store' })
      const json = await safeJson(res, '/api/rep/food/vendor-banks/invoices/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load invoices')
      setInvoices(json.invoices || [])
      setInvoiceListOpen(true)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to load invoices' })
      setInvoices([])
    } finally {
      setInvoiceLoading(false)
    }
  }

  const openUpload = () => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    setInvoiceRef('')
    setInvoiceNotes('')
    setInvoiceFile(null)
    setInvoiceUploadOpen(true)
  }

  const uploadInvoice = async () => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (!invoiceFile) return
    if (uploading) return
    setUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.set('invoice_ref', invoiceRef)
      fd.set('notes', invoiceNotes)
      fd.set('file', invoiceFile)
      const res = await fetch('/api/rep/food/vendor-banks/invoices/upload', { method: 'POST', body: fd })
      const json = await safeJson(res, '/api/rep/food/vendor-banks/invoices/upload')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed')
      setInvoiceUploadOpen(false)
      setInvoiceFile(null)
      setInvoiceCount((n) => n + 1)
      await loadInvoices()
      setMsg({ type: 'success', text: 'Invoice uploaded' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  const openEditInvoice = (inv) => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
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
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (invoiceSaving) return
    setInvoiceSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/rep/food/vendor-banks/invoices/update', {
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
      const json = await safeJson(res, '/api/rep/food/vendor-banks/invoices/update')
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

  const openDeleteInvoice = (inv) => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    setInvoiceDeleteRow(inv || null)
    setInvoiceDeleteOpen(true)
  }

  const deleteInvoice = async () => {
    const id = Number(invoiceDeleteRow?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (invoiceDeleting) return
    setInvoiceDeleting(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams({ invoice_id: String(id) })
      const res = await fetch(`/api/rep/food/vendor-banks/invoices/delete?${qs.toString()}`, { method: 'DELETE' })
      const json = await safeJson(res, '/api/rep/food/vendor-banks/invoices/delete')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Delete failed')
      setInvoices((prev) => (prev || []).filter((r) => Number(r.id) !== id))
      setInvoiceDeleteOpen(false)
      setInvoiceDeleteRow(null)
      setInvoiceCount((n) => Math.max(0, n - 1))
      setMsg({ type: 'success', text: 'Invoice deleted' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Delete failed' })
    } finally {
      setInvoiceDeleting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · Banks</h1>
          <div className="text-xs sm:text-sm text-muted">
            {cycle?.name ? `Cycle: ${cycle.name} (${cycle.code || ''})` : 'Cycle-sensitive (uses active cycle)'}
          </div>
        </div>
        <button
          type="button"
          onClick={fetchLocation}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
          aria-busy={loading}
        >
          {loading && <Spinner className="h-4 w-4 text-on-accent" />}
          <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      <AnimatePresence>
        {msg && (
          <motion.div
            {...toastMotion}
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
            }`}
          >
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-3">
        <div className="ui-card p-4">
          {loading && !branch ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-5 w-64 sakani-skeleton rounded" />
              <div className="h-4 w-40 sakani-skeleton rounded" />
              <div className="h-4 w-56 sakani-skeleton rounded" />
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-muted">Delivery Location</div>
                  <div className="text-[15px] font-semibold text-fg">{branch?.name || '—'}</div>
                  <div className="text-xs text-muted">{branch?.code || ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted">Status</div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      paid?.is_paid ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted'
                    }`}
                  >
                    {paid?.is_paid ? 'Paid (Locked)' : 'Unpaid'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="border rounded-lg p-3">
                  <div className="text-sm font-medium text-fg mb-1">Bank Details</div>
                  <div className="text-xs text-muted">Bank: {bank?.bank_name || '—'}</div>
                  <div className="text-xs text-muted">Account Name: {bank?.account_name || '—'}</div>
                  <div className="text-xs text-muted">Account No.: {maskAccountNumber(bank?.account_number || '')}</div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={openBank}
                      disabled={paid?.is_paid}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
                    >
                      Edit Bank Details
                    </button>
                  </div>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="text-sm font-medium text-fg mb-1">Invoices</div>
                  <div className="text-xs text-muted">Uploaded: {Number(invoiceCount || 0).toLocaleString()}</div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={loadInvoices}
                      disabled={invoiceLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
                      aria-busy={invoiceLoading}
                    >
                      {invoiceLoading && <Spinner className="h-4 w-4 text-on-accent" />}
                      <span>{invoiceLoading ? 'Loading…' : 'View Invoices'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={openUpload}
                      disabled={paid?.is_paid}
                      className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                    >
                      Upload Invoice
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <DraggableModal open={bankModalOpen} onClose={() => setBankModalOpen(false)} title="Bank Details">
        <div className="space-y-3">
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={savingBank || paid?.is_paid}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={savingBank || paid?.is_paid}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={savingBank || paid?.is_paid}
          />
          <button
            type="button"
            onClick={saveBank}
            disabled={savingBank || paid?.is_paid}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-2"
            aria-busy={savingBank}
          >
            {savingBank && <Spinner className="h-4 w-4 text-on-accent" />}
            <span>{savingBank ? 'Saving…' : 'Save'}</span>
          </button>
        </div>
      </DraggableModal>

      <DraggableModal open={invoiceListOpen} onClose={() => setInvoiceListOpen(false)} title="Invoices">
        <div className="space-y-3">
          {invoiceLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={`inv_sk_${i}`} className="border rounded-lg p-3 bg-surface animate-pulse">
                  <div className="h-4 w-56 sakani-skeleton rounded" />
                  <div className="mt-2 h-3 w-72 sakani-skeleton rounded" />
                  <div className="mt-2 h-3 w-48 sakani-skeleton rounded" />
                </div>
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-sm text-muted">No invoices uploaded.</div>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="border rounded-lg p-3 bg-surface">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-fg truncate">{inv.file_name || 'Invoice'}</div>
                      <div className="text-xs text-muted">
                        Ref: {inv.invoice_ref || '—'} • Date: {inv.invoice_date || '—'} • Amount:{' '}
                        {inv.amount != null && inv.amount !== '' ? `₦${Number(inv.amount || 0).toLocaleString()}` : '—'}
                      </div>
                      {inv.notes && <div className="text-xs text-muted mt-1">{inv.notes}</div>}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {inv.url ? (
                        <a
                          href={inv.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-muted">No link</span>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditInvoice(inv)}
                        disabled={paid?.is_paid}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeleteInvoice(inv)}
                        disabled={paid?.is_paid}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-danger-fg px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DraggableModal>

      <DraggableModal open={invoiceUploadOpen} onClose={() => setInvoiceUploadOpen(false)} title="Upload Invoice">
        <div className="space-y-3">
          <input
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice reference (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={uploading || paid?.is_paid}
          />
          <textarea
            value={invoiceNotes}
            onChange={(e) => setInvoiceNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            rows={3}
            disabled={uploading || paid?.is_paid}
          />
          <input
            type="file"
            onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
            className="w-full text-sm"
            disabled={uploading || paid?.is_paid}
          />
          <button
            type="button"
            onClick={uploadInvoice}
            disabled={uploading || paid?.is_paid || !invoiceFile}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-2"
            aria-busy={uploading}
          >
            {uploading && <Spinner className="h-4 w-4 text-on-accent" />}
            <span>{uploading ? 'Uploading…' : 'Upload'}</span>
          </button>
        </div>
      </DraggableModal>

      <DraggableModal open={invoiceEditOpen} onClose={() => setInvoiceEditOpen(false)} title="Edit Invoice">
        <div className="space-y-3">
          <input
            value={invoiceEditRef}
            onChange={(e) => setInvoiceEditRef(e.target.value)}
            placeholder="Invoice reference"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={invoiceSaving || paid?.is_paid}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={invoiceEditDate}
              onChange={(e) => setInvoiceEditDate(e.target.value)}
              placeholder="Invoice date (YYYY-MM-DD)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              disabled={invoiceSaving || paid?.is_paid}
            />
            <input
              value={invoiceEditAmount}
              onChange={(e) => setInvoiceEditAmount(e.target.value)}
              placeholder="Amount (optional)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              disabled={invoiceSaving || paid?.is_paid}
            />
          </div>
          <textarea
            value={invoiceEditNotes}
            onChange={(e) => setInvoiceEditNotes(e.target.value)}
            placeholder="Notes"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            rows={3}
            disabled={invoiceSaving || paid?.is_paid}
          />
          <button
            type="button"
            onClick={saveInvoiceEdits}
            disabled={invoiceSaving || paid?.is_paid}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-2"
            aria-busy={invoiceSaving}
          >
            {invoiceSaving && <Spinner className="h-4 w-4 text-on-accent" />}
            <span>{invoiceSaving ? 'Saving…' : 'Save'}</span>
          </button>
        </div>
      </DraggableModal>

      <DraggableModal open={invoiceDeleteOpen} onClose={() => setInvoiceDeleteOpen(false)} title="Delete Invoice">
        <div className="space-y-3">
          <div className="text-sm text-subtext">
            Delete <span className="font-medium">{invoiceDeleteRow?.file_name || 'this invoice'}</span>?
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={deleteInvoice}
              disabled={invoiceDeleting || paid?.is_paid}
              className="inline-flex items-center gap-2 rounded-lg bg-danger-fg px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              aria-busy={invoiceDeleting}
            >
              {invoiceDeleting && <Spinner className="h-4 w-4 text-on-accent" />}
              <span>{invoiceDeleting ? 'Deleting…' : 'Delete'}</span>
            </button>
            <button
              type="button"
              onClick={() => setInvoiceDeleteOpen(false)}
              disabled={invoiceDeleting}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </DraggableModal>
    </div>
  )
}

export default function RepFoodBanksPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepFoodBanksContent />
    </ProtectedRoute>
  )
}
