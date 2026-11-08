// app/components/CounterInvoiceModal.jsx
// The invoice filled in at the stand: pick the vendor stand (admin desk only),
// pick the member, key the items (SN is automatic), choose Cash / Savings /
// Loan, submit. No catalogue. The same form edits a pending invoice when
// `order` is supplied.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Landmark, Loader2, MessageCircle, Plus, Search, Store, Trash2, X } from 'lucide-react'
import DraggableModal from './DraggableModal'
import Button from './ui/Button'

const naira = (n) => `NGN ${Number(n || 0).toLocaleString()}`
const newItem = () => ({ key: Math.random().toString(36).slice(2), name: '', qty: '1', price: '' })
const PAYMENTS = ['Cash', 'Savings', 'Loan']
const CATEGORY_LABELS = { A: 'Active', R: 'Retiree', P: 'Pensioner', E: 'Coop Staff' }
const SAVINGS_LOAN_ERROR = 'This member has an outstanding loan. Savings cannot be used — choose Loan or Cash.'
const CASH_BANK = {
  bankName: 'Guaranty Trust Bank',
  accountNumber: '0023723318',
  accountName: 'CBN Staff Multipurpose Cooperative Society Limited',
  phone: '09061388502',
  whatsapp: 'https://wa.me/+2349061388502',
}

function categoryLabel(m) {
  const code = String(m?.category || '').trim().toUpperCase()
  return CATEGORY_LABELS[code] || String(m?.category || '').trim()
}

function memberMeta(m) {
  const values = [m?.branch, m?.department].map((v) => String(v || '').trim()).filter(Boolean)
  return [...new Set(values)].join(' · ')
}

function memberRole(m) {
  return [categoryLabel(m), String(m?.grade || '').trim()].filter(Boolean).join(' · ')
}

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
  const [loanRatePct, setLoanRatePct] = useState(null)
  const [loanRateError, setLoanRateError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const [financials, setFinancials] = useState(null)
  const [financialsLoading, setFinancialsLoading] = useState(false)
  const [financialsError, setFinancialsError] = useState('')

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
    setLoanRatePct(null)
    setLoanRateError('')
    setSubmitting(false)
    setError('')
    setCreated(null)
    setFinancials(null)
    setFinancialsLoading(false)
    setFinancialsError('')
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

  // The live loan rate comes from the active cycle, so the modal shows the same
  // interest the create route will apply.
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setLoanRatePct(null)
    setLoanRateError('')
    fetch('/api/exhibition/availability', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return
        const rate = Number(json?.cycle?.loan_interest_rate_pct)
        if (json?.ok && json?.cycle && Number.isFinite(rate)) {
          setLoanRatePct(rate)
        } else {
          setLoanRateError('Could not load the current loan interest rate. Refresh and try again.')
        }
      })
      .catch(() => {
        if (alive) setLoanRateError('Could not load the current loan interest rate. Refresh and try again.')
      })
    return () => {
      alive = false
    }
  }, [open])

  // Admin only: show the member's financial standing for the invoice's
  // cycle. Vendors deliberately never receive these balances.
  useEffect(() => {
    if (!open || !isAdmin || !member?.member_id) {
      setFinancials(null)
      setFinancialsLoading(false)
      setFinancialsError('')
      return undefined
    }
    let alive = true
    const params = new URLSearchParams({ member_id: member.member_id })
    const cycleId = order?.cycle_id || vendor?.cycle_id
    if (cycleId) params.set('cycle_id', String(cycleId))
    setFinancials(null)
    setFinancialsLoading(true)
    setFinancialsError('')
    fetch(`/api/admin/exhibition/members/financials?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load financial standing')
        if (alive) setFinancials(json)
      })
      .catch((e) => {
        if (alive) setFinancialsError(e?.message || 'Could not load financial standing')
      })
      .finally(() => {
        if (alive) setFinancialsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, isAdmin, member?.member_id, order?.cycle_id, vendor?.cycle_id])

  const totals = useMemo(() => {
    let qty = 0
    let principal = 0
    for (const it of items) {
      const q = Math.max(0, Math.trunc(Number(it.qty) || 0))
      const p = Math.max(0, Math.trunc(Number(it.price) || 0))
      qty += q
      principal += q * p
    }
    const rate = loanRatePct == null ? 0 : Math.max(0, Number(loanRatePct) || 0)
    const interest = payment === 'Loan' ? Math.round((principal * rate) / 100) : 0
    return { qty, principal, interest, total: principal + interest }
  }, [items, payment, loanRatePct])
  const loanRateReady = loanRatePct != null && Number.isFinite(Number(loanRatePct))

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
    if (payment === 'Savings' && member.has_loan) {
      setError(SAVINGS_LOAN_ERROR)
      return
    }
    if (payment === 'Loan' && !loanRateReady) {
      setError(loanRateError || 'The loan interest rate is still loading. Please try again.')
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
        payload.member_id = member.member_id
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
      title={editing ? 'Edit Invoice' : 'New Invoice'}
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
                    <p className="truncate text-chips text-muted">{vendor.code || 'Vendor stand'}</p>
                    <p className="mt-0.5 truncate text-chips text-muted">
                      <span className="font-medium text-fg">Branch:</span>{' '}
                      {vendor.branch_name || vendor.branch || 'Not set'}
                    </p>
                    <p className="truncate text-chips text-muted">
                      <span className="font-medium text-fg">Active cycle:</span>{' '}
                      {vendor.cycle_name || vendor.cycle || 'Not set'}
                      {vendor.status && vendor.status !== 'active' ? ' · suspended' : ''}
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
                                {v.code}
                                {v.status !== 'active' ? ' · suspended' : ''}
                              </span>
                              <span className="block text-chips text-muted">
                                Branch: {v.branch_name || 'Not set'}
                              </span>
                              <span className="block text-chips text-muted">
                                Active cycle: {v.cycle_name || 'Not set'}
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
                  {memberMeta(member) && <p className="text-chips text-muted">{memberMeta(member)}</p>}
                  {memberRole(member) && <p className="text-chips text-muted">{memberRole(member)}</p>}
                </div>
                {/* Financial position stays private: the vendor sees who the
                    member is, not what they can afford. Limits are checked by
                    the server when the invoice is submitted. */}
                {isAdmin ? (
                  <div className="rounded-xl border border-line bg-subtle/40 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <p className="text-chips font-semibold uppercase tracking-wide text-muted">Financial standing</p>
                      {financials?.cycle?.name && (
                        <p className="text-chips text-muted">Cycle: {financials.cycle.name}</p>
                      )}
                    </div>
                    {financialsLoading ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="sakani-skeleton h-14 rounded-lg" />
                        ))}
                      </div>
                    ) : financialsError ? (
                      <p className="mt-2 rounded-lg border border-danger-border bg-danger-bg px-2.5 py-2 text-xs text-danger-fg">
                        {financialsError}
                      </p>
                    ) : financials ? (
                      <>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2">
                            <p className="text-chips text-muted">Savings</p>
                            <p className="truncate text-sm font-bold tabular-nums text-fg">{naira(financials.financials?.savings)}</p>
                          </div>
                          <div className="min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2">
                            <p className="text-chips text-muted">Loans</p>
                            <p className="truncate text-sm font-bold tabular-nums text-fg">{naira(financials.financials?.loans)}</p>
                          </div>
                          <div className="min-w-0 rounded-lg border border-success-border bg-success-bg/40 px-2.5 py-2">
                            <p className="text-chips text-muted">Remaining credit facility</p>
                            <p className="truncate text-sm font-bold tabular-nums text-success-fg">{naira(financials.financials?.loan_eligible)}</p>
                          </div>
                        </div>
                        <p className="mt-1.5 text-chips text-muted">
                          Outstanding loans incl. shopping exposure: {naira(financials.financials?.outstanding_loans_total)}
                          {' · '}Savings available: {naira(financials.financials?.savings_eligible)}
                        </p>
                        {financials.financials?.warning && (
                          <p className="mt-1 text-chips text-warning-fg">{financials.financials.warning}</p>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : null}
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
                          onClick={() => {
                            setMember(m)
                            setResults([])
                            if (m.has_loan && payment === 'Savings') {
                              setPayment('Cash')
                              setError(SAVINGS_LOAN_ERROR)
                            } else {
                              setError('')
                            }
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-subtle"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-fg">{m.full_name || m.member_id}</span>
                            <span className="block text-chips text-muted">
                              {m.member_id}
                              {memberMeta(m) ? ` · ${memberMeta(m)}` : ''}
                            </span>
                            {memberRole(m) && <span className="block text-chips text-muted">{memberRole(m)}</span>}
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
            <div className="hidden overflow-x-auto rounded-xl border border-line sm:block">
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

            {/* Phones get stacked item editors so every field and total fits. */}
            <div className="space-y-3 sm:hidden">
              {items.map((it, idx) => {
                const lineTotal = Math.max(0, Math.trunc(Number(it.qty) || 0)) * Math.max(0, Math.trunc(Number(it.price) || 0))
                return (
                  <div key={it.key} className="rounded-xl border border-line bg-surface p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-chips font-semibold uppercase tracking-wide text-muted">Item {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-fg">{naira(lineTotal)}</span>
                        <button
                          type="button"
                          onClick={() => removeItem(it.key)}
                          disabled={items.length === 1}
                          title="Remove item"
                          aria-label={`Remove item ${idx + 1}`}
                          className="rounded-lg p-1.5 text-muted hover:bg-danger-bg hover:text-danger-fg disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="mb-1 block text-[11px] font-medium text-subtext" htmlFor={`item-name-${it.key}`}>
                        Name
                      </label>
                      <input
                        id={`item-name-${it.key}`}
                        value={it.name}
                        onChange={(e) => updateItem(it.key, { name: e.target.value })}
                        placeholder="What did they buy?"
                        aria-label={`Item ${idx + 1} name`}
                        className={inputCls}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-subtext" htmlFor={`item-qty-${it.key}`}>
                          Qty
                        </label>
                        <input
                          id={`item-qty-${it.key}`}
                          value={it.qty}
                          onChange={(e) => updateItem(it.key, { qty: e.target.value.replace(/[^0-9]/g, '') })}
                          inputMode="numeric"
                          aria-label={`Item ${idx + 1} quantity`}
                          className={`${inputCls} text-center tabular-nums`}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-subtext" htmlFor={`item-price-${it.key}`}>
                          Price (NGN)
                        </label>
                        <input
                          id={`item-price-${it.key}`}
                          value={it.price}
                          onChange={(e) => updateItem(it.key, { price: e.target.value.replace(/[^0-9]/g, '') })}
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={`Item ${idx + 1} price`}
                          className={`${inputCls} tabular-nums`}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-chips font-semibold text-brand hover:bg-subtle"
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </section>

          {/* Payment method */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payment Method</h3>
            <div className="flex flex-wrap gap-2">
              {PAYMENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    if (p === 'Savings' && member?.has_loan) {
                      setError(SAVINGS_LOAN_ERROR)
                      return
                    }
                    setPayment(p)
                    setError('')
                  }}
                  title={p === 'Savings' && member?.has_loan ? 'Savings is unavailable while the member has a loan' : undefined}
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

            {payment === 'Loan' && (
              <div className="mt-2 rounded-xl border border-warning-border bg-warning-bg/60 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-warning-fg">Loan Payment</div>
                    {loanRateReady ? (
                      <>
                        <p className="mt-0.5 text-xs text-muted">
                          Interest Rate: {Number(loanRatePct)}% interest will be charged on all items purchased using the loan payment option.
                        </p>
                        <p className="mt-1 text-xs font-medium text-fg">
                          Interest {naira(totals.interest)} · Total payable {naira(totals.total)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted">
                        {loanRateError || 'Loading the current loan interest rate…'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {payment === 'Savings' && (
              <div className="mt-2 rounded-xl border border-info-border bg-info-bg/60 p-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-info-fg" strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-info-fg">Savings Payment</div>
                    <p className="mt-0.5 text-xs text-muted">
                      The invoice value will be deducted from the member&apos;s savings when it is approved. The server checks the available savings balance before accepting the invoice.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {payment === 'Cash' && (
              <div className="mt-2 rounded-xl border border-info-border bg-info-bg/60 p-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-info-fg" strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-info-fg">Cash Payment</div>
                    <p className="mt-0.5 text-xs text-muted">
                      After raising the invoice, kindly send your payment receipt to the Cooperative ({CASH_BANK.phone}) for verification.
                    </p>
                    <div className="mt-2 rounded-lg border border-info-border bg-surface p-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-fg">
                        <Landmark className="h-4 w-4 text-info-fg" strokeWidth={2} />
                        Bank Transfer Details
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs text-muted">
                        <div>{CASH_BANK.bankName}</div>
                        <div>Account Number: {CASH_BANK.accountNumber}</div>
                        <div>Account Name: {CASH_BANK.accountName}</div>
                      </div>
                    </div>
                    <a
                      href={CASH_BANK.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-2 rounded-lg bg-success-fg px-3 py-2 text-xs font-medium text-on-accent transition-[filter] duration-200 hover:brightness-110"
                    >
                      <MessageCircle className="h-4 w-4" strokeWidth={2} />
                      Send Receipt via WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            )}
          </section>

          {!!error && (
            <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{error}</div>
          )}

          <div className="flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-chips text-muted">{payment === 'Loan' ? 'Invoice total (principal)' : 'Invoice total'}</p>
              <p className="text-lg font-bold tabular-nums text-fg">{naira(totals.principal)}</p>
              {payment === 'Loan' && loanRateReady && (
                <p className="text-chips text-muted">
                  Interest ({Number(loanRatePct)}%): {naira(totals.interest)} · Total: {naira(totals.total)}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} loading={submitting} disabled={!member || (isAdmin && !editing && !vendor) || totals.principal <= 0 || (payment === 'Loan' && !loanRateReady)}>
                {editing ? 'Save changes' : isAdmin ? 'Raise invoice' : 'Submit invoice'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DraggableModal>
  )
}
