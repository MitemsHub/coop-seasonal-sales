'use client'

// app/admin/exhibition/checker/page.jsx
// One member ID in, the whole exhibition position out: balances and
// entitlements at the top, food orders, then every shopping day of the season
// in order, and the closing balance at the end. Read-only — nothing here
// writes to the member file.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, UserRound } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import Input from '../../../components/ui/Input'
import Skeleton from '../../../components/ui/Skeleton'
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table'

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

// Each order lives in the queue named after its status, and every queue accepts
// ?q= — so an order id here opens the desk that can act on it, already filtered.
const ORDER_QUEUE = {
  Pending: '/admin/exhibition/pending',
  Approved: '/admin/exhibition/approved',
  Delivered: '/admin/exhibition/delivered',
  Confirmed: '/admin/exhibition/confirmed',
  Cancelled: '/admin/exhibition/cancelled',
}

function orderHref(o) {
  const base = ORDER_QUEUE[String(o.status || '')] || ORDER_QUEUE.Pending
  return `${base}?q=${encodeURIComponent(String(o.order_id || ''))}`
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

  const check = useCallback(async (idArg) => {
    const id = String(idArg ?? memberId).trim().toUpperCase()
    if (!id) {
      setMsg({ type: 'error', text: 'Enter a member ID first.' })
      return
    }
    setLoading(true)
    setMsg(null)
    setData(null)
    try {
      const res = await fetch(`/api/admin/exhibition/checker?member_id=${encodeURIComponent(id)}`, {
        cache: 'no-store',
      })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        throw new Error(`Unexpected response (${res.status}) from the checker`)
      }
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Member not found')
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="checker-member">
                Member ID
              </label>
              <Input
                id="checker-member"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') check()
                }}
                placeholder="Enter ID, name"
                autoComplete="off"
              />
            </div>
            <Button leftIcon={Search} onClick={check} loading={loading}>
              Check member
            </Button>
          </div>
        </Card>

        {msg && (
          <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">
            {msg.text}
          </div>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label="Savings" value={naira(summary.savings)} />
                <Stat label="5× savings" value={naira(summary.five_x_savings)} note="Savings × 5" />
                <Stat label="Grade" value={summary.grade || '—'} />
                <Stat label="Global limit" value={naira(summary.global_limit)} />
                <Stat label="Loan balance" value={naira(summary.loan_balance)} note="As on the member file" />
                <Stat
                  label="Food orders"
                  value={naira(summary.food_total)}
                  note={`${summary.food_order_count} order${summary.food_order_count === 1 ? '' : 's'}${
                    summary.food_cycle_name ? ` · ${summary.food_cycle_name}` : ''
                  }`}
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
                <Table>
                  <THead>
                    <TR>
                      <TH className="pl-0">Day</TH>
                      <TH>Order</TH>
                      <TH>Time</TH>
                      <TH className="text-right">Total</TH>
                      <TH>Paid with</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>

                  {days.map((d) => (
                    <TBody key={d.date}>
                      {d.orders.map((o, i) => (
                        <TR key={`${d.date}-${o.order_id}-${i}`}>
                          {/* The day label is drawn once, but every row keeps the
                              cell: a rowSpan makes the following rows a column
                              narrower, which is what set EXH013 off its grid. */}
                          <TD className="pl-0 align-top">
                            {i === 0 ? (
                              <>
                                <div className="font-semibold text-fg">Day {d.day}</div>
                                <div className="text-xs text-muted">{d.date_label}</div>
                              </>
                            ) : null}
                          </TD>
                          <TD>
                            <Link
                              href={orderHref(o)}
                              className="font-medium text-brand underline-offset-2 hover:underline"
                              title="Open this order in its queue"
                            >
                              {o.order_id}
                            </Link>
                          </TD>
                          <TD className="text-muted">{timeOf(o.created_at)}</TD>
                          <TD className="text-right tabular-nums">{naira(o.amount)}</TD>
                          <TD className="text-muted">{o.payment_option || '—'}</TD>
                          <TD className="text-muted">{o.status || '—'}</TD>
                        </TR>
                      ))}
                      <TR className="bg-subtle/60 hover:bg-subtle/60">
                        <TD className="pl-0 text-xs font-semibold text-fg">Day {d.day} total</TD>
                        <TD className="text-xs text-muted" colSpan={2}>
                          {d.order_count} order{d.order_count === 1 ? '' : 's'}
                        </TD>
                        <TD className="text-right font-bold tabular-nums text-fg">{naira(d.total)}</TD>
                        <TD className="text-xs text-muted" colSpan={2}>
                          Savings {naira(d.savings)} · Loan {naira(d.loan)}
                        </TD>
                      </TR>
                    </TBody>
                  ))}
                </Table>
              )}

              {summary.exhibition_order_count ? (
                <p className="mt-2 text-xs text-muted">
                  Totals are what the member repays, interest included. Loan space left is
                  measured on the goods value, so it moves by less than the totals here.
                </p>
              ) : null}
            </Card>

            {/* Closing balance */}
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-fg">Balance at the end</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Total shopped" value={naira(summary.total_shopped)} note="Food + exhibition" />
                <Stat label="Paid from savings" value={naira(summary.savings_spent)} />
                <Stat
                  label="Savings balance left"
                  value={naira(savingsBalance)}
                  tone={savingsBalance < 0 ? 'text-danger-fg' : 'text-success-fg'}
                  note={`${naira(summary.savings)} − ${naira(summary.savings_spent)}`}
                />
                <Stat
                  label="Loan space left"
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
      </div>
    </ProtectedRoute>
  )
}
