'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BadgePercent, Calendar, ClipboardCheck, Package, ShoppingBag, Store, TrendingUp } from 'lucide-react'
import Skeleton from '../../components/ui/Skeleton'
import { getTrail } from '@/lib/breadcrumbs'

const STATUS_STYLES = {
  Pending: 'border-warning-border bg-warning-bg text-warning-fg',
  Approved: 'border-info-border bg-info-bg text-info-fg',
  Delivered: 'border-success-border bg-success-bg text-success-fg',
  Cancelled: 'border-line bg-subtle text-muted',
}

function fmtNaira(n) {
  return `NGN ${Number(n || 0).toLocaleString()}`
}

// Live module availability chip — same treatment as the admin sidebar's
// Active/Closed pills, driven by the public exhibition-shopping flag.
function AvailabilityChip({ open }) {
  if (open == null) {
    return (
      <span className="inline-flex h-[26px] w-[74px] items-center justify-center rounded-full bg-subtle" aria-hidden="true">
        <span className="h-3 w-12 animate-pulse rounded-full bg-muted/40" />
      </span>
    )
  }
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        open ? 'bg-success-bg text-success-fg' : 'bg-line/70 text-muted',
      ].join(' ')}
    >
      <span className={['h-1.5 w-1.5 rounded-full', open ? 'bg-success-fg' : 'bg-muted'].join(' ')} aria-hidden="true" />
      {open ? 'Active' : 'Closed'}
    </span>
  )
}

export default function VendorDashboardPage() {
  const [stats, setStats] = useState(null)
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/vendor/exhibition/stats', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/vendor/session', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([s, p]) => {
        if (s?.ok) setStats(s.stats)
        if (p?.ok) setProfile(p)
        if (!s?.ok && s?.error) setError(s.error)
      })
      .catch(() => setError('Failed to load dashboard'))
  }, [])

  // Live module availability — re-read the vendor session every 60s so the
  // chip tracks their own season being opened/closed without a reload.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const r = await fetch('/api/vendor/session', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (cancelled || !j?.ok) return
        setProfile(j)
      } catch {
        // Best-effort — keep the last known season rather than flashing Closed.
      }
    }
    refresh()
    const id = setInterval(refresh, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const trail = getTrail('vendor', '/vendor/dashboard')

  // The vendor's own season drives both the chip and the closing date — the
  // only status that matters for their stand.
  const season = profile?.cycle
  const closesAt = season?.ends_at || null
  const live = profile ? season?.status === 'active' : null

  const cards = [
    {
      label: 'Active products',
      value: stats ? String(stats.product_count || 0) : null,
      icon: Package,
      href: '/vendor/products',
      hint: stats ? `${stats.live_products || 0} with photos` : '',
    },
    {
      label: 'Orders (mine)',
      value: stats ? String((stats.orders?.Pending || 0) + (stats.orders?.Approved || 0) + (stats.orders?.Delivered || 0)) : null,
      icon: ShoppingBag,
      href: '/vendor/orders',
      hint: `${stats?.orders?.Pending || 0} pending · ${stats?.orders?.Approved || 0} approved`,
    },
    {
      label: 'Earned so far',
      value: stats ? fmtNaira(stats.revenue) : null,
      icon: TrendingUp,
      href: '/vendor/orders',
      hint: stats ? `${stats.delivered_lines || 0} items delivered` : '',
    },
    {
      label: 'Deliveries checklist',
      value: stats ? String(stats.handover_pending ?? 0) : null,
      icon: ClipboardCheck,
      href: '/vendor/deliveries',
      hint: 'Approved items still to deliver',
    },
    {
      label: 'Prices & markups',
      value: 'Manage',
      icon: BadgePercent,
      href: '/vendor/markups',
      hint: 'Per-member negotiated prices',
    },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-h1 font-bold tracking-tight text-fg">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          {profile?.cycle?.status === 'active'
            ? `${profile?.cycle?.name || 'The exhibition'} is live. Keep your stand fresh.`
            : profile?.cycle
              ? `${profile?.cycle?.name || 'The exhibition'} is ${profile.cycle.status === 'draft' ? 'in preparation' : 'closed'}.`
              : 'Welcome to your vendor portal.'}
        </p>
      </div>

      {!!error && (
        <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
      )}

      {/* Live module availability — the vendor portal's module list, with the
          same Active/Closed chip treatment as the admin sidebar. */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg">
            <Store className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-fg">Coop Exhibition</p>
            <p className="truncate text-chips text-muted">
              {profile?.vendor?.name || 'Your stand'}
              {profile?.vendor?.branch ? ` · ${profile.vendor.branch}` : ''}
            </p>
          </div>
          <AvailabilityChip open={live} />
        </div>
        {season && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle pt-2.5 text-chips text-muted">
            {season?.name && <span className="font-medium text-fg">{season.name}</span>}
            {closesAt && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3 text-brand" strokeWidth={2.2} aria-hidden="true" />
                Season closes{' '}
                {new Date(closesAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="ui-card group p-5 transition-colors hover:border-brand/40"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted">{c.label}</p>
              <c.icon className="h-4.5 w-4.5 text-brand/70" strokeWidth={2} />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-fg">
              {stats || c.value === 'Manage' ? c.value : <Skeleton className="h-7 w-24" />}
            </div>
            <p className="mt-1 text-chips text-muted">{c.hint}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-bold text-fg">Order flow</h2>
          <Link href="/vendor/orders" className="text-sm font-medium text-brand hover:underline">
            View orders
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          {['Pending', 'Approved', 'Delivered', 'Cancelled'].map((s) => (
            <div key={s} className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-chips font-medium ${STATUS_STYLES[s]}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {s}
                </span>
              </div>
              <div className="mt-3 text-xl font-bold text-fg">
                {stats ? stats.orders?.[s] || 0 : <Skeleton className="h-6 w-10" />}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-5 py-3 text-chips text-muted">
          Orders are approved by the branch rep, then you hand the goods over and mark the order delivered.
        </div>
      </div>
    </div>
  )
}
