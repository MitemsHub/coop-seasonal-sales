// app/exhibition/orders/page.jsx
// Member-facing 'My exhibition orders' — track each order through the
// Pending → Approved → Delivered pipeline (Cancelled shows as a red state).
'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Package,
  Receipt,
  Store,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import { useAuth } from '../../contexts/AuthContext'
import useCartCount from '../../hooks/useCartCount'
import { writePendingIds, markPendingSeen } from '../../lib/exhibitionPendingBadge'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import { ExhibitionOrderStepper, EXHIBITION_STATUS_META } from '../../components/ui/OrderStepper'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

const STATUS_META = EXHIBITION_STATUS_META

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

function ExhibitionOrdersContent() {
  const router = useRouter()
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  // Live pending-exhibition badge wiring — announce after writing the key so
  // the Navbar's "awaiting approval" pill updates instantly.
  const { announceCart: announceExhPending } = useCartCount('exhibitionPending', { memberId })

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!memberId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/exhibition/orders?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (json?.ok) setOrders(json.orders || [])
        else setError(json?.error || 'Failed to load your exhibition orders')
      } catch {
        if (!cancelled) setError('Could not reach the Coop right now. Refresh to retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [memberId])

  // Pending exhibition orders — feeds the Navbar's "awaiting approval" badge.
  // This page IS the pending view, so the current queue is marked as SEEN
  // (fresh = false); the badge pulses only for genuinely new arrivals.
  useEffect(() => {
    try {
      if (!memberId) return
      const pendingOrders = orders.filter((o) => o.status === 'Pending')
      const pending = pendingOrders.length
      const ids = pendingOrders.map((o) => o.order_id)
      localStorage.setItem(`exhibitionPending_${memberId}`, String(pending))
      writePendingIds(memberId, ids)
      markPendingSeen(memberId, ids)
      announceExhPending({ qty: pending, fresh: false })
    } catch {}
  }, [memberId, orders, announceExhPending])

  const stats = useMemo(() => {
    const byStatus = { Pending: 0, Approved: 0, Delivered: 0, Cancelled: 0 }
    let total = 0
    for (const o of orders) {
      if (byStatus[o.status] !== undefined) byStatus[o.status]++
      if (o.status !== 'Cancelled') total += Number(o.total_amount || 0)
    }
    return { byStatus, total }
  }, [orders])

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl p-fluid pb-24">
          {/* Hero */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                My Exhibition Orders
              </div>
              <h1 className="mt-1.5 font-display text-h1 font-semibold tracking-tight text-fg">Track your orders</h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Follow each order from Pending approval to Delivered at your branch market.
              </p>
            </div>
          </div>

          {!!error && (
            <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
          )}

          {/* Summary strip */}
          {!loading && orders.length > 0 && (
            <div className="mb-fluid-lg grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="ui-card p-3 text-center">
                <div className="text-xl font-bold tabular-nums text-warning-fg">{stats.byStatus.Pending}</div>
                <div className="text-chips font-medium text-muted">Pending</div>
              </div>
              <div className="ui-card p-3 text-center">
                <div className="text-xl font-bold tabular-nums text-info-fg">{stats.byStatus.Approved}</div>
                <div className="text-chips font-medium text-muted">Approved</div>
              </div>
              <div className="ui-card p-3 text-center">
                <div className="text-xl font-bold tabular-nums text-success-fg">{stats.byStatus.Delivered}</div>
                <div className="text-chips font-medium text-muted">Delivered</div>
              </div>
              <div className="ui-card p-3 text-center">
                <div className="text-xl font-bold tabular-nums text-fg">{naira(stats.total)}</div>
                <div className="text-chips font-medium text-muted">Order value</div>
              </div>
            </div>
          )}

          {/* Orders */}
          {loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44 w-full rounded-2xl" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No exhibition orders yet"
              description="When you shop the exhibition, your orders will show up here with live status."
            >
              <Button leftIcon={Store} onClick={() => router.push('/exhibition')}>
                Browse Exhibition
              </Button>
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {orders.map((o) => {
                const meta = STATUS_META[o.status] || { tone: 'neutral', label: o.status, icon: Package }
                const StatusIcon = meta.icon
                return (
                  <div key={o.id} className="ui-card overflow-hidden">
                    {/* Order header */}
                    <div className="flex flex-col gap-3 border-b border-line bg-subtle/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold tabular-nums text-fg">{o.order_id}</span>
                          <Badge tone={meta.tone} variant="subtle" icon={StatusIcon}>
                            {meta.label}
                          </Badge>
                        </div>
                        <div className="mt-1 text-chips text-muted">{fmtDate(o.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-chips font-medium text-muted">{o.payment_option}</div>
                          <div className="text-sm font-bold tabular-nums text-fg">{naira(o.total_amount)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="border-b border-line px-4 py-4">
                      <ExhibitionOrderStepper status={o.status} />
                    </div>

                    {/* Lines */}
                    <div className="divide-y divide-line-subtle">
                      {(o.lines || []).map((l) => (
                        <div key={l.id} className="flex items-center gap-3 p-3.5">
                          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-subtle">
                            <Image
                              src={l.image_url || '/images/items/placeholder.svg'}
                              alt={l.product_name}
                              fill
                              sizes="48px"
                              className="object-cover"
                              onError={(e) => {
                                e.currentTarget.src = '/images/items/placeholder.svg'
                              }}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-fg">{l.product_name}</div>
                            <div className="text-chips text-muted">
                              {l.qty} × {naira(l.final_price)} {l.unit ? `· ${l.unit}` : ''}
                            </div>
                          </div>
                          <div className="text-sm font-bold tabular-nums text-fg">{naira(l.amount)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionOrdersPage() {
  return <ExhibitionOrdersContent />
}
