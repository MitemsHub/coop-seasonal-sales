'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Upload } from 'lucide-react'
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

const isPdfFile = (file) => /pdf$/i.test(String(file?.name || '')) || file?.type === 'application/pdf'

function prettySize(bytes) {
  const n = Number(bytes || 0)
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Downscale phone photos before they leave the device: a 6MB camera shot goes
// out as ~200–500KB, so flaky mobile data and server limits stop mattering.
// Falls back to the original file when the browser cannot decode it (HEIC in
// Chrome), which the upload route accepts by extension.
function compressPhoto(file, maxDim = 1800, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('image/')) return resolve(file)
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl)
          if (blob && blob.size < file.size) {
            const name = String(file.name || 'invoice').replace(/\.\w+$/, '')
            resolve(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }))
          } else {
            resolve(file)
          }
        }, 'image/jpeg', quality)
      } catch {
        URL.revokeObjectURL(objectUrl)
        resolve(file)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}

function RepFoodBanksContent() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [cycle, setCycle] = useState(null)
  const [branch, setBranch] = useState(null)
  const [banks, setBanks] = useState([])
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [paid, setPaid] = useState({ is_paid: false, paid_at: null })

  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankEditId, setBankEditId] = useState(null)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [savingBank, setSavingBank] = useState(false)

  const [bankDeleteOpen, setBankDeleteOpen] = useState(false)
  const [bankDeleteRow, setBankDeleteRow] = useState(null)
  const [deletingBank, setDeletingBank] = useState(false)

  const [invoiceListOpen, setInvoiceListOpen] = useState(false)
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [invoiceBankId, setInvoiceBankId] = useState('')
  const [invoiceFilterBankId, setInvoiceFilterBankId] = useState(null)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [invoiceDragActive, setInvoiceDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Set when the upload is a re-file of an existing invoice: the new file is
  // uploaded first, then the old row (and its stored file) is removed.
  const [replaceInvoiceId, setReplaceInvoiceId] = useState(null)
  const invoiceFileInputRef = useRef(null)

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
      const list = Array.isArray(json.banks) ? json.banks : json.bank ? [json.bank] : []
      setBanks(list)
      setInvoiceCount(Number(json.invoice_count || 0))
      setPaid(json.paid || { is_paid: false, paid_at: null })
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setCycle(null)
      setBranch(null)
      setBanks([])
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

  const openBank = (row = null) => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    setBankEditId(row?.id ? Number(row.id) : null)
    setBankName(String(row?.bank_name || ''))
    setAccountName(String(row?.account_name || ''))
    setAccountNumber(String(row?.account_number || ''))
    setBankModalOpen(true)
  }

  const saveBank = async () => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (savingBank) return
    if (!bankName.trim() || !accountName.trim() || !accountNumber.trim()) {
      setMsg({ type: 'error', text: 'Bank name, account name and account number are all required.' })
      return
    }
    setSavingBank(true)
    setMsg(null)
    try {
      const editing = Number.isFinite(bankEditId) && bankEditId > 0
      const url = editing
        ? '/api/rep/food/vendor-banks/accounts/update'
        : '/api/rep/food/vendor-banks/accounts/add'
      const payload = {
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
      }
      if (editing) payload.account_id = bankEditId
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await safeJson(res, url)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setBankModalOpen(false)
      setBankEditId(null)
      await fetchLocation()
      setMsg({ type: 'success', text: editing ? 'Bank account updated' : 'Bank account added' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to save' })
    } finally {
      setSavingBank(false)
    }
  }

  const openDeleteBank = (row) => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    setBankDeleteRow(row || null)
    setBankDeleteOpen(true)
  }

  // Which account an invoice was filed against — shown on every row so the
  // "All Invoices" list never leaves the rep guessing.
  const invoiceBankLabel = (inv) => {
    const acct = banks.find((b) => Number(b.id) === Number(inv?.bank_account_id))
    if (!acct) return 'Unassigned account'
    return `${acct.bank_name || 'Bank'} · ${acct.account_name || ''} · ${maskAccountNumber(acct.account_number || '')}`
  }

  const deleteBank = async () => {
    const id = Number(bankDeleteRow?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (deletingBank) return
    setDeletingBank(true)
    setMsg(null)
    try {
      const url = '/api/rep/food/vendor-banks/accounts/delete'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ account_id: id }),
      })
      const json = await safeJson(res, url)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to remove account')
      setBankDeleteOpen(false)
      setBankDeleteRow(null)
      await fetchLocation()
      setMsg({ type: 'success', text: 'Bank account removed' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to remove account' })
    } finally {
      setDeletingBank(false)
    }
  }

  const loadInvoices = async (bank = null) => {
    const bankId = Number(bank?.id) || null
    setInvoiceFilterBankId(bankId)
    setInvoiceLoading(true)
    setMsg(null)
    try {
      const qs = bankId ? `?bank_account_id=${encodeURIComponent(bankId)}` : ''
      const res = await fetch(`/api/rep/food/vendor-banks/invoices/list${qs}`, { cache: 'no-store' })
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

  const openUpload = (bank = null, replaceInv = null) => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (!banks.length) {
      setMsg({ type: 'error', text: 'Add a bank account first — every invoice is filed against an account.' })
      return
    }
    const preset = bank?.id
      ? String(bank.id)
      : replaceInv?.bank_account_id
        ? String(replaceInv.bank_account_id)
        : String((banks.find((b) => b.is_current) || banks[0])?.id || '')
    setInvoiceBankId(preset)
    setReplaceInvoiceId(replaceInv?.id ? Number(replaceInv.id) : null)
    setInvoiceRef(replaceInv?.invoice_ref || '')
    setInvoiceNotes(replaceInv?.notes || '')
    setInvoiceFile(null)
    setInvoiceDragActive(false)
    setInvoiceUploadOpen(true)
  }

  // Re-file an invoice without hunting for the account: the upload modal opens
  // on that invoice's account, and the old file is retired once the new one is in.
  const replaceInvoiceFile = (inv) => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    const acct = banks.find((b) => Number(b.id) === Number(inv?.bank_account_id)) || null
    openUpload(acct, inv)
  }

  const uploadInvoice = async () => {
    if (paid?.is_paid) {
      setMsg({ type: 'error', text: 'Branch is marked as Paid. Editing is locked.' })
      return
    }
    if (!invoiceFile) return
    if (!invoiceBankId) {
      setMsg({ type: 'error', text: 'Choose the bank account this invoice belongs to.' })
      return
    }
    if (uploading) return
    setUploading(true)
    setMsg(null)
    try {
      // PDFs go out untouched; photos are shrunk first so a camera-sized image
      // does not stall on mobile data.
      const prepared = isPdfFile(invoiceFile) ? invoiceFile : await compressPhoto(invoiceFile)
      if (prepared.size > 10 * 1024 * 1024) {
        throw new Error('That file is larger than 10MB — take a smaller photo or send the PDF again.')
      }
      const fd = new FormData()
      fd.set('bank_account_id', String(invoiceBankId))
      fd.set('invoice_ref', invoiceRef)
      fd.set('notes', invoiceNotes)
      fd.set('file', prepared, prepared.name || 'invoice')
      const res = await fetch('/api/rep/food/vendor-banks/invoices/upload', { method: 'POST', body: fd })
      const json = await safeJson(res, '/api/rep/food/vendor-banks/invoices/upload')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed')
      setInvoiceUploadOpen(false)
      setInvoiceFile(null)
      setInvoiceCount((n) => n + 1)
      let replacedOld = false
      if (replaceInvoiceId) {
        const oldId = replaceInvoiceId
        setReplaceInvoiceId(null)
        try {
          const delRes = await fetch(
            `/api/rep/food/vendor-banks/invoices/delete?invoice_id=${encodeURIComponent(oldId)}`,
            { method: 'DELETE' }
          )
          replacedOld = delRes.ok
        } catch {
          replacedOld = false
        }
      }
      await fetchLocation()
      await loadInvoices(invoiceFilterBankId ? { id: invoiceFilterBankId } : null)
      if (replaceInvoiceId && !replacedOld) {
        setMsg({
          type: 'error',
          text: 'The new file is uploaded, but the old version is still listed — delete it from the list.',
        })
      } else {
        setMsg({ type: 'success', text: replaceInvoiceId ? 'Invoice file replaced' : 'Invoice uploaded' })
      }
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-fg">Bank Accounts</div>
                    <div className="text-xs text-muted">{banks.length} attached</div>
                  </div>
                  {banks.length === 0 ? (
                    <div className="mt-1 text-xs text-muted">
                      No bank account attached yet. Add one so this branch&apos;s payout has somewhere to land.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {banks.map((b) => (
                        <div key={b.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-fg truncate">{b.bank_name || 'Bank'}</span>
                                <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-muted">
                                  {Number(b.invoice_count || 0)} invoice{Number(b.invoice_count || 0) === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="text-xs text-muted truncate">{b.account_name || '—'}</div>
                              <div className="text-xs text-muted">{maskAccountNumber(b.account_number || '')}</div>
                            </div>
                            <div className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => loadInvoices(b)}
                                disabled={invoiceLoading}
                                className="inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
                              >
                                Invoices
                              </button>
                              <button
                                type="button"
                                onClick={() => openUpload(b)}
                                disabled={paid?.is_paid}
                                className="inline-flex items-center rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                              >
                                Upload
                              </button>
                              <button
                                type="button"
                                onClick={() => openBank(b)}
                                disabled={paid?.is_paid}
                                className="inline-flex items-center rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteBank(b)}
                                disabled={paid?.is_paid}
                                className="inline-flex items-center rounded-lg bg-danger-fg px-2.5 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => openBank(null)}
                      disabled={paid?.is_paid || banks.length >= 10}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
                    >
                      Add Account
                    </button>
                  </div>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="text-sm font-medium text-fg mb-1">Invoices</div>
                  <div className="text-xs text-muted">Uploaded: {Number(invoiceCount || 0).toLocaleString()}</div>
                  <div className="mt-1 text-xs text-muted">
                    Each invoice is filed against the account it was paid into. Use an account&apos;s
                    <span className="font-medium"> Invoices</span> button to see only that account.
                  </div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => loadInvoices(null)}
                      disabled={invoiceLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
                      aria-busy={invoiceLoading}
                    >
                      {invoiceLoading && <Spinner className="h-4 w-4 text-on-accent" />}
                      <span>{invoiceLoading ? 'Loading…' : 'View All Invoices'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openUpload(null)}
                      disabled={paid?.is_paid || banks.length === 0}
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

      <DraggableModal
        open={bankModalOpen}
        onClose={() => setBankModalOpen(false)}
        title={bankEditId ? 'Edit Bank Account' : 'Add Bank Account'}
      >
        <div className="space-y-3">
          <div className="text-xs text-muted">
            A branch can hold several bank accounts. Each one keeps its own invoices.
          </div>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={savingBank || paid?.is_paid}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={savingBank || paid?.is_paid}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
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

      <DraggableModal open={bankDeleteOpen} onClose={() => setBankDeleteOpen(false)} title="Remove Bank Account">
        <div className="space-y-3">
          <div className="text-sm text-subtext">
            Remove <span className="font-medium">{bankDeleteRow?.bank_name || 'this account'}</span> (
            {maskAccountNumber(bankDeleteRow?.account_number || '') || '—'})?
            {Number(bankDeleteRow?.invoice_count || 0) > 0
              ? ` Its ${Number(bankDeleteRow.invoice_count)} invoice${Number(bankDeleteRow.invoice_count) === 1 ? '' : 's'} stay on record, but become unassigned.`
              : ''}
            {bankDeleteRow?.is_current
              ? ' It is also the account currently used for payouts, so the newest remaining account takes over.'
              : ''}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={deleteBank}
              disabled={deletingBank || paid?.is_paid}
              className="inline-flex items-center gap-2 rounded-lg bg-danger-fg px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              aria-busy={deletingBank}
            >
              {deletingBank && <Spinner className="h-4 w-4 text-on-accent" />}
              <span>{deletingBank ? 'Removing…' : 'Remove'}</span>
            </button>
            <button
              type="button"
              onClick={() => setBankDeleteOpen(false)}
              disabled={deletingBank}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={invoiceListOpen}
        onClose={() => setInvoiceListOpen(false)}
        title={
          invoiceFilterBankId
            ? `Invoices · ${banks.find((b) => Number(b.id) === Number(invoiceFilterBankId))?.bank_name || 'Account'}`
            : 'All Invoices'
        }
      >
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
                      <div className="text-xs text-muted truncate">{invoiceBankLabel(inv)}</div>
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
                        onClick={() => replaceInvoiceFile(inv)}
                        disabled={paid?.is_paid}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
                      >
                        Replace
                      </button>
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
          <select
            value={invoiceBankId}
            onChange={(e) => setInvoiceBankId(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
            disabled={uploading || paid?.is_paid}
          >
            <option value="">Select the bank account…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bank_name || 'Bank'} · {b.account_name || ''} · {maskAccountNumber(b.account_number || '')}
              </option>
            ))}
          </select>
          <input
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice reference (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={uploading || paid?.is_paid}
          />
          <textarea
            value={invoiceNotes}
            onChange={(e) => setInvoiceNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            rows={3}
            disabled={uploading || paid?.is_paid}
          />
          {/* Designed picker instead of the browser's bare "Choose File" text —
              reps (and the admin) did not recognise the native control as a button. */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose the invoice file to upload"
            aria-disabled={uploading || !!paid?.is_paid}
            onClick={() => {
              if (uploading || paid?.is_paid) return
              invoiceFileInputRef.current?.click()
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              if (uploading || paid?.is_paid) return
              invoiceFileInputRef.current?.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (!uploading && !paid?.is_paid) setInvoiceDragActive(true)
            }}
            onDragLeave={() => setInvoiceDragActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setInvoiceDragActive(false)
              if (uploading || paid?.is_paid) return
              const dropped = e.dataTransfer?.files?.[0]
              if (dropped) setInvoiceFile(dropped)
            }}
            className={[
              'rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors duration-200 ease-sakani',
              invoiceDragActive ? 'border-brand bg-brand-subtle' : 'border-line-strong bg-subtle/50 hover:border-brand',
              uploading || paid?.is_paid
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
            ].join(' ')}
          >
            <input
              ref={invoiceFileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
              className="hidden"
              disabled={uploading || paid?.is_paid}
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) setInvoiceFile(picked)
                e.target.value = ''
              }}
            />
            {invoiceFile ? (
              <div className="flex items-center justify-between gap-3 text-left">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{invoiceFile.name}</div>
                  <div className="text-xs text-muted">
                    {prettySize(invoiceFile.size)}
                    {prettySize(invoiceFile.size) ? ' · ' : ''}ready to upload
                  </div>
                </div>
                <span className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand">
                  Change
                </span>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-6 w-6 text-muted" strokeWidth={1.75} />
                <div className="mt-2 text-sm">
                  <span className="font-semibold text-brand">Choose file</span>{' '}
                  <span className="text-muted">or drag &amp; drop</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  PDF, JPG, PNG, WEBP or HEIC · large photos are shrunk before upload
                </div>
              </>
            )}
          </div>
          {!invoiceBankId ? (
            <div className="text-xs text-muted">Choose the bank account above to enable Upload.</div>
          ) : null}
          <button
            type="button"
            onClick={uploadInvoice}
            disabled={uploading || paid?.is_paid || !invoiceFile || !invoiceBankId}
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
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            disabled={invoiceSaving || paid?.is_paid}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={invoiceEditDate}
              onChange={(e) => setInvoiceEditDate(e.target.value)}
              placeholder="Invoice date (YYYY-MM-DD)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              disabled={invoiceSaving || paid?.is_paid}
            />
            <input
              value={invoiceEditAmount}
              onChange={(e) => setInvoiceEditAmount(e.target.value)}
              placeholder="Amount (optional)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              disabled={invoiceSaving || paid?.is_paid}
            />
          </div>
          <textarea
            value={invoiceEditNotes}
            onChange={(e) => setInvoiceEditNotes(e.target.value)}
            placeholder="Notes"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
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
