'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import DraggableModal from '../../../components/DraggableModal'
import Button from '../../../components/ui/Button'
import FilePicker from '../../../components/ui/FilePicker'
import ProtectedRoute from '../../../components/ProtectedRoute'
import AdminBankAccountsModal from '../../../components/AdminBankAccountsModal'

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
  const [banksFor, setBanksFor] = useState(null)

  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceLoc, setInvoiceLoc] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)

  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceUploadLoc, setInvoiceUploadLoc] = useState(null)
  const [invoiceUploadBankId, setInvoiceUploadBankId] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [invoiceUploading, setInvoiceUploading] = useState(false)
  const [accountBusy, setAccountBusy] = useState(0)
  const [accountDeleting, setAccountDeleting] = useState(0)

  const [topBranchId, setTopBranchId] = useState('')
  const [addBankOpen, setAddBankOpen] = useState(false)
  const [addBankBranchId, setAddBankBranchId] = useState('')
  const [addBankName, setAddBankName] = useState('')
  const [addBankAccountName, setAddBankAccountName] = useState('')
  const [addBankAccountNumber, setAddBankAccountNumber] = useState('')
  const [addBankPurpose, setAddBankPurpose] = useState('')
  const [addBankSaving, setAddBankSaving] = useState(false)
  const [addBankErr, setAddBankErr] = useState('')

  const [invoiceEditOpen, setInvoiceEditOpen] = useState(false)
  const [invoiceEditRow, setInvoiceEditRow] = useState(null)
  const [invoiceEditRef, setInvoiceEditRef] = useState('')
  const [invoiceEditDate, setInvoiceEditDate] = useState('')
  const [invoiceEditAmount, setInvoiceEditAmount] = useState('')
  const [invoiceEditNotes, setInvoiceEditNotes] = useState('')
  const [invoiceEditSaving, setInvoiceEditSaving] = useState(false)

  const [invoiceDeleteOpen, setInvoiceDeleteOpen] = useState(false)
  const [invoiceDeleteRow, setInvoiceDeleteRow] = useState(null)
  const [invoiceDeleting, setInvoiceDeleting] = useState(false)

  const [paying, setPaying] = useState(false)

  const fetchCtl = useRef(null)
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchRows = async (silent = false) => {
    const isSilent = silent === true
    if (!isSilent) {
      setLoading(true)
      setMsg(null)
    }
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
      if (e?.name !== 'AbortError' && !isSilent) {
        setMsg({ type: 'error', text: e?.message || 'Failed to load' })
        setRows([])
      }
    } finally {
      if (!isSilent) setLoading(false)
    }
  }

  useEffect(() => {
    fetchRows()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reps file invoices while an admin has this screen open, so poll quietly in
  // the background and refresh on return to the tab instead of flashing the table.
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
  }, [term])

  const filtered = useMemo(() => {
    const t = String(term || '').trim().toLowerCase()
    if (!t) return rows || []
    return (rows || []).filter((r) => {
      const a = `${r.code || ''} ${r.name || ''} ${r.bank?.bank_name || ''} ${r.bank?.account_name || ''} ${r.bank?.account_number || ''}`.toLowerCase()
      return a.includes(t)
    })
  }, [rows, term])

  // Mark a single account paid or unpaid straight from the list.
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
        body: JSON.stringify({ module: 'food', owner_id: ownerId, account_id: accountId, paid: !!next }),
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

  const deleteAccount = async (row, bank) => {
    const accountId = Number(bank?.id)
    const ownerId = Number(row?.id)
    if (!Number.isFinite(accountId) || accountId <= 0 || !Number.isFinite(ownerId) || ownerId <= 0) return
    if (bank?.is_paid) {
      setMsg({ type: 'error', text: 'Mark this account unpaid before removing it.' })
      return
    }
    if (typeof window !== 'undefined') {
      const label = `${bank?.bank_name || 'this account'}${bank?.account_number ? ` · ${bank.account_number}` : ''}`
      if (!window.confirm(`Remove ${label}? Its invoices stay on the branch and can be filed to another account.`)) return
    }
    setAccountDeleting(accountId)
    setMsg(null)
    try {
      const qs = new URLSearchParams({ module: 'food', owner_id: String(ownerId), account_id: String(accountId) })
      const res = await fetch(`/api/admin/vendor-banks/accounts?${qs.toString()}`, { method: 'DELETE' })
      const json = await safeJson(res, '/api/admin/vendor-banks/accounts')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to remove account')
      const accounts = json.accounts || []
      setRows((prev) =>
        (prev || []).map((r) => (Number(r.id) === ownerId ? { ...r, banks: accounts, bank: accounts[0] || null } : r))
      )
      setMsg({ type: 'success', text: 'Account removed' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to remove account' })
    } finally {
      setAccountDeleting(0)
    }
  }

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

  const copyAccountNumber = async (value) => {
    try {
      await navigator.clipboard.writeText(String(value || ''))
      setMsg({ type: 'success', text: 'Account number copied' })
    } catch {
      setMsg({ type: 'error', text: 'Could not copy the account number' })
    }
  }

  const openAddBank = (branchId) => {
    setAddBankBranchId(String(branchId || topBranchId || ''))
    setAddBankName('')
    setAddBankAccountName('')
    setAddBankAccountNumber('')
    setAddBankPurpose('')
    setAddBankErr('')
    setAddBankOpen(true)
  }

  const saveNewBank = async () => {
    const ownerId = Number(addBankBranchId)
    if (!Number.isFinite(ownerId) || ownerId <= 0) {
      setAddBankErr('Choose the branch this account belongs to.')
      return
    }
    if (!addBankName.trim() || !addBankAccountName.trim() || !addBankAccountNumber.trim()) {
      setAddBankErr('Bank name, account name and account number are all required.')
      return
    }
    if (addBankSaving) return
    setAddBankSaving(true)
    setAddBankErr('')
    try {
      const res = await fetch('/api/admin/vendor-banks/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'food',
          owner_id: ownerId,
          bank_name: addBankName,
          account_name: addBankAccountName,
          account_number: addBankAccountNumber,
          purpose: addBankPurpose,
        }),
      })
      const json = await safeJson(res, '/api/admin/vendor-banks/accounts')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to add bank account')
      setAddBankOpen(false)
      setTopBranchId(String(ownerId))
      setMsg({ type: 'success', text: 'Bank account added' })
      await fetchRows()
    } catch (e) {
      setAddBankErr(e?.message || 'Failed to add bank account')
    } finally {
      setAddBankSaving(false)
    }
  }

  const openTopInvoiceUpload = () => {
    const loc = (rows || []).find((r) => Number(r.id) === Number(topBranchId))
    if (!loc) {
      setMsg({ type: 'error', text: 'Choose the branch to upload this invoice for.' })
      return
    }
    if (!loc.banks?.length) {
      setMsg({ type: 'error', text: 'That branch has no bank account yet. Add one first.' })
      return
    }
    openInvoiceUpload(loc, loc.banks[0]?.id)
  }

  const openInvoiceUpload = (loc, bankId) => {
    setInvoiceUploadLoc(loc || null)
    setInvoiceUploadBankId(String(bankId || loc?.banks?.[0]?.id || ''))
    setInvoiceRef('')
    setInvoiceNotes('')
    setInvoiceFile(null)
    setInvoiceUploadOpen(true)
  }

  const uploadInvoice = async () => {
    const id = Number(invoiceUploadLoc?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (!invoiceFile) return
    if (!invoiceUploadBankId) {
      setMsg({ type: 'error', text: 'Choose the bank account this invoice belongs to.' })
      return
    }
    if (invoiceUploading) return
    setInvoiceUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.set('branch_id', String(id))
      fd.set('bank_account_id', String(invoiceUploadBankId))
      fd.set('invoice_ref', invoiceRef)
      fd.set('notes', invoiceNotes)
      fd.set('file', invoiceFile)
      const res = await fetch('/api/admin/food/vendor-banks/invoices/upload', { method: 'POST', body: fd })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/invoices/upload')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed')
      setMsg({ type: 'success', text: 'Invoice uploaded' })
      setInvoiceUploadOpen(false)
      setInvoiceUploadLoc(null)
      setInvoiceFile(null)
      await fetchRows()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Upload failed' })
    } finally {
      setInvoiceUploading(false)
    }
  }

  const openEditInvoice = (inv) => {
    setInvoiceEditRow(inv || null)
    setInvoiceEditRef(String(inv?.invoice_ref || ''))
    setInvoiceEditDate(String(inv?.invoice_date || ''))
    setInvoiceEditAmount(inv?.amount != null && inv?.amount !== '' ? String(inv.amount) : '')
    setInvoiceEditNotes(String(inv?.notes || ''))
    setInvoiceEditOpen(true)
  }

  const saveInvoiceEdits = async () => {
    const id = Number(invoiceEditRow?.id)
    if (!Number.isFinite(id) || id <= 0 || invoiceEditSaving) return
    setInvoiceEditSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/food/vendor-banks/invoices/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          invoice_id: id,
          invoice_ref: invoiceEditRef,
          invoice_date: invoiceEditDate,
          amount: invoiceEditAmount,
          notes: invoiceEditNotes,
        }),
      })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/invoices/update')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update invoice')
      setInvoices((prev) => (prev || []).map((r) => (Number(r.id) === id ? json.invoice : r)))
      setInvoiceEditOpen(false)
      setInvoiceEditRow(null)
      setMsg({ type: 'success', text: 'Invoice updated' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to update invoice' })
    } finally {
      setInvoiceEditSaving(false)
    }
  }

  const confirmDeleteInvoice = (inv) => {
    setInvoiceDeleteRow(inv || null)
    setInvoiceDeleteOpen(true)
  }

  const deleteInvoice = async () => {
    const id = Number(invoiceDeleteRow?.id)
    if (!Number.isFinite(id) || id <= 0 || invoiceDeleting) return
    setInvoiceDeleting(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/food/vendor-banks/invoices/delete?invoice_id=${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      })
      const json = await safeJson(res, '/api/admin/food/vendor-banks/invoices/delete')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to delete invoice')
      setInvoices((prev) => (prev || []).filter((r) => Number(r.id) !== id))
      const locId = Number(invoiceLoc?.id)
      if (Number.isFinite(locId) && locId > 0) {
        setRows((prev) =>
          (prev || []).map((r) =>
            Number(r.id) === locId ? { ...r, invoice_count: Math.max(0, Number(r.invoice_count || 0) - 1) } : r
          )
        )
      }
      setInvoiceDeleteOpen(false)
      setInvoiceDeleteRow(null)
      setMsg({ type: 'success', text: 'Invoice deleted' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to delete invoice' })
    } finally {
      setInvoiceDeleting(false)
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
      <div className="mb-4 ui-card p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-h2 font-semibold">Food Distribution · Banks</h1>
            <div className="text-xs text-muted sm:text-sm">
              {filtered.length.toLocaleString()} branch{filtered.length === 1 ? '' : 'es'} ·{' '}
              {filtered.reduce((n, r) => n + (r.banks?.length || 0), 0).toLocaleString()} bank accounts · every account keeps
              its own invoices and paid state
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search branch / bank / account"
              className="min-w-[200px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none xl:w-64 xl:flex-none"
            />
            <select
              value={topBranchId}
              onChange={(e) => setTopBranchId(e.target.value)}
              aria-label="Branch to add a bank or invoice to"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none sm:w-44"
            >
              <option value="">Add to a branch…</option>
              {(rows || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'Branch'} ({r.code || r.id})
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => openAddBank()}>
                Add bank
              </Button>
              <Button size="sm" variant="accent" onClick={openTopInvoiceUpload}>
                Upload invoice
              </Button>
              <Button size="sm" variant="secondary" onClick={() => fetchRows()} loading={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>
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
          <table className="w-full min-w-[920px] text-sm">
            <colgroup>
              <col className="w-[220px]" />
              <col />
              <col className="w-[220px]" />
              <col className="w-[96px]" />
              <col className="w-[156px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line bg-subtle/70 text-[11px] uppercase tracking-wide text-subtext">
                <th className="px-4 py-2.5 text-left font-semibold">Branch</th>
                <th className="px-4 py-2.5 text-left font-semibold">Bank account</th>
                <th className="px-4 py-2.5 text-left font-semibold">Invoices</th>
                <th className="px-4 py-2.5 text-left font-semibold">Paid</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                !filtered.length &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk_${i}`} className="animate-pulse border-b border-line/60">
                    <td className="px-4 py-3">
                      <div className="h-4 w-32 rounded bg-subtle" />
                      <div className="mt-1.5 h-3 w-20 rounded bg-subtle" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-40 rounded bg-subtle" />
                      <div className="mt-1.5 h-3 w-56 rounded bg-subtle" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-24 rounded bg-subtle" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-5 w-16 rounded-full bg-subtle" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="ml-auto h-8 w-28 rounded bg-subtle" />
                    </td>
                  </tr>
                ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">
                    No branches match your search.
                  </td>
                </tr>
              )}

              {filtered.map((r, branchIdx) =>
                (r.banks || []).length === 0 ? (
                  <tr key={r.id} className={`border-b border-line ${branchIdx % 2 === 0 ? 'bg-surface' : 'bg-subtle/25'}`}>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-[10px] font-bold uppercase text-brand">
                          {String(r.code || r.name || '?').slice(0, 2)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-fg">{r.name || 'Branch'}</div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-subtext">{r.code || '—'}</span>
                            <button
                              type="button"
                              onClick={() => togglePaid(r, !r?.paid?.is_paid)}
                              disabled={paying}
                              title="Toggle this branch's paid status"
                              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${
                                r?.paid?.is_paid ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted hover:text-fg'
                              }`}
                            >
                              <span className={`h-1 w-1 rounded-full ${r?.paid?.is_paid ? 'bg-success-fg' : 'bg-muted'}`} />
                              Branch {r?.paid?.is_paid ? 'paid' : 'unpaid'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs text-subtext">No bank account yet</td>
                    <td className="px-4 py-3 align-middle text-xs text-subtext">—</td>
                    <td className="px-4 py-3 align-middle">
                      <span className="inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">
                        {r?.paid?.is_paid ? 'Paid' : 'Unpaid'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <Button size="sm" variant="secondary" onClick={() => openAddBank(r.id)}>
                        Add bank
                      </Button>
                    </td>
                  </tr>
                ) : (
                  (r.banks || []).map((b, idx) => {
                    const invs = b.invoices || []
                    return (
                      <tr
                        key={`${r.id}-${b.id}`}
                        className={`${idx === 0 ? 'border-t border-line' : ''} border-b border-line/60 ${
                          branchIdx % 2 === 0 ? 'bg-surface hover:bg-subtle/40' : 'bg-subtle/25 hover:bg-subtle/50'
                        }`}
                      >
                        {idx === 0 && (
                          <td rowSpan={(r.banks || []).length} className="px-4 py-3 align-top">
                            <div className="flex items-start gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-[10px] font-bold uppercase text-brand">
                                {String(r.code || r.name || '?').slice(0, 2)}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-semibold text-fg">{r.name || 'Branch'}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] uppercase tracking-wide text-subtext">{r.code || '—'}</span>
                                  <button
                                    type="button"
                                    onClick={() => togglePaid(r, !r?.paid?.is_paid)}
                                    disabled={paying}
                                    title="Toggle this branch's paid status"
                                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${
                                      r?.paid?.is_paid ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted hover:text-fg'
                                    }`}
                                  >
                                    <span className={`h-1 w-1 rounded-full ${r?.paid?.is_paid ? 'bg-success-fg' : 'bg-muted'}`} />
                                    Branch {r?.paid?.is_paid ? 'paid' : 'unpaid'}
                                  </button>
                                </div>
                                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-subtext">
                                  <span>
                                    {(r.banks || []).length} account{(r.banks || []).length === 1 ? '' : 's'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openAddBank(r.id)}
                                    className="font-semibold text-brand hover:underline"
                                  >
                                    + Add
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        )}

                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-[13px] font-semibold text-fg">{b.bank_name || 'Bank'}</span>
                            {b.purpose && (
                              <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted">{b.purpose}</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
                            <span className="max-w-[220px] truncate">{b.account_name || '—'}</span>
                            <span aria-hidden="true" className="text-subtext">
                              ·
                            </span>
                            <span className="font-mono text-fg">{b.account_number || '—'}</span>
                            {!!b.account_number && (
                              <button
                                type="button"
                                onClick={() => copyAccountNumber(b.account_number)}
                                className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted transition-colors hover:bg-subtle hover:text-fg"
                                title="Copy account number"
                              >
                                Copy
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 align-middle">
                          {invs.length ? (
                            <button
                              type="button"
                              onClick={() => loadInvoices(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-fg transition-colors hover:bg-subtle"
                              title="View this branch's invoices"
                            >
                              Invoice
                              <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
                                {invs.length}
                              </span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-subtext">None filed</span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-middle">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              b.is_paid ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted'
                            }`}
                          >
                            {b.is_paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>

                        <td className="px-4 py-3 align-middle text-right">
                          <div className="flex justify-end">
                            <select
                              defaultValue=""
                              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-fg focus:border-brand focus:outline-none"
                              onChange={(e) => {
                                const v = e.target.value
                                e.target.value = ''
                                if (!v) return
                                if (v === 'upload') openInvoiceUpload(r, b.id)
                                if (v === 'invoices') loadInvoices(r)
                                if (v === 'manage') setBanksFor(r)
                                if (v === 'paid') setAccountPaid(r, b, true)
                                if (v === 'unpaid') setAccountPaid(r, b, false)
                                if (v === 'delete') deleteAccount(r, b)
                              }}
                            >
                              <option value="" disabled>
                                Actions
                              </option>
                              <option value="upload" disabled={!!b.is_paid}>
                                Upload invoice
                              </option>
                              <option value="invoices" disabled={!invs.length}>
                                View invoices
                              </option>
                              {b.is_paid ? <option value="unpaid">Mark unpaid</option> : <option value="paid">Mark paid</option>}
                              <option value="manage">Edit account</option>
                              <option value="delete" disabled={!!b.is_paid}>
                                Delete account
                              </option>
                            </select>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={addBankOpen}
        onClose={() => {
          if (!addBankSaving) setAddBankOpen(false)
        }}
        title="Add bank account"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddBankOpen(false)} disabled={addBankSaving}>
              Cancel
            </Button>
            <Button onClick={saveNewBank} loading={addBankSaving}>
              Save account
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {addBankErr && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{addBankErr}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Branch</label>
            <select
              value={addBankBranchId}
              onChange={(e) => setAddBankBranchId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              disabled={addBankSaving}
            >
              <option value="">Choose the branch…</option>
              {(rows || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'Branch'} ({r.code || r.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Bank name</label>
            <input
              value={addBankName}
              onChange={(e) => setAddBankName(e.target.value)}
              placeholder="e.g. First Bank"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              disabled={addBankSaving}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Account name</label>
            <input
              value={addBankAccountName}
              onChange={(e) => setAddBankAccountName(e.target.value)}
              placeholder="Name on the account"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              disabled={addBankSaving}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Account number</label>
            <input
              value={addBankAccountNumber}
              onChange={(e) => setAddBankAccountNumber(e.target.value)}
              placeholder="0123456789"
              inputMode="numeric"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-fg focus:border-brand focus:outline-none"
              disabled={addBankSaving}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Purpose (optional)</label>
            <input
              value={addBankPurpose}
              onChange={(e) => setAddBankPurpose(e.target.value)}
              placeholder="e.g. transport, balance"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              disabled={addBankSaving}
            />
          </div>
        </div>
      </DraggableModal>

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
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                      <Button variant="secondary" size="sm" onClick={() => openEditInvoice(inv)}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => confirmDeleteInvoice(inv)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceEditOpen}
        onClose={() => {
          if (invoiceEditSaving) return
          setInvoiceEditOpen(false)
          setInvoiceEditRow(null)
        }}
        title={`Edit Invoice · ${invoiceEditRow?.file_name || ''}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setInvoiceEditOpen(false)
                setInvoiceEditRow(null)
              }}
              disabled={invoiceEditSaving}
            >
              Cancel
            </Button>
            <Button onClick={saveInvoiceEdits} loading={invoiceEditSaving}>
              Save
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-muted mb-1">Invoice reference</div>
            <input
              value={invoiceEditRef}
              onChange={(e) => setInvoiceEditRef(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted mb-1">Amount</div>
            <input
              value={invoiceEditAmount}
              onChange={(e) => setInvoiceEditAmount(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted mb-1">Invoice date (YYYY-MM-DD)</div>
            <input
              value={invoiceEditDate}
              onChange={(e) => setInvoiceEditDate(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted mb-1">Notes</div>
            <input
              value={invoiceEditNotes}
              onChange={(e) => setInvoiceEditNotes(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
            />
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
            <Button variant="danger" onClick={deleteInvoice} loading={invoiceDeleting}>
              Delete
            </Button>
          </div>
        }
      >
        <div className="text-sm text-muted">
          This deletes the invoice file and its record
          {invoiceDeleteRow?.file_name ? `: ${invoiceDeleteRow.file_name}` : ''}. It cannot be undone.
        </div>
      </DraggableModal>

      <DraggableModal open={bankModalOpen} onClose={() => setBankModalOpen(false)} title={`Bank Details · ${bankLoc?.name || ''}`}>
        <div className="space-y-3">
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={bankSaving}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={bankSaving}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={bankSaving}
          />
          <Button
            onClick={saveBank}
            loading={bankSaving}
          >
            {bankSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DraggableModal>

      <DraggableModal open={invoiceUploadOpen} onClose={() => setInvoiceUploadOpen(false)} title={`Upload Invoice · ${invoiceUploadLoc?.name || ''}`}>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-muted mb-1">Bank account this invoice was paid into</div>
            <select
              value={invoiceUploadBankId}
              onChange={(e) => setInvoiceUploadBankId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              disabled={invoiceUploading}
            >
              <option value="">Select the bank account…</option>
              {(invoiceUploadLoc?.banks || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bank_name || 'Bank'} · {b.account_name || ''} · {maskAccountNumber(b.account_number || '')}
                  {b.purpose ? ` — ${b.purpose}` : ''}
                </option>
              ))}
            </select>
          </div>
          <input
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice reference (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={invoiceUploading}
          />
          <textarea
            value={invoiceNotes}
            onChange={(e) => setInvoiceNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            rows={3}
            disabled={invoiceUploading}
          />
          <FilePicker
            value={invoiceFile}
            onChange={setInvoiceFile}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
            disabled={invoiceUploading}
          />
          <Button
            onClick={uploadInvoice}
            loading={invoiceUploading}
            disabled={!invoiceFile}
          >
            {invoiceUploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </DraggableModal>

      <AdminBankAccountsModal
        open={!!banksFor}
        onClose={() => setBanksFor(null)}
        module="food"
        ownerId={banksFor?.id}
        ownerName={banksFor?.name}
        onChanged={fetchRows}
      />
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
