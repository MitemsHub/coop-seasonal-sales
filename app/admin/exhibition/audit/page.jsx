'use client'

// app/admin/exhibition/audit/page.jsx
// Admin audit log for Coop Exhibition orders. Every approved / cancelled /
// restored / delivered event — by reps, admins and vendors — with the order's
// member, branch, cycle and total, so admins can review staff actions from
// one place. Filter by action, branch, or search an order / member.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, History, Inbox, RefreshCw, RotateCcw, Search, Truck, XCircle } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table'
import Select from '../../../components/ui/Select'
import Skeleton from '../../../components/ui/Skeleton'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

const ACTION_META = {
  Approved: { tone: 'success', Icon: CheckCircle2 },
  Delivered: { tone: 'info', Icon: Truck },
  Restored: { tone: 'warning', Icon: RotateCcw },
  Cancelled: { tone: 'danger', Icon: XCircle },
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export default function AdminExhibitionAuditPage() {
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [branches, setBranches] = useState([])
  const [term, setTerm] = useState('')
  const [action, setAction] = useState('')
  const [branchId, setBranchId] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const fetchCtl = useRef(null)

  const safeJson = useCallback(async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }, [])

  const load = useCallback(
    async (opts = {}) => {
      setLoading(true)
      setMsg(null)
      try {
        if (fetchCtl.current) fetchCtl.current.abort()
        const ctl = new AbortController()
        fetchCtl.current = ctl
        const nextPage = Number(opts.page ?? page)
        const nextPageSize = Number(opts.pageSize ?? pageSize)
        const nextTerm = typeof opts.term === 'string' ? opts.term : term
        const nextAction = typeof opts.action === 'string' ? opts.action : action
        const nextBranch = typeof opts.branchId === 'string' ? opts.branchId : branchId
        const qs = new URLSearchParams({
          limit: String(Math.max(1, nextPageSize)),
          offset: String(Math.max(0, (nextPage - 1) * nextPageSize)),
          ...(nextTerm ? { q: nextTerm } : {}),
          ...(nextAction ? { action: nextAction } : {}),
          ...(nextBranch ? { branch_id: nextBranch } : {}),
        })
        const res = await fetch(`/api/admin/exhibition/audit?${qs}`, { cache: 'no-store', signal: ctl.signal })
        const json = await safeJson(res, '/api/admin/exhibition/audit')
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load audit log')
        setEvents(json.events || [])
        setTotal(Number(json.total ?? 0))
        if (json.branches?.length) setBranches(json.branches)
      } catch (e) {
        if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load audit log' })
      } finally {
        setLoading(false)
      }
    },
    [page, pageSize, term, action, branchId, safeJson]
  )

  useEffect(() => {
    load()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const safePage = Math.min(Math.max(1, page), pageCount)

  const runSearch = (nextTerm = term, nextAction = action, nextBranch = branchId) => {
    setPage(1)
    load({ page: 1, term: nextTerm, action: nextAction, branchId: nextBranch })
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <h1 className="text-h2 font-bold tracking-tight text-fg">Audit Log</h1>
          <p className="mt-0.5 text-sm text-muted">
            Who approved, cancelled, restored or delivered each exhibition order across every branch.
          </p>
        </div>

        {msg && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}>
            {msg.text}
          </div>
        )}

        {/* Filters */}
        <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="audit-search">
                  Search
                </label>
                <div className="flex gap-2">
                  <input
                    id="audit-search"
                    className="w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                    placeholder="Order ID / member…"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runSearch(e.target.value)
                    }}
                  />
                  <Button size="sm" leftIcon={Search} onClick={() => runSearch()} disabled={loading}>
                    Search
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="audit-action">
                  Action
                </label>
                <Select
                  id="audit-action"
                  value={action}
                  onChange={(e) => {
                    const next = e.target.value
                    setAction(next)
                    runSearch(term, next, branchId)
                  }}
                  className="w-full sm:w-44"
                >
                  <option value="">All actions</option>
                  <option value="Approved">Approved</option>
                  <option value="Cancelled">Cancelled</option>
                  <option value="Restored">Restored</option>
                  <option value="Delivered">Delivered</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="audit-branch">
                  Branch
                </label>
                <Select
                  id="audit-branch"
                  value={branchId}
                  onChange={(e) => {
                    const next = e.target.value
                    setBranchId(next)
                    runSearch(term, action, next)
                  }}
                  className="w-full sm:w-48"
                >
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={() => load()} disabled={loading}>
              Refresh
            </Button>
          </div>
          <div className="mt-3 text-sm text-muted">
            Events: <span className="font-medium text-fg">{Number(total || 0).toLocaleString()}</span>
          </div>
        </Card>

        <Card className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                <Inbox className="h-6 w-6 text-subtext" />
              </div>
              <p className="text-sm font-medium text-fg">No audit events found</p>
              <p className="max-w-sm text-xs text-muted">
                Approvals, cancellations, restores and deliveries by reps, admins and vendors will appear here.
              </p>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Order</TH>
                  <TH>Member</TH>
                  <TH>Branch</TH>
                  <TH>Actor</TH>
                  <TH>Note</TH>
                </TR>
              </THead>
              <TBody>
                {events.map((ev) => {
                  const meta = ACTION_META[ev.action] || { tone: 'neutral', Icon: History }
                  const o = ev.order || {}
                  return (
                    <TR key={ev.id}>
                      <TD className="whitespace-nowrap text-subtext">{fmtDateTime(ev.created_at)}</TD>
                      <TD>
                        <Badge tone={meta.tone} variant="subtle">
                          <span className="inline-flex items-center gap-1">
                            <meta.Icon className="h-3 w-3" strokeWidth={2.4} />
                            {ev.action}
                          </span>
                        </Badge>
                      </TD>
                      <TD>
                        <div className="font-medium text-fg">{o.order_id || `#${o.id}`}</div>
                        {o.status && (
                          <div className="text-xs text-subtext">
                            {o.status}
                            {Number(o.total_amount || 0) > 0 ? ` · ${naira(o.total_amount)}` : ''}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <div className="font-medium text-fg">{o.member_id || '—'}</div>
                        {o.member_name_snapshot && <div className="text-xs text-muted">{o.member_name_snapshot}</div>}
                      </TD>
                      <TD className="text-subtext">
                        {o.branch_name || '—'}
                        {o.cycle_name ? (
                          <div className="text-xs text-muted">{o.cycle_name}</div>
                        ) : null}
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand/70" aria-hidden="true" />
                          {ev.actor_label || ev.actor_type || '—'}
                        </span>
                      </TD>
                      <TD className="max-w-[220px]">
                        {ev.note ? (
                          <span className="text-xs text-muted">{ev.note}</span>
                        ) : (
                          <span className="text-xs text-subtext">—</span>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}

          {/* Pagination */}
          {!loading && total > 0 && (
            <div className="flex flex-col gap-3 border-t border-line bg-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); load({ page: 1, pageSize: Number(e.target.value) }) }} className="w-24">
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </Select>
                <span className="text-sm text-muted">
                  Page <span className="font-medium text-fg">{safePage}</span> / {pageCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={ChevronLeft}
                  onClick={() => { const next = Math.max(1, safePage - 1); setPage(next); load({ page: next }) }}
                  disabled={safePage <= 1 || loading}
                >
                  Prev
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  rightIcon={ChevronRight}
                  onClick={() => { const next = Math.min(pageCount, safePage + 1); setPage(next); load({ page: next }) }}
                  disabled={safePage >= pageCount || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </ProtectedRoute>
  )
}
