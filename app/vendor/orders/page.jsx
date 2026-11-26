'use client'

import { useEffect, useState } from 'react'
import { Eye, Plus, ShoppingBag, XCircle } from 'lucide-react'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DraggableModal from '../../components/DraggableModal'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import CounterInvoiceModal from '../../components/CounterInvoiceModal'

const fmtNaira = (n) => `NGN ${Number(n || 0).toLocaleString()}`

const STATUS_TONE = {
  Pending: 'warning',
  Approved: 'info',
  Confirmed: 'success',
  Cancelled: 'muted',
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Confirmed', label: 'Confirmed' },
  { key: 'Cancelled', label: 'Cancelled' },
]

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState(null)
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState('')
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [viewOrder, setViewOrder] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [lineTarget, setLineTarget] = useState(null)
  const [lineBusy, setLineBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = async () => {
    const qs = filter ? `?status=${filter}` : ''
    const res = await fetch(`/api/vendor/exhibition/orders${qs}`, { cache: 'no-store' })
    const json = await res.json()
    if (json.ok) setOrders(json.orders)
    else setMsg(json.error || 'Failed to load orders')
    return json.ok ? json.orders : []
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  // A vendor may withdraw an order that is entirely theirs, or a single item
  // from any open order. Item cancellation is not a status change: the API
  // recalculates the surviving lines, loan interest, the order total and this
  // stand's payable in one transaction, and cancels the order outright if
  // nothing is left. Restoring is the admin's call only
  // (/api/admin/exhibition/orders/restore), which is why the dialogs say so.
  const cancelLine = async () => {
    if (!lineTarget || lineBusy || !viewOrder) return
    setLineBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/vendor/exhibition/orders/lines/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: viewOrder.db_id, line_ids: [lineTarget.id] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to cancel that item')
      const label = lineTarget.product_name || 'Item'
      setLineTarget(null)
      const list = await load()
      setViewOrder((cur) => (cur ? list.find((o) => o.db_id === cur.db_id) || null : cur))
      setNotice({
        type: 'success',
        text: json.emptied
          ? `${label} cancelled — nothing was left on ${json.order.order_id}, so the order is cancelled too.`
          : `${label} cancelled. ${json.order.order_id} is now ${fmtNaira(json.order.total_amount)} for the member.`,
      })
    } catch (e) {
      setLineTarget(null)
      setNotice({ type: 'error', text: e.message })
    } finally {
      setLineBusy(false)
    }
  }

  const cancelOrder = async () => {
    if (!cancelTarget || cancelling) return
    setCancelling(true)
    setNotice(null)
    try {
      const res = await fetch('/api/vendor/exhibition/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cancelTarget.db_id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to cancel this order')
      const label = cancelTarget.order_id
      const result = (json.orders || [])[0]
      setCancelTarget(null)
      setNotice({
        type: 'success',
        text: result && result.emptied === false
          ? `${label} updated — your items came off. The order stays open for the other stands and is now ${fmtNaira(
              result.total_amount
            )} for the member.`
          : `${label} cancelled. The stock is back on the shelf.`,
      })
      await load()
    } catch (e) {
      setCancelTarget(null)
      setNotice({ type: 'error', text: e.message })
    } finally {
      setCancelling(false)
    }
  }

  const viewLines = viewOrder?.lines || []

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-h1 font-bold tracking-tight text-fg">Orders</h1>
          <p className="mt-1 text-sm text-muted">
            Raise an invoice at your stand, the admin approves it, and the member confirms receipt.
          </p>
        </div>
        <div className="sm:shrink-0">
          <Button leftIcon={Plus} onClick={() => setInvoiceOpen(true)}>
            New invoice
          </Button>
        </div>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}

      {!!notice && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}
        >
          {notice.text}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={[
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-[color,background-color,scale] duration-150 active:scale-[0.97]',
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
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
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
            <div
              key={o.order_id}
              className="rounded-2xl border border-line bg-surface transition-[border-color,box-shadow] duration-200 ease-sakani hover:border-line-strong hover:shadow-sm"
            >
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-fg">{o.order_id}</p>
                    <Badge tone={STATUS_TONE[o.status] || 'muted'}>{o.status}</Badge>
                    {o.status === 'Approved' && (
                      <span className="text-chips text-muted">waiting for the member to confirm</span>
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
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={Eye}
                    onClick={() => setViewOrder(o)}
                    aria-haspopup="dialog"
                    title="View the items on this order"
                  >
                    View items
                  </Button>
                  {o.can_cancel && (
                    <>
                      {o.shared && (
                        <span className="max-w-[11rem] text-right text-chips text-muted">
                          Shared order — Cancel removes only your items
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={XCircle}
                        onClick={() => {
                          setNotice(null)
                          setCancelTarget(o)
                        }}
                        title={o.shared ? 'Cancel your items on this order' : 'Cancel this order'}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Order items — the same summary + line-item popup pattern as the admin desk. */}
      <DraggableModal
        open={!!viewOrder}
        onClose={() => setViewOrder(null)}
        widthClass="max-w-2xl w-full mx-4"
        title={viewOrder ? `Items · ${viewOrder.order_id}` : 'Items'}
      >
        {viewOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-subtle/60 p-3 text-sm sm:grid-cols-4">
              <div className="col-span-2 min-w-0">
                <p className="text-chips text-muted">Member</p>
                <p className="mt-0.5 break-words font-medium text-fg">
                  {viewOrder.member_name || viewOrder.member_id || 'Member'}
                  {viewOrder.member_name && viewOrder.member_id ? ` · ${viewOrder.member_id}` : ''}
                </p>
              </div>
              <div>
                <p className="text-chips text-muted">Payment</p>
                <p className="mt-0.5 font-medium text-fg">{viewOrder.payment_option || '—'}</p>
              </div>
              <div className="text-right sm:text-left">
                <p className="text-chips text-muted">Qty</p>
                <p className="mt-0.5 font-medium tabular-nums text-fg">
                  {Number(viewOrder.my_qty ?? viewOrder.total_qty ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="col-span-2 min-w-0">
                <p className="text-chips text-muted">Delivery Location</p>
                <p className="mt-0.5 break-words font-medium text-fg">{viewOrder.branch_name || '—'}</p>
              </div>
              <div className="col-span-2 min-w-0">
                <p className="text-chips text-muted">Cycle</p>
                <p className="mt-0.5 break-words font-medium text-fg">{viewOrder.cycle_name || viewOrder.cycle_code || '—'}</p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Items</h3>
                <span className="text-chips text-muted">
                  {viewLines.length} line{viewLines.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="divide-y divide-line-strong overflow-hidden rounded-xl border border-line-strong">
                {viewLines.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted">No item lines recorded for this order.</p>
                ) : (
                  viewLines.map((l) => {
                    const qty = Number(l.qty || 0)
                    const unit = Number(l.final_price ?? l.vendor_price ?? 0)
                    return (
                      <div key={l.id} className="flex items-start gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium text-fg">{l.product_name || 'Item'}</p>
                          <p className="mt-0.5 text-chips text-muted">
                            {[l.sku, `${qty} × ${fmtNaira(unit)}`].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-fg">{fmtNaira(l.amount)}</p>
                          {viewOrder.can_cancel_lines && (
                            <button
                              type="button"
                              onClick={() => {
                                setNotice(null)
                                setLineTarget(l)
                              }}
                              className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-chips font-medium text-danger-fg transition-colors hover:bg-danger-bg"
                              title="Cancel this item — the order total and loan interest are recalculated"
                            >
                              <XCircle className="h-3 w-3" /> Cancel item
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-sm font-semibold text-fg">Total from your stand</span>
              <span className="text-lg font-bold tabular-nums text-fg">{fmtNaira(viewOrder.my_amount)}</span>
            </div>
          </div>
        )}
      </DraggableModal>

      <ConfirmDialog
        open={!!lineTarget}
        onClose={() => (lineBusy ? null : setLineTarget(null))}
        onConfirm={cancelLine}
        loading={lineBusy}
        title="Cancel this item?"
        confirmLabel="Cancel item"
        message={
          lineTarget
            ? `${lineTarget.product_name || 'Item'} (${lineTarget.qty} × ${fmtNaira(
                lineTarget.final_price
              )}) comes off this order and its stock goes back on sale. The order total and its loan interest are recalculated from the items that remain, and the member's payable for your stand drops by ${fmtNaira(
                lineTarget.amount
              )}. Only the co-op admin can restore a cancelled item.`
            : ''
        }
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => (cancelling ? null : setCancelTarget(null))}
        onConfirm={cancelOrder}
        loading={cancelling}
        title={cancelTarget?.shared ? 'Cancel your items?' : 'Cancel this order?'}
        confirmLabel={cancelTarget?.shared ? 'Cancel my items' : 'Cancel order'}
        message={
          cancelTarget
            ? cancelTarget.shared
              ? `${cancelTarget.order_id} also contains other stands' items. Cancelling takes your ${Number(
                  cancelTarget.my_qty || 0
                )} item(s) (${fmtNaira(
                  cancelTarget.my_amount
                )}) off it and the order is recalculated; the other stands keep theirs. Only the co-op admin can restore a cancelled item.`
              : `${cancelTarget.order_id} for ${cancelTarget.member_name || cancelTarget.member_id} will be cancelled in full and its reserved stock goes back on sale. Every item on this order is from your stand. Only the co-op admin can restore a cancelled order.`
            : ''
        }
      />

      <CounterInvoiceModal
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
        onCreated={load}
      />
    </div>
  )
}
