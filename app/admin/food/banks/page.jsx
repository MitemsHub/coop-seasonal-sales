'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
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

function AdminFoodBanksContent() {
  const [rows, setRows] = useState([])
  const [term, setTerm] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankLoc, setBankLoc] = useState(null)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankSaving, setBankSaving] = useState(false)

  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceLoc, setInvoiceLoc] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)

  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceUploadLoc, setInvoiceUploadLoc] = useState(null)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [invoiceUploading, setInvoiceUploading] = useState(false)

  const [paying, setPaying] = useState(false)

  const fetchCtl = useRef(null)
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchRows = async () => {
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const qs = new URLSearchParams()
      if (term) qs.set('term', term)
      const res = await fetch(`/api/admin/food/vendor-banks/locations?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/locations')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setRows(json.locations || [])
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRows()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const t = String(term || '').trim().toLowerCase()
    if (!t) return rows || []
    return (rows || []).filter((r) => {
      const a = `${r.code || ''} ${r.name || ''} ${r.bank?.bank_name || ''} ${r.bank?.account_name || ''} ${r.bank?.account_number || ''}`.toLowerCase()
      return a.includes(t)
    })
  }, [rows, term])

  const loadInvoices = async (loc) => {
    const id = Number(loc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    setInvoiceLoading(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams({ branch_id: String(id) })
      const res = await fetch(`/api/admin/food/vendor-banks/invoices/list?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/invoices/list')
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

  const openBankModal = (loc) => {
    setBankLoc(loc || null)
    setBankName(String(loc?.bank?.bank_name || ''))
    setAccountName(String(loc?.bank?.account_name || ''))
    setAccountNumber(String(loc?.bank?.account_number || ''))
    setBankModalOpen(true)
  }

  const saveBank = async () => {
    const id = Number(bankLoc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (bankSaving) return
    setBankSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/food/vendor-banks/set-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          branch_id: id,
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
        }),
      })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/set-account')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save bank')
      setRows((prev) => (prev || []).map((r) => (Number(r.id) === id ? { ...r, bank: json.bank } : r)))
      setMsg({ type: 'success', text: 'Bank details saved' })
      setBankModalOpen(false)
      setBankLoc(null)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to save bank' })
    } finally {
      setBankSaving(false)
    }
  }

  const openInvoiceUpload = (loc) => {
    setInvoiceUploadLoc(loc || null)
    setInvoiceRef('')
    setInvoiceNotes('')
    setInvoiceFile(null)
    setInvoiceUploadOpen(true)
  }

  const uploadInvoice = async () => {
    const id = Number(invoiceUploadLoc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (!invoiceFile) return
    if (invoiceUploading) return
    setInvoiceUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.set('branch_id', String(id))
      fd.set('invoice_ref', invoiceRef)
      fd.set('notes', invoiceNotes)
      fd.set('file', invoiceFile)
      const res = await fetch('/api/admin/food/vendor-banks/invoices/upload', { method: 'POST', body: fd })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/invoices/upload')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed')
      setRows((prev) =>
        (prev || []).map((r) => (Number(r.id) === id ? { ...r, invoice_count: Number(r.invoice_count || 0) + 1 } : r))
      )
      setMsg({ type: 'success', text: 'Invoice uploaded' })
      setInvoiceUploadOpen(false)
      setInvoiceUploadLoc(null)
      setInvoiceFile(null)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Upload failed' })
    } finally {
      setInvoiceUploading(false)
    }
  }

  const togglePaid = async (loc, nextIsPaid) => {
    const id = Number(loc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (paying) return
    setPaying(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/food/vendor-banks/set-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ branch_id: id, is_paid: !!nextIsPaid, notes: '' }),
      })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/set-paid')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update paid status')
      setRows((prev) =>
        (prev || []).map((r) => (Number(r.id) === id ? { ...r, paid: { ...(r.paid || {}), ...json.paid, is_paid: !!json?.paid?.is_paid } } : r))
      )
      setMsg({ type: 'success', text: nextIsPaid ? 'Marked as Paid' : 'Marked as Unpaid' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update paid status' })
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-semibold">Admin · Food Distribution · Banks</h1>
          <div className="text-xs sm:text-sm text-muted">Cycle-sensitive (uses active cycle)</div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search branch / bank / account"
            className="w-full sm:w-80 px-3 py-2 border rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={fetchRows}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm bg-brand text-on-accent hover:bg-brand-hover disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
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
                <th className="text-left px-3 py-2 border-b">Branch</th>
                <th className="text-left px-3 py-2 border-b">Bank</th>
                <th className="text-left px-3 py-2 border-b">Account Name</th>
                <th className="text-left px-3 py-2 border-b">Account No.</th>
                <th className="text-right px-3 py-2 border-b">Invoices</th>
                <th className="text-left px-3 py-2 border-b">Paid</th>
                <th className="text-right px-3 py-2 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !filtered.length && (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk_${i}`} className="animate-pulse">
                    <td className="px-3 py-3 border-b"><div className="h-4 w-40 bg-muted rounded" /></td>
                    <td className="px-3 py-3 border-b"><div className="h-4 w-28 bg-muted rounded" /></td>
                    <td className="px-3 py-3 border-b"><div className="h-4 w-36 bg-muted rounded" /></td>
                    <td className="px-3 py-3 border-b"><div className="h-4 w-24 bg-muted rounded" /></td>
                    <td className="px-3 py-3 border-b text-right"><div className="h-4 w-10 bg-muted rounded ml-auto" /></td>
                    <td className="px-3 py-3 border-b"><div className="h-4 w-16 bg-muted rounded" /></td>
                    <td className="px-3 py-3 border-b text-right"><div className="h-8 w-28 bg-muted rounded ml-auto" /></td>
                  </tr>
                ))
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    No rows found
                  </td>
                </tr>
              )}

              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-subtle">
                  <td className="px-3 py-2 border-b">
                    <div className="font-medium text-fg">{r.name || '—'}</div>
                    <div className="text-xs text-subtext">{r.code || ''}</div>
                  </td>
                  <td className="px-3 py-2 border-b">{r.bank?.bank_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{r.bank?.account_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{maskAccountNumber(r.bank?.account_number || '')}</td>
                  <td className="px-3 py-2 border-b text-right">{Number(r.invoice_count || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 border-b">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.paid?.is_paid ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted'
                      }`}
                    >
                      {r.paid?.is_paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b text-right">
                    <div className="flex justify-end">
                      <select
                        defaultValue=""
                        className="border border-line rounded-lg px-2 py-1.5 text-xs sm:text-sm bg-surface disabled:opacity-50"
                        onChange={(e) => {
                          const v = e.target.value
                          e.target.value = ''
                          if (!v) return
                          if (v === 'bank') openBankModal(r)
                          if (v === 'upload') openInvoiceUpload(r)
                          if (v === 'invoices') loadInvoices(r)
                          if (v === 'paid') togglePaid(r, true)
                          if (v === 'unpaid') togglePaid(r, false)
                        }}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="bank">Set Bank</option>
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

      <DraggableModal open={invoiceListOpen} onClose={() => setInvoiceListOpen(false)} title={`Invoices · ${invoiceLoc?.name || ''}`}>
        <div className="space-y-3">
          {invoiceLoading ? (
            <div className="text-sm text-muted">Loading…</div>
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
                        Ref: {inv.invoice_ref || '—'} • Date: {inv.invoice_date || '—'} • Amount: {inv.amount != null && inv.amount !== '' ? `₦${Number(inv.amount || 0).toLocaleString()}` : '—'}
                      </div>
                      {inv.notes && <div className="text-xs text-subtext mt-1">{inv.notes}</div>}
                    </div>
                    <div className="shrink-0">
                      {inv.url ? (
                        <a
                          href={inv.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors duration-200 ease-sakani hover:border-line-strong hover:bg-subtle"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-subtext">No link</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DraggableModal>

      <DraggableModal open={bankModalOpen} onClose={() => setBankModalOpen(false)} title={`Bank Details · ${bankLoc?.name || ''}`}>
        <div className="space-y-3">
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={bankSaving}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={bankSaving}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={bankSaving}
          />
          <button
            type="button"
            onClick={saveBank}
            disabled={bankSaving}
            className="px-3 py-2 rounded-lg text-sm bg-brand text-on-accent hover:bg-brand-hover disabled:opacity-50"
          >
            {bankSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </DraggableModal>

      <DraggableModal open={invoiceUploadOpen} onClose={() => setInvoiceUploadOpen(false)} title={`Upload Invoice · ${invoiceUploadLoc?.name || ''}`}>
        <div className="space-y-3">
          <input
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice reference (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={invoiceUploading}
          />
          <textarea
            value={invoiceNotes}
            onChange={(e) => setInvoiceNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            rows={3}
            disabled={invoiceUploading}
          />
          <input
            type="file"
            onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
            className="w-full text-sm"
            disabled={invoiceUploading}
          />
          <button
            type="button"
            onClick={uploadInvoice}
            disabled={invoiceUploading || !invoiceFile}
            className="px-3 py-2 rounded-lg text-sm bg-brand text-on-accent hover:bg-brand-hover disabled:opacity-50"
          >
            {invoiceUploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </DraggableModal>
    </div>
  )
}

export default function AdminFoodBanksPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <AdminFoodBanksContent />
    </ProtectedRoute>
  )
}
