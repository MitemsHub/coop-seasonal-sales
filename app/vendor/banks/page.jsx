'use client'

// app/vendor/banks/page.jsx
// The vendor's own bank account + payout invoices — both tied to their
// exhibition season (cycle). Where the co-op pays them after a season, and
// where they attach the invoices for that season. The co-op's admin/rep sides
// read the same exhibition_vendor_bank_accounts / exhibition_vendor_invoices
// tables.
import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Label from '../../components/ui/Label'
import Skeleton from '../../components/ui/Skeleton'
import Badge from '../../components/ui/Badge'

function maskAccountNumber(s) {
  const v = String(s || '').replace(/\D/g, '')
  if (!v) return '—'
  if (v.length <= 4) return v
  return `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
}

const fmtNaira = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `NGN ${Number(n).toLocaleString()}`)

export default function VendorBanksPage() {
  const [bank, setBank] = useState(null) // null = loading
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')

  // Invoices — tied to the vendor's exhibition cycle.
  const [invoices, setInvoices] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [invoicesMsg, setInvoicesMsg] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [upFile, setUpFile] = useState(null)
  const [upRef, setUpRef] = useState('')
  const [upDate, setUpDate] = useState('')
  const [upAmount, setUpAmount] = useState('')
  const [upNotes, setUpNotes] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vendor/bank', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setBank(json.bank)
      else setMsg(json.error || 'Failed to load bank details')
    } catch {
      setMsg('Failed to load bank details')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadInvoices = useCallback(async () => {
    try {
      const res = await fetch('/api/vendor/exhibition/invoices', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setInvoices(json.invoices || [])
      else setInvoicesMsg(json.error || 'Failed to load invoices')
    } catch {
      setInvoicesMsg('Failed to load invoices')
    } finally {
      setInvoicesLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    loadInvoices()
  }, [load, loadInvoices])

  const openEdit = () => {
    setBankName(String(bank?.bank_name || ''))
    setAccountName(String(bank?.account_name || ''))
    setAccountNumber(String(bank?.account_number || ''))
    setMsg('')
    setModalOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/vendor/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank_name: bankName, account_name: accountName, account_number: accountNumber }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save')
      setBank(json.bank)
      setModalOpen(false)
      setMsg('')
    } catch (e) {
      setMsg(e.message || 'Failed to save bank details')
    } finally {
      setSaving(false)
    }
  }

  const openUpload = () => {
    setUpFile(null)
    setUpRef('')
    setUpDate('')
    setUpAmount('')
    setUpNotes('')
    setInvoicesMsg('')
    setUploadOpen(true)
  }

  const uploadInvoice = async () => {
    if (!upFile) {
      setInvoicesMsg('Choose an invoice file first.')
      return
    }
    setUploading(true)
    setInvoicesMsg('')
    try {
      const fd = new FormData()
      fd.append('file', upFile)
      if (upRef.trim()) fd.append('invoice_ref', upRef.trim())
      if (upDate) fd.append('invoice_date', upDate)
      if (upAmount) fd.append('amount', upAmount)
      if (upNotes.trim()) fd.append('notes', upNotes.trim())
      const res = await fetch('/api/vendor/exhibition/invoices', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed')
      setUploadOpen(false)
      await loadInvoices()
    } catch (e) {
      setInvoicesMsg(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const deleteInvoice = async (inv) => {
    if (!window.confirm(`Delete invoice${inv.invoice_ref ? ` ${inv.invoice_ref}` : ''}? This can't be undone.`)) return
    setDeletingId(inv.id)
    setInvoicesMsg('')
    try {
      const res = await fetch(`/api/vendor/exhibition/invoices?invoice_id=${encodeURIComponent(String(inv.id))}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Delete failed')
      setInvoices((prev) => prev.filter((i) => i.id !== inv.id))
    } catch (e) {
      setInvoicesMsg(e.message || 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-h1 font-bold tracking-tight text-fg">Bank &amp; Invoices</h1>
        <p className="mt-1 text-sm text-muted">
          Your payout account and the invoices for this exhibition season. Keep both up to date so your payout lands without delay.
        </p>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Landmark className="h-5 w-5" strokeWidth={2} />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">Payout account</p>
              <p className="text-chips text-muted">{bank ? 'On file — shown masked below' : 'No account saved yet'}</p>
            </div>
            <Button variant="secondary" size="sm" leftIcon={Pencil} onClick={openEdit} className="ml-auto">
              {bank ? 'Edit' : 'Add account'}
            </Button>
          </div>

          {bank ? (
            <dl className="divide-y divide-line">
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm text-muted">Bank</dt>
                <dd className="text-sm font-semibold text-fg">{bank.bank_name || '—'}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm text-muted">Account name</dt>
                <dd className="text-sm font-semibold text-fg">{bank.account_name || '—'}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm text-muted">Account number</dt>
                <dd className="font-mono text-sm font-semibold text-fg">{maskAccountNumber(bank.account_number)}</dd>
              </div>
            </dl>
          ) : (
            <p className="rounded-xl bg-subtle px-4 py-6 text-center text-sm text-muted">
              Add your bank account so the co-op knows where to pay you after the season.
            </p>
          )}
        </div>
      )}

      {/* Season invoices — tied to this vendor's exhibition cycle */}
      <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <FileText className="h-5 w-5" strokeWidth={2} />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">Season invoices</p>
              <p className="text-chips text-muted">Invoice attachments for your exhibition payout</p>
            </div>
          </div>
          <Button variant="brand" size="sm" leftIcon={Plus} onClick={openUpload}>
            Upload invoice
          </Button>
        </div>

        {!!invoicesMsg && (
          <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{invoicesMsg}</div>
        )}

        {invoicesLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-subtle/60 px-4 py-8 text-center">
            <FileText className="h-6 w-6 text-muted" strokeWidth={2} />
            <p className="text-sm font-medium text-fg">No invoices uploaded yet</p>
            <p className="max-w-sm text-xs text-muted">
              Attach your invoice (PDF or image) for this exhibition season and the co-op will have it on file for your payout.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted">
                    <FileText className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-fg">
                        {inv.invoice_ref || inv.file_name || `Invoice #${inv.id}`}
                      </p>
                      <Badge tone="accent" variant="subtle">
                        {inv.cycle_id ? `Cycle #${inv.cycle_id}` : 'Season'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-chips text-muted">
                      {inv.file_name}
                      {inv.invoice_date ? ` · ${new Date(inv.invoice_date).toLocaleDateString('en-GB')}` : ''}
                      {inv.amount != null ? ` · ${fmtNaira(inv.amount)}` : ''}
                    </p>
                    {!!inv.notes && <p className="mt-0.5 line-clamp-1 text-chips text-muted">{inv.notes}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {inv.url && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={Download}
                      onClick={() => window.open(inv.url, '_blank', 'noopener,noreferrer')}
                    >
                      Open
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={Trash2}
                    onClick={() => deleteInvoice(inv)}
                    loading={deletingId === inv.id}
                    className="text-danger-fg hover:bg-danger-bg"
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={bank ? 'Edit bank details' : 'Add bank details'}
        description="This is where the co-op sends your season payout."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={save} loading={saving} disabled={!bankName.trim() || !accountName.trim() || !accountNumber.trim()}>
              Save
            </Button>
          </>
        }
      >
        {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{msg}</div>}
        <div className="space-y-4">
          <div>
            <Label htmlFor="v-bank-name">Bank name</Label>
            <Input id="v-bank-name" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. First Bank" />
          </div>
          <div>
            <Label htmlFor="v-account-name">Account name</Label>
            <Input id="v-account-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Name on the account" />
          </div>
          <div>
            <Label htmlFor="v-account-number">Account number</Label>
            <Input id="v-account-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="10-digit NUBAN" />
          </div>
        </div>
      </Modal>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload season invoice"
        description="Attach the invoice for this exhibition season. PDF, JPG, PNG or WEBP."
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={uploadInvoice} loading={uploading} disabled={!upFile}>
              {uploading ? 'Uploading…' : 'Upload invoice'}
            </Button>
          </>
        }
      >
        {!!invoicesMsg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{invoicesMsg}</div>}
        <div className="space-y-4">
          <div>
            <Label htmlFor="v-invoice-file">Invoice file</Label>
            <input
              id="v-invoice-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setUpFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-line bg-surface p-2 text-sm text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-on-accent"
            />
          </div>
          <div>
            <Label htmlFor="v-invoice-ref">Invoice reference (optional)</Label>
            <Input id="v-invoice-ref" value={upRef} onChange={(e) => setUpRef(e.target.value)} placeholder="e.g. INV-2026-001" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="v-invoice-date">Invoice date (optional)</Label>
              <Input id="v-invoice-date" type="date" value={upDate} onChange={(e) => setUpDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="v-invoice-amount">Amount (₦, optional)</Label>
              <Input id="v-invoice-amount" type="number" min="0" step="0.01" value={upAmount} onChange={(e) => setUpAmount(e.target.value)} placeholder="e.g. 250000" />
            </div>
          </div>
          <div>
            <Label htmlFor="v-invoice-notes">Notes (optional)</Label>
            <Input id="v-invoice-notes" value={upNotes} onChange={(e) => setUpNotes(e.target.value)} placeholder="Anything the co-op should know" />
          </div>
        </div>
      </Modal>
    </div>
  )
}
