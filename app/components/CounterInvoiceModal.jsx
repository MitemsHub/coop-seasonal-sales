// app/components/CounterInvoiceModal.jsx
// The invoice filled in at the stand: pick the vendor stand (admin desk only),
// pick the member, key the items (SN is automatic), choose Cash / Savings /
// Loan, submit. No catalogue. The same form edits a pending invoice when
// `order` is supplied.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Plus, Search, Store, Trash2, X } from 'lucide-react'
import DraggableModal from './DraggableModal'
import Button from './ui/Button'

const naira = (n) => `NGN ${Number(n || 0).toLocaleString()}`
const newItem = () => ({ key: Math.random().toString(36).slice(2), name: '', qty: '1', price: '' })
const PAYMENTS = ['Cash', 'Savings', 'Loan']

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none'

export default function CounterInvoiceModal({ open, onClose, onCreated, mode = 'vendor', order = null }) {
  const isAdmin = mode === 'admin'
  const editing = Boolean(order?.id)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [member, setMember] = useState(null)
  const [vendor, setVendor] = useState(null)
  const [vendorQuery, setVendorQuery] = useState('')
  const [vendorResults, setVendorResults] = useState([])
  const [vendorSearching, setVendorSearching] = useState(false)
  const [items, setItems] = useState([newItem()])
  const [payment, setPayment] = useState('Cash')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)

  const reset = () => {
    setQuery('')
    setResults([])
    setSearching(false)
    setMember(null)
    setVendor(null)
    setVendorQuery('')
    setVendorResults([])
    setVendorSearching(false)
    setItems([newItem()])
    setPayment('Cash')
    setSubmitting(false)
    setError('')
    setCreated(null)
  }

  // Open fresh, or hydrate from the pending invoice being edited.
  useEffect(() => {
    if (!open) {
      reset()
      return
    }
    setError('')
    setCreated(null)
    setSubmitting(false)
    setQuery('')
    setResults([])
    setVendorQuery('')
    setVendorResults([])
    if (editing) {
      const firstLine = order.lines?.[0]
      setVendor(
        firstLine
          ? {
              id: firstLine.vendor_id,
              name: order.per_vendor?.[0]?.vendor_name || 'Vendor',
              branch: order.branch_name || '',
              cycle: order.cycle_name || '',
            }
          : null
      )
      setMember({
        member_id: order.member_id,
        full_name: order.member_name_snapshot || '',
        branch: order.branch_name || '',
      })
      const rows = order.lines?.length ? order.lines : [null]
      setItems(
        rows.map((l, i) =>
          l
            ? {
                key: `line-${l.id ?? i}`,
                name: l.product_name || '',
                qty: String(l.qty ?? 1),
                price: String(l.final_price ?? l.vendor_price ?? ''),
              }
            : newItem()
        )
      )
      setPayment(order.payment_option || 'Cash')
    } else {
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, order])

  // Member lookup — the vendor endpoint or the admin desk's equivalent.
  useEffect(() => {
    if (!open || member || editing) return undefined
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return undefined
    }
    let alive = true
    setSearching(true)
    const endpoint = isAdmin ? '/api/admin/exhibition/members/search' : '/api/vendor/exhibition/members/search'
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const json = await res.json()
        if (alive) setResults(Array.isArray(json?.members) ? json.members : [])
      } catch {
        if (alive) setResults([])
      } finally {
        if (alive) setSearching(false)
      }
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, member, open, isAdmin, editing])

  // Vendor stand lookup — admin desk only, and only for a new invoice.
  useEffect(() => {
    if (!open || !isAdmin || editing || vendor) return undefined
    const q = vendorQuery.trim()
    if (q.length < 2) {
      setVendorResults([])
      setVendorSearching(false)
      return undefined
    }
    let alive = true
    setVendorSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/exhibition/vendors?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const json = await res.json()
        if (alive) setVendorResults(Array.isArray(json?.vendors) ? json.vendors : [])
      } catch {
        if (alive) setVendorResults([])
      } finally {
        if (alive) setVendorSearching(false)
      }
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [vendorQuery, vendor, open, isAdmin, editing])

  const totals = useMemo(() => {
    let qty = 0
    let principal = 0
    for (const it of items) {
      const q = Math.max(0, Math.trunc(Number(it.qty) || 0))
      const p = Math.max(0, Math.trunc(Number(it.price) || 0))
      qty += q
      principal += q * p
    }
    return { qty, principal }
  }, [items])

  const updateItem = (key, patch) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const addItem = () => setItems((prev) => [...prev, newItem()])
  const removeItem = (key) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev))

  const submit = async () => {
    setError('')
    if (!member) {
      setError('Choose the member first.')
      return
    }
    if (isAdmin && !editing && !vendor) {
      setError('Choose the vendor stand first.')
      return
    }
    const cleaned = items
      .map((it) => ({
        name: String(it.name || '').trim(),
        qty: Math.trunc(Number(it.qty || 0)),
        price: Math.trunc(Number(it.price || 0)),
      }))
      .filter((it) => it.name || it.qty > 0 || it.price > 0)
    if (cleaned.length === 0) {
      setError('Add at least one item.')
      return
    }
    if (cleaned.some((it) => !it.name)) {
      setError('Every item needs a name.')
      return
    }
    if (cleaned.some((it) => it.qty <= 0)) {
      setError('Quantity must be at least 1.')
      return
    }
    if (cleaned.some((it) => it.price < 0)) {
      setError('Price cannot be negative.')
      return
    }

    setSubmitting(true)
    try {
      const payload = { payment_option: payment, items: cleaned }
      let url = '/api/vendor/exhibition/orders/create'
      let method = 'POST'
      if (editing) {
        url = `/api/admin/exhibition/orders/${order.id}`
        method = 'PATCH'
      } else if (isAdmin) {
        url = '/api/admin/exhibition/orders/create'
        payload.vendor_id = vendor?.id
      } else {
        payload.member_id = member.member_id
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not save the invoice')
      setCreated({ ...json, edited: editing })
      onCreated?.()
    } catch (e) {
      setError(e?.message || 'Could not save the invoice')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DraggableModal
      open={open}
      onClose={onClose}
      widthClass="max-w-2xl w-full mx-4"
      title={editing ? 'Edit counter invoice' : 'New counter invoice'}
    >
      {created ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-success-border bg-success-bg/50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-fg" strokeWidth={2.2} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">
                {created.order_id} {created.edited ? 'updated' : 'submitted'}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {created.edited
                  ? 'Changes saved. The invoice stays pending until it is approved.'
                  : 'Pending admin approval. It already shows in the member\u2019s portal.'}
              </p>
              <p className="mt-2 text-lg font-bold tabular-nums text-fg">{naira(created.total)}</p>
              <p className="text-chips text-muted">
                {created.payment_option}
                {created.interest > 0 ? ` · includes ${naira(created.interest)} loan interest` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {/* An edit cannot be restarted from here: the member and stand stay
                fixed, so closing is the only sensible next step. */}
            {!created.edited && <Button variant="secondary" onClick={reset}>New invoice</Button>}
            <Button onClick={() => { onCreated?.(); onClose?.() }}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Vendor stand — the admin desk can raise an invoice for any stand. */}
          {isAdmin && (
            <section className="rounded-2xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Vendor stand</h3>
                {vendor && !editing && (
                  <button
                    type="button"
                    onClick={() => { setVendor(null); setVendorQuery('') }}
                    className="inline-flex items-center gap-1 text-chips font-medium text-muted hover:text-fg"
                  >
                    <X className="h-3.5 w-3.5" /> Change
                  </button>
                )}
              </div>

              {vendor ? (
                <div className="mt-2 flex items-start gap-2 rounded-xl bg-subtle/60 px-3 py-2">
                  <Store className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2.2} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{vendor.name || 'Vendor'}</p>
                    <p className="text-chips text-muted">
                      {vendor.branch || 'Branch'}
                      {vendor.cycle ? ` · ${vendor.cycle}` : ''}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    value={vendorQuery}
                    onChange={(e) => setVendorQuery(e.target.value)}
                    placeholder="Search vendor name or code"
                    aria-label="Search vendor stand"
                    className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-9 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                  />
                  {vendorSearching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                  )}
                  {vendorResults.length > 0 && (
                    <ul className="mt-2 max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                      {vendorResults.map((v) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            disabled={v.status !== 'active'}
                            onClick={() => { setVendor(v); setVendorResults([]) }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-fg">{v.name}</span>
                              <span className="block text-chips text-muted">
                                {v.code} · {v.branch_name || 'Branch'}
                                {v.cycle_name ? ` · ${v.cycle_name}` : ''}
                                {v.status !== 'active' ? ' · suspended' : ''}
                              </span>
                            </span>
                            <span className="text-chips font-semibold text-brand">
                              {v.status === 'active' ? 'Select' : 'Suspended'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!vendorSearching && vendorQuery.trim().length >= 2 && vendorResults.length === 0 && (
                    <p className="mt-2 text-chips text-muted">No stand matches “{vendorQuery.trim()}”.</p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Member */}
          <section className="rounded-2xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Member</h3>
              {member && !editing && (
                <button
                  type="button"
                  onClick={() => { setMember(null); setQuery('') }}
                  className="inline-flex items-center gap-1 text-chips font-medium text-muted hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" /> Change
                </button>
              )}
            </div>

            {member ? (
              <div className="mt-2 space-y-2">
                <div className="rounded-xl bg-subtle/60 px-3 py-2">
                  <p className="text-sm font-semibold text-fg">{member.full_name || 'Member'} · {member.member_id}</p>
                  <p className="text-chips text-muted">{member.branch || 'Branch'} </p>
                </div>
                {/* Financial position stays private: the vendor sees who the
                    member is, not what they can afford. Limits are checked by
                    the server when the invoice is submitted. */}
                <p className="text-chips text-muted">
                  {editing ? 'The member cannot be changed on an existing invoice.' : 'Eligibility is checked when you submit the invoice.'}
                </p>
              </div>
            ) : (
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search staff ID or name"
                  aria-label="Search member"
                  className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-9 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                )}
                {results.length > 0 && (
                  <ul className="mt-2 max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                    {results.map((m) => (
                      <li key={m.member_id}>
                        <button
                          type="button"
                          onClick={() => { setMember(m); setResults([]) }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-subtle"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-fg">{m.full_name || m.member_id}</span>
                            <span className="block text-chips text-muted">{m.member_id} · {m.branch || '—'}</span>
                          </span>
                          <span className="text-chips font-semibold text-brand">Select</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="mt-2 text-chips text-muted">No member matches “{query.trim()}”.</p>
                )}
              </div>
            )}
          </section>

          {/* Items */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Items</h3>
              <span className="text-chips text-muted">{totals.qty} item{totals.qty === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-subtle/60 text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-10 px-2 py-2 text-left font-semibold">SN</th>
                    <th className="px-2 py-2 text-left font-semibold">Name</th>
                    <th className="w-20 px-2 py-2 text-left font-semibold">Qty</th>
                    <th className="w-32 px-2 py-2 text-left font-semibold">Price</th>
                    <th className="w-32 px-2 py-2 text-right font-semibold">Total</th>
                    <th className="w-10 px-1 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((it, idx) => {
                    const lineTotal = Math.max(0, Math.trunc(Number(it.qty) || 0)) * Math.max(0, Math.trunc(Number(it.price) || 0))
                    return (
                      <tr key={it.key}>
                        <td className="px-2 py-1.5 text-chips tabular-nums text-muted">{idx + 1}</td>
                        <td className="px-2 py-1.5">
                          <input
                            value={it.name}
                            onChange={(e) => updateItem(it.key, { name: e.target.value })}
                            placeholder="What did they buy?"
                            aria-label={`Item ${idx + 1} name`}
                            className={inputCls}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={it.qty}
                            onChange={(e) => updateItem(it.key, { qty: e.target.value.replace(/[^0-9]/g, '') })}
                            inputMode="numeric"
                            aria-label={`Item ${idx + 1} quantity`}
                            className={`${inputCls} text-center tabular-nums`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={it.price}
                            onChange={(e) => updateItem(it.key, { price: e.target.value.replace(/[^0-9]/g, '') })}
                            inputMode="numeric"
                            placeholder="0"
                            aria-label={`Item ${idx + 1} price`}
                            className={`${inputCls} tabular-nums`}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-fg">
                          {naira(lineTotal)}
                        </td>
                        <td className="px-1 py-1.5">
                          <button
                            type="button"
                            onClick={() => removeItem(it.key)}
                            disabled={items.length === 1}
                            title="Remove item"
                            className="rounded-lg p-1.5 text-muted hover:bg-danger-bg hover:text-danger-fg disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addItem}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-chips font-semibold text-brand hover:bg-subtle"
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </section>

          {/* Payment */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payment</h3>
            <div className="flex flex-wrap gap-2">
              {PAYMENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPayment(p)}
                  className={[
                    'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150',
                    payment === p
                      ? 'border-brand bg-brand text-on-accent'
                      : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
                  ].join(' ')}
                >
                  {p}
                </button>
              ))}
            </div>
            {editing && (
              <p className="mt-2 text-chips text-muted">
                Switching between Savings and Loan needs a new invoice.
              </p>
            )}

          </section>

          {!!error && (
            <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{error}</div>
          )}

          <div className="flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-chips text-muted">Invoice total</p>
              <p className="text-lg font-bold tabular-nums text-fg">{naira(totals.principal)}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} loading={submitting} disabled={!member || (isAdmin && !editing && !vendor) || totals.principal <= 0}>
                {editing ? 'Save changes' : isAdmin ? 'Raise invoice' : 'Submit invoice'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DraggableModal>
  )
}
