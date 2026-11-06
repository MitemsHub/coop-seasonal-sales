'use client'

// app/components/AdminBankAccountsModal.jsx
// Admin view of every bank account attached to a payout owner — a food branch,
// a ram delivery location or an exhibition vendor. An owner may hold several
// accounts; exactly one is primary and that is where payouts land.
import { useCallback, useEffect, useState } from 'react'
import DraggableModal from './DraggableModal'
import Button from './ui/Button'

const EMPTY_FORM = { bank_name: '', account_name: '', account_number: '', make_current: false }

function maskAccountNumber(value) {
  const raw = String(value || '')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw || '—'
  if (digits.length <= 4) return digits
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
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
  const [editForm, setEditForm] = useState({ bank_name: '', account_name: '', account_number: '' })

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

  const add = async () => {
    if (busy) return
    setError('')
    if (!form.bank_name.trim() || !form.account_name.trim() || !form.account_number.trim()) {
      setError('Bank name, account name and account number are all required.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/vendor-banks/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module,
          owner_id: Number(ownerId),
          bank_name: form.bank_name,
          account_name: form.account_name,
          account_number: form.account_number,
          make_current: !!form.make_current,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to add bank account')
      setAccounts(json.accounts || [])
      setForm(EMPTY_FORM)
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Failed to add bank account')
    } finally {
      setBusy(false)
    }
  }

  const makePrimary = async (account) => {
    if (rowBusy) return
    setRowBusy(Number(account.id))
    setError('')
    try {
      const res = await fetch('/api/admin/vendor-banks/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module, owner_id: Number(ownerId), account_id: Number(account.id), make_current: true }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update bank account')
      setAccounts(json.accounts || [])
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Failed to update bank account')
    } finally {
      setRowBusy(0)
    }
  }

  const startEdit = (account) => {
    setEditId(Number(account.id))
    setEditForm({
      bank_name: account.bank_name || '',
      account_name: account.account_name || '',
      account_number: account.account_number || '',
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
      const res = await fetch('/api/admin/vendor-banks/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module, owner_id: Number(ownerId), account_id: Number(account.id), ...editForm }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update bank account')
      setAccounts(json.accounts || [])
      setEditId(0)
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Failed to update bank account')
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
      const json = await res.json()
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

  return (
    <DraggableModal
      open={open}
      onClose={() => {
        if (busy) return
        onClose?.()
      }}
      title={`Bank Accounts · ${ownerName || ''}`}
      description="Every account on file for this vendor. Payouts use the primary account."
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
          <div className="mb-1 text-xs font-medium text-muted">
            Accounts on file ({accounts.length})
          </div>
          {loading ? (
            <div className="rounded-lg border border-line px-3 py-4 text-sm text-muted">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="rounded-lg border border-line px-3 py-4 text-sm text-muted">
              No bank account yet. Add the first one below.
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {accounts.map((a) => (
                <div key={a.id} className="flex flex-col gap-2 p-2.5">
                  {editId === Number(a.id) ? (
                    <>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input
                          value={editForm.bank_name}
                          onChange={(e) => setEditForm({ ...editForm, bank_name: e.target.value })}
                          placeholder="Bank name"
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                          disabled={!!rowBusy}
                        />
                        <input
                          value={editForm.account_name}
                          onChange={(e) => setEditForm({ ...editForm, account_name: e.target.value })}
                          placeholder="Account name"
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                          disabled={!!rowBusy}
                        />
                        <input
                          value={editForm.account_number}
                          onChange={(e) => setEditForm({ ...editForm, account_number: e.target.value })}
                          placeholder="Account number"
                          inputMode="numeric"
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                          disabled={!!rowBusy}
                        />
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <Button variant="brand" size="sm" onClick={() => saveEdit(a)} loading={rowBusy === Number(a.id)}>
                          Save changes
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditId(0)} disabled={!!rowBusy}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="font-medium text-fg">{a.bank_name || '—'}</span>
                          {a.is_current && (
                            <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-fg">
                              Primary
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {a.account_name || '—'} · <span className="font-mono">{maskAccountNumber(a.account_number)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {!a.is_current && (
                          <Button variant="secondary" size="sm" onClick={() => makePrimary(a)} loading={rowBusy === Number(a.id)}>
                            Make primary
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => startEdit(a)} disabled={!!rowBusy}>
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
                          <Button variant="ghost" size="sm" onClick={() => setConfirmId(Number(a.id))} disabled={!!rowBusy}>
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-subtle/40 p-3">
          <div className="mb-2 text-sm font-semibold text-fg">Add another account</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              placeholder="Bank name"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              disabled={busy}
            />
            <input
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
              placeholder="Account name"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              disabled={busy}
            />
            <input
              value={form.account_number}
              onChange={(e) => setForm({ ...form, account_number: e.target.value })}
              placeholder="Account number"
              inputMode="numeric"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              disabled={busy}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={!!form.make_current}
                onChange={(e) => setForm({ ...form, make_current: e.target.checked })}
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                disabled={busy}
              />
              Make this the primary account
            </label>
            <Button variant="brand" onClick={add} loading={busy}>
              Add account
            </Button>
          </div>
        </div>
      </div>
    </DraggableModal>
  )
}
