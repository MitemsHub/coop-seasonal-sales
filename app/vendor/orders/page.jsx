'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, History, Package, PackageCheck, RotateCcw, ShoppingBag, Truck, XCircle } from 'lucide-react'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import DraggableModal from '../../components/DraggableModal'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'

const fmtNaira = (n) => `NGN ${Number(n || 0).toLocaleString()}`

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

const AUDIT_ICON = {
  'Order placed': { Icon: Package, iconCls: 'text-muted', tileCls: 'bg-subtle' },
  Approved: { Icon: CheckCircle2, iconCls: 'text-success', tileCls: 'bg-success-bg' },
  Cancelled: { Icon: XCircle, iconCls: 'text-danger', tileCls: 'bg-danger-bg' },
  Restored: { Icon: RotateCcw, iconCls: 'text-brand', tileCls: 'bg-brand-subtle' },
  Delivered: { Icon: Truck, iconCls: 'text-success', tileCls: 'bg-success-bg' },
}

const STATUS_TONE = {
  Pending: 'warning',
  Approved: 'info',
  Delivered: 'success',
  Cancelled: 'muted',
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Delivered', label: 'Delivered' },
  { key: 'Cancelled', label: 'Cancelled' },
]

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState(null)
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [activityOrder, setActivityOrder] = useState(null) // the order card row
  const [activityEvents, setActivityEvents] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState('')

  const load = async () => {
    const qs = filter ? `?status=${filter}` : ''
    const res = await fetch(`/api/vendor/exhibition/orders${qs}`, { cache: 'no-store' })
    const json = await res.json()
    if (json.ok) setOrders(json.orders)
    else setMsg(json.error || 'Failed to load orders')
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  // Audit trail for one order — who approved/cancelled/restored/delivered it.
  // Uses the vendor-scoped endpoint so vendors see the history behind an
  // order they marked delivered.
  const openActivity = async (o) => {
    setActivityOrder(o)
    setActivityEvents([])
    setActivityError('')
    setActivityLoading(true)
    try {
      const res = await fetch(`/api/vendor/exhibition/orders/audit?order_id=${o.db_id}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load activity')
      setActivityEvents(json.events || [])
    } catch (e) {
      setActivityError(e?.message || 'Failed to load activity')
    } finally {
      setActivityLoading(false)
    }
  }

  // Timeline: the order's placement (synthesised from the card row) + events.
  const activityItems = useMemo(() => {
    const items = []
    if (activityOrder?.created_at) {
      items.push({
        key: 'placed',
        action: 'Order placed',
        actorLabel: String(activityOrder.member_name || activityOrder.member_id || 'Member'),
        note: '',
        created_at: activityOrder.created_at,
      })
    }
    for (const ev of activityEvents) {
      items.push({
        key: ev.id ?? `${ev.action}-${ev.created_at}`,
        action: ev.action,
        actorLabel: String(ev.actor_label || 'Unknown'),
        note: String(ev.note || ''),
        created_at: ev.created_at,
      })
    }
    return items
  }, [activityOrder, activityEvents])

  const markDelivered = async (orderId) => {
    setBusy(orderId)
    setMsg('')
    try {
      const res = await fetch('/api/vendor/exhibition/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to update')
      load()
    } catch (e) {
      setMsg(e.message || 'Failed to mark delivered')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-h1 font-bold tracking-tight text-fg">Orders</h1>
        <p className="mt-1 text-sm text-muted">
          Orders from your stand. Once the branch rep approves and you hand the goods over, mark the order delivered.
        </p>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={[
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150',
              filter === f.key
                ? 'border-brand bg-brand text-on-accent'
                : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!orders ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No orders here"
          description={filter ? `No ${filter.toLowerCase()} orders from your stand.` : 'Orders members place from your stand will show up here.'}
        />
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <div key={o.order_id} className="rounded-2xl border border-line bg-surface">
              <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-fg">{o.order_id}</p>
                    <Badge tone={STATUS_TONE[o.status] || 'muted'}>{o.status}</Badge>
                    {o.status === 'Approved' && !o.all_delivered && (
                      <span className="text-chips text-muted">awaiting your delivery</span>
                    )}
                  </div>
                  <p className="mt-1 text-chips text-muted">
                    {o.member_name || o.member_id} · {o.payment_option} · {new Date(o.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 sm:shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-fg">{fmtNaira(o.my_amount)}</p>
                    <p className="text-chips text-muted">{o.my_qty} item{o.my_qty === 1 ? '' : 's'} from your stand</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openActivity(o)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-chips font-medium text-muted transition-colors duration-150 hover:bg-subtle hover:text-fg"
                    title="View the order's audit trail"
                  >
                    <History className="h-3.5 w-3.5" />
                    Activity
                  </button>
                  {o.status === 'Approved' && !o.all_delivered && (
                    <Button
                      variant="success"
                      leftIcon={PackageCheck}
                      onClick={() => markDelivered(o.order_id)}
                      loading={busy === o.order_id}
                    >
                      Mark delivered
                    </Button>
                  )}
                  {o.all_delivered && o.status === 'Delivered' && (
                    <span className="inline-flex items-center gap-1.5 text-chips font-medium text-success-fg">
                      <CheckCircle2 className="h-4 w-4" />
                      Delivered
                    </span>
                  )}
                </div>
              </div>
              <div className="divide-y divide-line">
                {o.lines.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">{l.product_name}</p>
                      <p className="text-chips text-muted">{l.sku}</p>
                    </div>
                    <p className="text-sm text-muted">×{l.qty}</p>
                    <p className="w-28 text-right text-sm font-medium text-fg">{fmtNaira(l.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Order activity — audit trail: who did what and when */}
      <DraggableModal
        open={!!activityOrder}
        onClose={() => setActivityOrder(null)}
        widthClass="max-w-lg w-full mx-4"
        title={activityOrder ? `Activity · ${activityOrder.order_id}` : 'Activity'}
      >
        <div className="space-y-3">
          {activityLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="sakani-skeleton h-8 w-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="sakani-skeleton h-3.5 w-2/3 rounded" />
                    <div className="sakani-skeleton h-3 w-1/3 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : activityError ? (
            <div className="rounded-lg border border-danger-border bg-danger-bg/60 p-3 text-xs font-medium text-danger-fg">
              {activityError}
            </div>
          ) : activityItems.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No activity recorded for this order yet.</p>
          ) : (
            <ol className="relative">
              {activityItems.map((ev, i) => {
                const { Icon, iconCls, tileCls } = AUDIT_ICON[ev.action] || { Icon: History, iconCls: 'text-muted', tileCls: 'bg-subtle' }
                const isLast = i === activityItems.length - 1
                return (
                  <li key={ev.key} className="relative flex gap-3 pb-5 last:pb-0">
                    {!isLast && <span aria-hidden="true" className="absolute left-4 top-9 bottom-0 w-px bg-line" />}
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tileCls}`}>
                      <Icon className={`h-4 w-4 ${iconCls}`} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <p className="text-sm font-medium text-fg">
                          {ev.action === 'Order placed' ? 'Order placed' : `${ev.action} by ${ev.actorLabel}`}
                        </p>
                        <time className="text-chips text-muted">{fmtDate(ev.created_at)}</time>
                      </div>
                      {ev.note ? (
                        <p className="mt-0.5 text-xs text-muted">
                          {ev.action === 'Cancelled' ? 'Reason: ' : ''}
                          {ev.note}
                        </p>
                      ) : (
                        ev.action === 'Order placed' && <p className="mt-0.5 text-xs text-muted">By {ev.actorLabel}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </DraggableModal>
    </div>
  )
}
