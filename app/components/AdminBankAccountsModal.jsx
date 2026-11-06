'use client'

// app/components/AdminBankAccountsModal.jsx
// Admin view of every bank account attached to a payout owner — a food branch,
// a ram delivery location or an exhibition vendor. Accounts are independent:
// each has a purpose, the invoices filed against it, and its own paid status.
import { useCallback, useEffect, useState } from 'react'
import DraggableModal from './DraggableModal'
import Button from './ui/Button'

const EMPTY_FORM = { bank_name: '', account_name: '', account_number: '', purpose: '' }

function maskAccountNumber(value) {
  const raw = String(value || '')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw || '—'
  if (digits.length <= 4) return digits
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

function fmtNaira(n) {
  return `₦${Number(n || 0).toLocaleString()}`
}

export default function AdminBankAccountsModal({ open, onClose, module, ownerId, ownerName, onChanged }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState(0)
  const [confirmId, setConfirmId] = useState(0)
  const [editId, setEditId] = useState(0)
  const [editForm, setEditForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    if (!open || !module || !ownerId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/admin/vendor-banks/accounts?module=${encodeURIComponent(module)}&owner_id=${encodeURIComponent(ownerId)}`,
        { cache: 'no-store' }
      )
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load bank accounts')
      setAccounts(json.accounts || [])
    } catch (e) {
      setError(e?.message || 'Failed to load bank accounts')
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [open, module, ownerId])

  useEffect(() => {
    setForm(EMPTY_FORM)
    setError('')
    setConfirmId(0)
    setEditId(0)
    load()
  }, [load])

  const send = async (method, payload) => {
    const res = await fetch('/api/admin/vendor-banks/accounts', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module, owner_id: Number(ownerId), ...payload }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Request failed')
    setAccounts(json.accounts || [])
    onChanged?.()
    return json
  }

  const add = async () => {
    if (busy) return
    setError('')
    if (!form.bank_name.trim() || !form.account_name.trim() || !form.account_number.trim()) {
      setError('Bank name, account name and account number are all required.')
      return
    }
    setBusy(true)
    try {
      await send('POST', form)
      setForm(EMPTY_FORM)
    } catch (e) {
      setError(e?.message || 'Failed to add bank account')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (account) => {
    setEditId(Number(account.id))
    setEditForm({
      bank_name: account.bank_name || '',
      account_name: account.account_name || '',
      account_number: account.account_number || '',
      purpose: account.purpose || '',
    })
    setConfirmId(0)
    setError('')
  }

  const saveEdit = async (account) => {
    if (rowBusy) return
    if (!editForm.bank_name.trim() || !editForm.account_name.trim() || !editForm.account_number.trim()) {
      setError('Bank name, account name and account number are all required.')
      return
    }
    setRowBusy(Number(account.id))
    setError('')
    try {
      await send('PATCH', { account_id: Number(account.id), ...editForm })
      setEditId(0)
    } catch (e) {
      setError(e?.message || 'Failed to update bank account')
    } finally {
      setRowBusy(0)
    }
  }

  const setPaid = async (account, paid) => {
    if (rowBusy) return
    setRowBusy(Number(account.id))
    setError('')
    try {
      await send('PATCH', { account_id: Number(account.id), paid })
    } catch (e) {
      setError(e?.message || 'Failed to update paid status')
    } finally {
      setRowBusy(0)
    }
  }

  const remove = async (account) => {
    if (rowBusy) return
    setRowBusy(Number(account.id))
    setError('')
    try {
      const res = await fetch(
        `/api/admin/vendor-banks/accounts?module=${encodeURIComponent(module)}&owner_id=${encodeURIComponent(ownerId)}&account_id=${encodeURIComponent(account.id)}`,
        { method: 'DELETE' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to remove bank account')
      setAccounts(json.accounts || [])
      setConfirmId(0)
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Failed to remove bank account')
    } finally {
      setRowBusy(0)
    }
  }

  const field = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none'

  return (
    <DraggableModal
      open={open}
      onClose={() => {
        if (busy) return
        onClose?.()
      }}
      title={`Bank Accounts · ${ownerName || ''}`}
      description="Each account keeps its own invoices and is paid on its own."
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!!error && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{error}</div>}

        <div>
          <div className="mb-1 text-xs font-medium text-muted">Accounts on file ({accounts.length})</div>
          {loading ? (
            <div className="rounded-lg border border-line px-3 py-4 text-sm text-muted">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="rounded-lg border border-line px-3 py-4 text-sm text-muted">
              No bank account yet. Add the first one below.
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((a) => (
                <div key={a.id} className="rounded-lg border border-line p-2.5">
                  {editId === Number(a.id) ? (
                    <>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input value={editForm.bank_name} onChange={(e) => setEditForm({ ...editForm, bank_name: e.target.value })} placeholder="Bank name" className={field} disabled={!!rowBusy} />
                        <input value={editForm.account_name} onChange={(e) => setEditForm({ ...editForm, account_name: e.target.value })} placeholder="Account name" className={field} disabled={!!rowBusy} />
                        <input value={editForm.account_number} onChange={(e) => setEditForm({ ...editForm, account_number: e.target.value })} placeholder="Account number" inputMode="numeric" className={field} disabled={!!rowBusy} />
                        <input value={editForm.purpose} onChange={(e) => setEditForm({ ...editForm, purpose: e.target.value })} placeholder="Purpose (e.g. transport, balance)" className={field} disabled={!!rowBusy} />
                      </div>
                      <div className="mt-2 flex justify-end gap-1.5">
                        <Button variant="brand" size="sm" onClick={() => saveEdit(a)} loading={rowBusy === Number(a.id)}>
                          Save changes
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditId(0)} disabled={!!rowBusy}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="font-medium text-fg">{a.bank_name || '—'}</span>
                            {a.is_paid && (
                              <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-fg">
                                Paid
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {a.account_name || '—'} · <span className="font-mono">{maskAccountNumber(a.account_number)}</span>
                          </div>
                          <div className="text-xs text-muted">
                            {a.purpose ? a.purpose : 'No purpose noted'}
                            {a.created_by_role || a.created_by_code
                              ? ` · attached by ${a.created_by_role || 'user'}${a.created_by_code ? ` ${a.created_by_code}` : ''}`
                              : ''}
                            {a.created_at ? ` · ${new Date(a.created_at).toLocaleDateString()}` : ''}
                          </div>
                          {a.is_paid && a.paid_at && (
                            <div className="text-xs text-success-fg">Paid {new Date(a.paid_at).toLocaleString()}{a.paid_by ? ` by ${a.paid_by}` : ''}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <Button
                            variant={a.is_paid ? 'secondary' : 'brand'}
                            size="sm"
                            onClick={() => setPaid(a, !a.is_paid)}
                            loading={rowBusy === Number(a.id)}
                          >
                            {a.is_paid ? 'Mark unpaid' : 'Mark paid'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => startEdit(a)} disabled={!!rowBusy || a.is_paid}>
                            Edit
                          </Button>
                          {confirmId === Number(a.id) ? (
                            <>
                              <Button variant="danger" size="sm" onClick={() => remove(a)} loading={rowBusy === Number(a.id)}>
                                Confirm remove
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setConfirmId(0)} disabled={!!rowBusy}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setConfirmId(Number(a.id))} disabled={!!rowBusy || a.is_paid}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 rounded-lg bg-subtle/60 p-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-fg">
                            Invoices ({Array.isArray(a.invoices) ? a.invoices.length : 0})
                          </span>
                          <span className="font-semibold text-fg">{fmtNaira(a.invoice_total)}</span>
                        </div>
                        {Array.isArray(a.invoices) && a.invoices.length > 0 ? (
                          <div className="mt-1 space-y-1">
                            {a.invoices.map((inv) => (
                              <div key={inv.id} className="flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <div className="truncate text-fg">{inv.file_name || 'Invoice'}</div>
                                  <div className="truncate text-muted">
                                    {inv.invoice_ref || 'No ref'}
                                    {inv.invoice_date ? ` · ${inv.invoice_date}` : ''}
                                    {inv.amount != null ? ` · ${fmtNaira(inv.amount)}` : ''}
                                    {inv.created_by_role ? ` · ${inv.created_by_role}${inv.created_by_code ? ` ${inv.created_by_code}` : ''}` : ''}
                                  </div>
                                </div>
                                {inv.url ? (
                                  <a href={inv.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-line bg-surface px-2 py-1 font-medium text-fg">
                                    Open
                                  </a>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-xs text-muted">No invoices filed against this account.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-subtle/40 p-3">
          <div className="mb-2 text-sm font-semibold text-fg">Add another account</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="Bank name" className={field} disabled={busy} />
            <input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} placeholder="Account name" className={field} disabled={busy} />
            <input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} placeholder="Account number" inputMode="numeric" className={field} disabled={busy} />
            <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Purpose (e.g. transport, balance)" className={field} disabled={busy} />
          </div>
          <div className="mt-2 flex justify-end">
            <Button variant="brand" onClick={add} loading={busy}>
              Add account
            </Button>
          </div>
        </div>
      </div>
    </DraggableModal>
  )
}
