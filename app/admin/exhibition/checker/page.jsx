'use client'

// app/admin/exhibition/checker/page.jsx
// One member ID in, the whole exhibition position out: balances and
// entitlements at the top, food orders, then every shopping day of the season
// in order, and the closing balance at the end. Read-only — nothing here
// writes to the member file.
import { useCallback, useEffect, useState } from 'react'
import { Search, UserRound } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DraggableModal from '../../../components/DraggableModal'
import OrderItemsView from '../order-items'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import Input from '../../../components/ui/Input'
import Skeleton from '../../../components/ui/Skeleton'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(v || 0))

function timeOf(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}


// The shopping ledger is drawn once, from one description of an order. It is a
// four-column grid from `sm` up and the same grid folded into two columns on a
// phone, so a field can never be added to the table and forgotten in the card
// view (the two used to be written out separately).
const LEDGER_GRID = 'grid-cols-2 items-baseline gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_6rem]'

function LedgerHeader() {
  return (
    <div
      className={`hidden border-b border-line-subtle pb-1 text-xs font-semibold uppercase tracking-wide text-muted sm:grid ${LEDGER_GRID}`}
    >
      <span>Order</span>
      <span className="text-right">Total</span>
      <span>Paid with</span>
      <span>Status</span>
    </div>
  )
}

function LedgerOrderRow({ order, onOpen }) {
  return (
    <div className={`grid ${LEDGER_GRID} py-2`}>
      <div className="min-w-0">
        {/* Opens the order's items right here, the same popup the queue's
            "View items" shows — the desk stopped having to leave the member
            to see what was bought. */}
        <button
          type="button"
          onClick={() => onOpen?.(order)}
          className="text-left font-medium text-brand underline-offset-2 hover:underline"
          title="Show the items on this order"
        >
          {order.order_id}
        </button>
        <div className="text-xs text-muted">{timeOf(order.created_at)}</div>
      </div>
      <div className="text-right font-semibold tabular-nums text-fg">{naira(order.amount)}</div>
      <div className="text-muted">{order.payment_option || '—'}</div>
      <div className="text-right text-muted sm:text-left">{order.status || '—'}</div>
    </div>
  )
}

function DayLedger({ days, loanBasisIsGoods, onOpen }) {
  return (
    <div>
      <LedgerHeader />
      <div className="space-y-4">
        {days.map((d) => (
          <div key={d.date}>
            <div className="flex items-baseline justify-between gap-2 border-b border-line-subtle pb-1">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-fg">Day {d.day}</span>
                <span className="ml-2 text-xs text-muted">{d.date_label}</span>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-fg">{naira(d.total)}</span>
            </div>
            {d.orders.map((o, i) => (
              <LedgerOrderRow key={`${d.date}-${o.order_id}-${i}`} order={o} onOpen={onOpen} />
            ))}
            <div className="mt-1 text-xs text-muted">
              {d.order_count} order{d.order_count === 1 ? '' : 's'} · Savings {naira(d.savings)} · Loan{' '}
              {naira(d.loan)}
              {loanBasisIsGoods ? ' (goods value)' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, note, tone = '' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${tone || 'text-fg'}`}>{value}</div>
      {note ? <div className="mt-0.5 text-xs text-muted">{note}</div> : null}
    </div>
  )
}

export default function ExhibitionCheckerPage() {
  const [memberId, setMemberId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  // An order opened from the ledger, and the popup's own load state.
  const [viewOrder, setViewOrder] = useState(null)
  const [viewError, setViewError] = useState('')
  // A near-miss on the ID (or a name) comes back as a short list to tap, so a
  // phone keyboard is not the only way to reach the member.
  const [suggestions, setSuggestions] = useState([])

  const check = useCallback(async (idArg) => {
    // Called straight from a click handler, idArg is the event object — which
    // stringified to "[object Object]" and searched for a member that cannot
    // exist. Only strings (from the input or a suggestion) are used as an ID.
    const id = String(typeof idArg === 'string' ? idArg : memberId).trim().toUpperCase()
    if (!id) {
      setMsg({ type: 'error', text: 'Enter a member ID first.' })
      return
    }
    setLoading(true)
    setMsg(null)
    setData(null)
    setSuggestions([])
    try {
      const res = await fetch(`/api/admin/exhibition/checker?member_id=${encodeURIComponent(id)}`, {
        cache: 'no-store',
      })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        throw new Error(`Unexpected response (${res.status}) from the checker`)
      }
      const json = await res.json()
      if (!res.ok || !json?.ok) {
        // A miss with matches answers "try one of these" — the officer taps a
        // row instead of retyping an ID on a small keyboard.
        const near = Array.isArray(json?.suggestions) ? json.suggestions : []
        if (near.length) {
          setMemberId(id)
          setSuggestions(near)
          return
        }
        throw new Error(json?.error || 'Member not found')
      }
      setData(json)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to check member' })
    } finally {
      setLoading(false)
    }
  }, [memberId])

  // Arriving from an approvals row: the member ID is already in the URL, so
  // open the check straight away instead of asking the officer to retype it.
  useEffect(() => {
    let requested = ''
    try {
      requested = new URLSearchParams(window.location.search).get('member_id') || ''
    } catch {}
    const id = requested.trim().toUpperCase()
    if (id) {
      setMemberId(id)
      check(id)
      // The member is already open; leave their ID out of the address bar so
      // it is not in screenshots, chat messages or the browser history. A
      // reload starts from the empty form rather than carrying it.
      try {
        window.history.replaceState({}, '', window.location.pathname)
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open an order's items without leaving the member. The queue endpoint
  // returns each order with its lines, so the popup shows exactly what the
  // Pending page's "View items" shows; nothing is written from here.
  const openOrder = useCallback(async (row) => {
    const orderId = String(row?.order_id || '')
    if (!orderId) return
    setViewError('')
    setViewOrder({ order_id: orderId, lines: [], cancelled_lines: [], loading: true })
    try {
      // The queue endpoint hides cancelled orders by default; the ledger shows
      // them, so ask for that queue when the row is one.
      const cancelled = String(row?.status || '') === 'Cancelled' ? '&status=Cancelled' : ''
      const res = await fetch(
        `/api/admin/exhibition/orders?q=${encodeURIComponent(orderId)}&limit=5${cancelled}`,
        { cache: 'no-store' }
      )
      const json = await res.json().catch(() => null)
      const match = (json?.orders || []).find((o) => String(o.order_id) === orderId)
      if (match) setViewOrder(match)
      else {
        setViewOrder(null)
        setViewError(`Could not load ${orderId} from the order queue.`)
      }
    } catch {
      setViewOrder(null)
      setViewError(`Could not load ${orderId} from the order queue.`)
    }
  }, [])

  const closeOrder = useCallback(() => {
    setViewOrder(null)
    setViewError('')
  }, [])

  const summary = data?.summary
  const days = data?.days || []
  const savingsBalance = Number(summary?.savings_balance || 0)
  const loanParts = summary?.loan_space_parts || []

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-5">
          <h1 className="text-h2 font-bold tracking-tight text-fg">Checker</h1>
          <p className="mt-0.5 text-sm text-muted">
            Enter a member ID to see their balances, food orders, every shopping day of the season
            and the balance they close on.
          </p>
        </div>

        <Card className="mb-5 p-4">
          {/* A real form: phones get a Go key on the keyboard, and the button
              still submits to the same lookup. */}
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              check()
            }}
          >
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="checker-member">
                Member ID
              </label>
              <Input
                id="checker-member"
                value={memberId}
                onChange={(e) => {
                  setMemberId(e.target.value)
                  if (suggestions.length) setSuggestions([])
                }}
                placeholder="Enter ID, name"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                className="h-11 sm:h-9"
              />
            </div>
            <Button type="submit" leftIcon={Search} loading={loading} className="w-full sm:w-auto h-11 sm:h-9">
              Check member
            </Button>
          </form>
        </Card>

        {msg && (
          <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">
            {msg.text}
          </div>
        )}

        {suggestions.length > 0 && (
          <Card className="mb-4 p-4">
            <h2 className="text-sm font-semibold text-fg">No exact match</h2>
            <p className="mt-0.5 text-sm text-muted">
              Pick the member you meant, or correct the ID above.
            </p>
            <ul className="mt-1 divide-y divide-line-subtle">
              {suggestions.map((s) => (
                <li key={s.member_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMemberId(s.member_id)
                      check(s.member_id)
                    }}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors duration-150 hover:text-brand focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">
                        {s.full_name || '—'}
                      </span>
                      <span className="block text-xs text-muted">
                        {s.member_id}
                        {s.branch_name ? ` · ${s.branch_name}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-brand">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {loading && !data && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {data && summary && (
          <div className="space-y-5">
            {/* Who this is */}
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                    <UserRound className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-fg">
                      {data.member.full_name || '—'}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                      <span className="font-medium text-fg">{data.member.member_id}</span>
                      {data.member.category ? <span>· {data.member.category}</span> : null}
                      {data.member.branch_name ? (
                        <span>
                          · {data.member.branch_name}
                          {data.member.branch_code ? ` (${data.member.branch_code})` : ''}
                        </span>
                      ) : null}
                      {data.member.phone ? <span>· {data.member.phone}</span> : null}
                    </div>
                  </div>
                </div>
                {data.cycle ? (
                  <Badge tone={data.cycle.status === 'active' ? 'success' : 'neutral'}>
                    {data.cycle.name || data.cycle.code || `Season ${data.cycle.id}`}
                  </Badge>
                ) : (
                  <Badge tone="warning">No exhibition season</Badge>
                )}
              </div>
            </Card>

            {/* Balances and entitlements */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-fg">Member position</h2>
              {/* Two up on a phone: one tall column made the desk scroll past
                  six cards before reaching the shopping days. */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
                <Stat label="Savings" value={naira(summary.savings)} />
                <Stat label="5× savings" value={naira(summary.five_x_savings)} note="Savings × 5" />
                <Stat label="Grade" value={summary.grade || '—'} />
                <Stat label="Global limit" value={naira(summary.global_limit)} />
                <Stat label="Loan balance" value={naira(summary.loan_balance)} note="As on the member file" />
                <Stat
                  label="Food orders"
                  value={naira(summary.food_total)}
                  note={
                    summary.food_order_count
                      ? `${summary.food_order_count} order${summary.food_order_count === 1 ? '' : 's'} · ${
                          summary.food_payment_methods?.length
                            ? `paid by ${summary.food_payment_methods.join(' & ')}`
                            : 'payment not set'
                        }`
                      : 'No food this year'
                  }
                />
              </div>
            </div>

            {/* Day-by-day shopping */}
            <Card className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-fg">Shopping day by day</h2>
                <span className="text-xs text-muted">
                  {summary.exhibition_order_count} exhibition order
                  {summary.exhibition_order_count === 1 ? '' : 's'} ·{' '}
                  {summary.shopping_days} shopping day{summary.shopping_days === 1 ? '' : 's'}
                </span>
              </div>

              {!summary.exhibition_order_count ? (
                <p className="text-sm text-muted">
                  This member has no exhibition orders yet. Food orders are counted in the member
                  position above, not in this day-by-day ledger.
                </p>
              ) : (
                <DayLedger days={days} loanBasisIsGoods={summary.loan_basis_is_goods} onOpen={openOrder} />
              )}

              {summary.exhibition_order_count ? (
                <p className="mt-2 text-xs text-muted">
                  The Total column is what the member repays, interest included. The Loan figure
                  under each day is the goods value the loan room was debited by, so it adds up
                  with the Available Loan Facility card instead of the repayable total.
                </p>
              ) : null}
            </Card>

            {/* Closing balance */}
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-fg">Balance at the end</h2>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                <Stat
                  label="Total shopped (Prin. Only)"
                  value={naira(summary.total_shopped)}
                  note={
                    <span className="block">
                      <span className="block">Food = {naira(summary.food_total)}</span>
                      <span className="block">Exhibition = {naira(summary.exhibition_principal)}</span>
                    </span>
                  }
                />
                <Stat label="Paid from savings" value={naira(summary.savings_spent)} />
                <Stat
                  label="Savings balance left"
                  value={naira(savingsBalance)}
                  tone={savingsBalance < 0 ? 'text-danger-fg' : 'text-success-fg'}
                  note={`${naira(summary.savings)} − ${naira(summary.savings_spent)}`}
                />
                <Stat
                  label="Available Loan Facility"
                  value={summary.loan_space_left == null ? '—' : naira(summary.loan_space_left)}
                  note={
                    loanParts.length ? (
                      <span>
                        {loanParts.map((p, i) => (
                          <span key={`${p.label}-${i}`}>
                            {i > 0 ? (p.op === '-' ? ' − ' : ' + ') : ''}
                            {p.label} {naira(p.amount)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      summary.loan_space_warning || 'Remaining for this season'
                    )
                  }
                />
              </div>
              <p className="text-xs text-muted">
                Cancelled orders are left out of every line: they were never purchases, so the
                closing balance matches what the member actually spent.
              </p>
            </Card>
          </div>
        )}

        <DraggableModal
          open={!!viewOrder || !!viewError}
          onClose={closeOrder}
          widthClass="max-w-2xl w-full mx-4"
          title={viewOrder ? `Items · ${viewOrder.order_id || ''}` : 'Order items'}
        >
          {viewError ? (
            <p className="px-1 py-6 text-center text-sm text-muted">{viewError}</p>
          ) : viewOrder?.loading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <OrderItemsView order={viewOrder} />
          )}
        </DraggableModal>
      </div>
    </ProtectedRoute>
  )
}
