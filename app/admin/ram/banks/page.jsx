'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Button from '../../../components/ui/Button'
import FilePicker from '../../../components/ui/FilePicker'
import DraggableModal from '../../../components/DraggableModal'
import ProtectedRoute from '../../../components/ProtectedRoute'
import AdminBankAccountsModal from '../../../components/AdminBankAccountsModal'
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
  const [banksFor, setBanksFor] = useState(null)

  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceLoc, setInvoiceLoc] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [invoiceUploadBankId, setInvoiceUploadBankId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [accountBusy, setAccountBusy] = useState(0)

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

  const fetchRows = async (silent = false) => {
    const isSilent = silent === true
    const seq = ++fetchSeq.current
    if (!isSilent) {
      setLoading(true)
      setMsg(null)
    }
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
      if (e?.name !== 'AbortError' && !isSilent) {
        setMsg({ type: 'error', text: e?.message || 'Failed to load' })
        setRows([])
      }
    } finally {
      if (seq === fetchSeq.current) {
        if (!isSilent) setLoading(false)
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

  // Keep the list current while it is open: reps attach invoices at any time, so
  // refresh in the background and on return to the tab without the skeleton.
  useEffect(() => {
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      fetchRows(true)
    }
    const id = setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly])

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

  // Mark one account paid or unpaid straight from the list.
  const setAccountPaid = async (row, bank, next) => {
    const accountId = Number(bank?.id)
    const ownerId = Number(row?.id)
    if (!Number.isFinite(accountId) || accountId <= 0 || !Number.isFinite(ownerId) || ownerId <= 0) return
    if (accountBusy) return
    setAccountBusy(accountId)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/vendor-banks/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: 'ram', owner_id: ownerId, account_id: accountId, paid: !!next }),
      })
      const json = await safeJson(res, '/api/admin/vendor-banks/accounts')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update paid status')
      const accounts = json.accounts || []
      setRows((prev) =>
        (prev || []).map((r) => (Number(r.id) === ownerId ? { ...r, banks: accounts, bank: accounts[0] || null } : r))
      )
      setMsg({ type: 'success', text: next ? 'Account marked paid' : 'Account marked unpaid' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update paid status' })
    } finally {
      setAccountBusy(0)
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

  const openUpload = (loc, bankId) => {
    setInvoiceLoc(loc || null)
    setInvoiceRef('')
    setInvoiceNotes('')
    setInvoiceFile(null)
    setInvoiceUploadBankId(String(bankId || loc?.banks?.[0]?.id || ''))
    setInvoiceUploadOpen(true)
  }

  const uploadInvoice = async () => {
    const id = Number(invoiceLoc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (!invoiceFile) return
    if (!invoiceUploadBankId) {
      setMsg({ type: 'error', text: 'Choose the bank account this invoice belongs to.' })
      return
    }
    if (uploading) return
    setUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.set('delivery_location_id', String(id))
      fd.set('bank_account_id', String(invoiceUploadBankId))
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
      await fetchRows()
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
                className="w-full max-w-[420px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                placeholder="Search (location, vendor, bank, account...)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <Button
                onClick={() => fetchRows()}
                loading={loading}
                variant="accent"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </Button>
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
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Bank accounts &amp; invoices</th>
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
                    <td className="p-3"><div className="sakani-skeleton h-20 w-72 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-16 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-8 w-24 rounded" /></td>
                  </tr>
                ))
              ) : !filtered.length ? (
                <tr>
                  <td className="p-10 text-center" colSpan={5}>
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
                  <td className="p-3 align-top">
                    {r.banks?.length ? (
                      <div className="space-y-2">
                        {r.banks.map((b) => (
                          <div key={b.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-fg">{b.bank_name || 'Bank'}</span>
                                {b.is_paid && (
                                  <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold text-success-fg">paid</span>
                                )}
                              </div>
                              <span className="text-[11px] text-subtext">
                                {Number(b.invoices?.length || 0).toLocaleString()} invoice
                                {Number(b.invoices?.length || 0) === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-subtext sm:grid-cols-2">
                              <div>Account name: <span className="text-fg">{b.account_name || '—'}</span></div>
                              <div>Account no: <span className="font-mono text-fg">{b.account_number || '—'}</span></div>
                            </div>
                            {b.purpose && (
                              <div className="text-xs text-subtext">Purpose: <span className="text-fg">{b.purpose}</span></div>
                            )}
                            <div className="mt-1.5 border-t border-line pt-1.5">
                              {b.invoices?.length ? (
                                <div className="space-y-0.5">
                                  {b.invoices.map((inv) => (
                                    <div key={inv.id} className="flex items-center justify-between gap-3 text-xs">
                                      {inv.url ? (
                                        <a
                                          href={inv.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="min-w-0 truncate text-brand hover:underline"
                                          title={inv.file_name || 'Invoice'}
                                        >
                                          {inv.file_name || 'Invoice'}
                                        </a>
                                      ) : (
                                        <span className="min-w-0 truncate text-fg">{inv.file_name || 'Invoice'}</span>
                                      )}
                                      <span className="shrink-0 font-medium text-fg">
                                        {inv.amount != null ? `₦${Number(inv.amount).toLocaleString()}` : '—'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-subtext">No invoices filed against this account.</div>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 border-t border-line pt-1.5 text-xs">
                              <button
                                type="button"
                                onClick={() => openUpload(r, b.id)}
                                disabled={!!b.is_paid}
                                className="font-semibold text-brand hover:underline disabled:opacity-40"
                              >
                                Upload invoice
                              </button>
                              <button
                                type="button"
                                onClick={() => setAccountPaid(r, b, !b.is_paid)}
                                disabled={accountBusy === Number(b.id)}
                                className="font-semibold text-fg hover:underline disabled:opacity-40"
                              >
                                {accountBusy === Number(b.id) ? 'Saving…' : b.is_paid ? 'Mark unpaid' : 'Mark paid'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setBanksFor(r)}
                                className="text-muted hover:underline"
                              >
                                Edit / remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
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
                          if (v === 'banks') setBanksFor(r)
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
                        <option value="banks">Manage banks ({r.banks?.length || 0})</option>
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
            <Button
              variant="secondary"
              onClick={() => {
                setBankModalOpen(false)
                setBankLoc(null)
              }}
              disabled={savingBank}
            >
              Cancel
            </Button>
            <Button
              onClick={saveBank}
              loading={savingBank}
            >
              {savingBank ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Bank</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Account Name</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Account Number</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      </DraggableModal>

      <AdminBankAccountsModal
        open={!!banksFor}
        onClose={() => setBanksFor(null)}
        module="ram"
        ownerId={banksFor?.id}
        ownerName={banksFor?.delivery_location}
        onChanged={fetchRows}
      />

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
            <Button
              variant="secondary"
              onClick={() => setInvoiceListOpen(false)}
            >
              Close
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditInvoice(inv)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => confirmDeleteInvoice(inv)}
                          leftIcon={Trash2}
                        >
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
            <Button
              variant="secondary"
              onClick={() => {
                setInvoiceEditOpen(false)
                setInvoiceEditRow(null)
              }}
              disabled={invoiceSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={saveInvoiceEdits}
              loading={invoiceSaving}
            >
              {invoiceSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Invoice reference</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={invoiceEditRef} onChange={(e) => setInvoiceEditRef(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Amount</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={invoiceEditAmount} onChange={(e) => setInvoiceEditAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Invoice date (YYYY-MM-DD)</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={invoiceEditDate} onChange={(e) => setInvoiceEditDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Notes</div>
            <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={invoiceEditNotes} onChange={(e) => setInvoiceEditNotes(e.target.value)} />
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
            <Button
              variant="secondary"
              onClick={() => {
                setInvoiceDeleteOpen(false)
                setInvoiceDeleteRow(null)
              }}
              disabled={invoiceDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={deleteInvoice}
              loading={invoiceDeleting}
            >
              {invoiceDeleting ? 'Deleting…' : 'Delete'}
            </Button>
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
            <Button
              variant="secondary"
              onClick={() => setInvoiceUploadOpen(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              onClick={uploadInvoice}
              loading={uploading}
              disabled={!invoiceFile}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Bank account this invoice was paid into</div>
            <select
              value={invoiceUploadBankId}
              onChange={(e) => setInvoiceUploadBankId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              disabled={uploading}
            >
              <option value="">Select the bank account…</option>
              {(invoiceLoc?.banks || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bank_name || 'Bank'} · {b.account_name || ''} · {maskAccountNumber(b.account_number || '')}
                  {b.purpose ? ` — ${b.purpose}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs font-medium text-subtext mb-1">Invoice file (PDF / JPG / PNG)</div>
            <FilePicker
              value={invoiceFile}
              onChange={setInvoiceFile}
              accept=".pdf,image/*"
              disabled={uploading}
              hint="PDF, JPG or PNG of the invoice."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-subtext mb-1">Invoice reference (optional)</div>
              <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} disabled={uploading} />
            </div>
            <div>
              <div className="text-xs font-medium text-subtext mb-1">Notes (optional)</div>
              <input className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} disabled={uploading} />
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
