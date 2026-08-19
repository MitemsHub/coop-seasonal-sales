'use client'

// app/components/RamOrderAuditModal.jsx
// Shared per-order Activity viewer for the ram module. Reads the audit_log
// rows via the passed endpoint (/api/admin/ram/orders/audit or
// /api/rep/ram/orders/audit) and renders the same icon-tile timeline used by
// the exhibition order audit modal, so both modules stay pixel-identical.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, History, Package, RotateCcw, Truck, XCircle } from 'lucide-react'
import DraggableModal from './DraggableModal'

const AUDIT_ICON = {
  'Order placed': { Icon: Package, iconCls: 'text-muted', tileCls: 'bg-subtle' },
  Approved: { Icon: CheckCircle2, iconCls: 'text-success', tileCls: 'bg-success-bg' },
  Cancelled: { Icon: XCircle, iconCls: 'text-danger', tileCls: 'bg-danger-bg' },
  Restored: { Icon: RotateCcw, iconCls: 'text-brand', tileCls: 'bg-brand-subtle' },
  Delivered: { Icon: Truck, iconCls: 'text-success', tileCls: 'bg-success-bg' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function RamOrderAuditModal({ open, order, endpoint, onClose }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!open || !order?.id) return
    setEvents([])
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${endpoint}?order_id=${order.id}`, { cache: 'no-store' })
      const ct = res.headers.get('content-type') || ''
      const json = ct.includes('application/json') ? await res.json() : { ok: false, error: `Non-JSON response (${res.status})` }
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load activity')
      setEvents(json.events || [])
    } catch (e) {
      setError(e?.message || 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [open, order, endpoint])

  useEffect(() => {
    load()
  }, [load])

  // Timeline: the order's placement (synthesised from the row) + logged events.
  const items = useMemo(() => {
    const list = []
    if (order?.created_at) {
      list.push({
        key: 'placed',
        action: 'Order placed',
        actorLabel: String(order.member_id || 'Member'),
        note: '',
        created_at: order.created_at,
      })
    }
    for (const ev of events) {
      list.push({
        key: ev.id ?? `${ev.action}-${ev.created_at}`,
        action: ev.action,
        actorLabel: String(ev.actor_label || 'Unknown'),
        note: String(ev.note || ''),
        created_at: ev.created_at,
      })
    }
    return list
  }, [order, events])

  const close = () => {
    if (!loading) onClose()
  }

  return (
    <DraggableModal
      open={open}
      onClose={close}
      widthClass="max-w-lg w-full mx-4"
      title={order ? `Activity · #${order.id}` : 'Activity'}
    >
      <div className="space-y-3">
        {loading ? (
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
        ) : error ? (
          <div className="rounded-lg border border-danger-border bg-danger-bg/60 p-3 text-xs font-medium text-danger-fg">
            {error}
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No activity recorded for this order yet.</p>
        ) : (
          <ol className="relative">
            {items.map((ev, i) => {
              const { Icon, iconCls, tileCls } = AUDIT_ICON[ev.action] || { Icon: History, iconCls: 'text-muted', tileCls: 'bg-subtle' }
              const isLast = i === items.length - 1
              return (
                <li key={ev.key} className="relative flex gap-3 pb-5 last:pb-0">
                  {!isLast && (
                    <span aria-hidden="true" className="absolute left-4 top-9 bottom-0 w-px bg-line" />
                  )}
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
                      ev.action === 'Order placed' && (
                        <p className="mt-0.5 text-xs text-muted">By {ev.actorLabel}</p>
                      )
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </DraggableModal>
  )
}
