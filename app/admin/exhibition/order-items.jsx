'use client'

// app/admin/exhibition/order-items.jsx
// One rendering of what an order actually contains. The order queue's
// "View items" popup and the Checker's ledger popup both use this, so the desk
// reads the same member, payment, lines and totals wherever it opens an order.
//
// The restore controls are optional: putting a withdrawn item back writes to
// the order, and the Checker is read-only. The queue passes them in.
import { RotateCcw } from 'lucide-react'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

export function orderLineAmount(line) {
  const qty = Number(line?.qty || 0)
  return Number(line?.amount ?? qty * Number(line?.final_price ?? line?.vendor_price ?? 0))
}

export default function OrderItemsView({
  order,
  allowRestore = false,
  onRestoreLine,
  onRestoreAll,
  restoring = false,
}) {
  if (!order) return null
  const lines = order.lines || []
  const cancelled = order.cancelled_lines || []
  const subtotal = lines.reduce((sum, line) => sum + orderLineAmount(line), 0)
  const interest = Math.max(0, Number(order.total_amount || 0) - subtotal)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-subtle/60 p-3 text-sm sm:grid-cols-4">
        <div className="col-span-2 min-w-0">
          <p className="text-chips text-muted">Member</p>
          <p className="mt-0.5 break-words font-medium text-fg">
            {order.member_id}
            {order.member_name_snapshot ? ` · ${order.member_name_snapshot}` : ''}
            {order.member_phone ? ` · ${order.member_phone}` : ''}
          </p>
        </div>
        <div>
          <p className="text-chips text-muted">Payment</p>
          <p className="mt-0.5 font-medium text-fg">{order.payment_option || '—'}</p>
        </div>
        <div className="text-right sm:text-left">
          <p className="text-chips text-muted">Qty</p>
          <p className="mt-0.5 font-medium tabular-nums text-fg">
            {Number(order.total_qty || 0).toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 min-w-0">
          <p className="text-chips text-muted">Delivery Location</p>
          <p className="mt-0.5 break-words font-medium text-fg">
            {order.branch_name || `#${order.branch_id}`}
          </p>
        </div>
        <div className="col-span-2 min-w-0">
          <p className="text-chips text-muted">Cycle</p>
          <p className="mt-0.5 break-words font-medium text-fg">
            {order.cycle_name || order.cycle_code || '—'}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Items</h3>
          <span className="text-chips text-muted">
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {lines.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              No item lines recorded for this order.
            </p>
          ) : (
            lines.map((l) => {
              const qty = Number(l.qty || 0)
              const unit = Number(l.final_price ?? l.vendor_price ?? 0)
              return (
                <div key={l.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-fg">{l.product_name || 'Item'}</p>
                    <p className="mt-0.5 text-chips text-muted">
                      {[l.vendor_name, l.sku, `${qty} × ${naira(unit)}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                    {naira(orderLineAmount(l))}
                  </p>
                </div>
              )
            })
          )}
        </div>
      </div>

      {cancelled.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cancelled items</h3>
            <div className="flex items-center gap-3">
              <span className="text-chips text-muted">
                {cancelled.length} withdrawn
                {allowRestore ? ' · kept so they can go back' : ''}
              </span>
              {allowRestore && cancelled.length > 1 && onRestoreAll && (
                <button
                  type="button"
                  onClick={() => onRestoreAll()}
                  disabled={restoring}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-chips font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-50"
                >
                  Restore all
                </button>
              )}
            </div>
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {cancelled.map((c) => {
              const qty = Number(c.qty || 0)
              const unit = Number(c.final_price ?? c.vendor_price ?? 0)
              return (
                <div key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-muted line-through">
                      {c.product_name || 'Item'}
                    </p>
                    <p className="mt-0.5 text-chips text-muted">
                      {[
                        c.vendor_name,
                        c.sku,
                        `${qty} × ${naira(unit)}`,
                        c.cancelled_reason ? `— ${c.cancelled_reason}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-muted">{naira(c.amount)}</p>
                    {allowRestore && onRestoreLine && (
                      <button
                        type="button"
                        onClick={() => onRestoreLine(c)}
                        disabled={restoring}
                        className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-chips font-medium text-brand transition-colors hover:bg-subtle disabled:opacity-50"
                        title="Put this item back on the order — its stock is reserved again and the total recalculated"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>Items subtotal</span>
          <span className="tabular-nums">{naira(subtotal)}</span>
        </div>
        {interest > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm text-muted">
            <span>Loan interest</span>
            <span className="font-medium tabular-nums text-fg">{naira(interest)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm font-semibold text-fg">Total + Int</span>
          <span className="text-lg font-bold tabular-nums text-fg">{naira(order.total_amount)}</span>
        </div>
      </div>
    </div>
  )
}
