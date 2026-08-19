'use client'

// app/rep/page.jsx
// Rep dashboard landing — the rep's home inside the portal.
// Module-aware: the logged-in module drives the stats strip + charts
// (Food / Ram / Coop Exhibition), and quick-access tiles link into every
// module the rep is permitted to use. Unauthenticated visits get a sign-in
// prompt instead of zeros.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'
import {
  ArrowRight,
  Beef,
  CheckCircle2,
  Clock,
  Home,
  Landmark,
  Package,
  RefreshCw,
  Send,
  ShoppingBasket,
  Sparkles,
  Store,
  Truck,
  XCircle,
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import { BarChart, LineChart, ChartEmpty } from '../components/ui/Charts'

export const dynamic = 'force-dynamic'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

const MODULE_META = {
  food: { label: 'Food Distribution', icon: ShoppingBasket, moduleName: 'Food' },
  ram: { label: 'Ram Sales', icon: Beef, moduleName: 'Ram' },
  exhibition: { label: 'Coop Exhibition', icon: Store, moduleName: 'Exhibition' },
}

// Status tones for the chips inside the quick-access tiles.
const STATUS_TONE = {
  Pending: 'warning',
  Posted: 'info',
  Approved: 'success',
  Delivered: 'success',
  Cancelled: 'danger',
}

// Page tiles per module — mirrors the sidebar destinations so the dashboard
// works as a jump-off point into every page of each module.
const QUICK_LINKS = {
  food: [
    { href: '/rep/posted', label: 'Posted', icon: Send, desc: 'Orders ready to process' },
    { href: '/rep/delivered', label: 'Delivered', icon: Truck, desc: 'Delivered this cycle' },
    { href: '/rep/banks', label: 'Banks', icon: Landmark, desc: 'Branch bank details' },
  ],
  ram: [
    { href: '/rep/ram/approved', label: 'Approved', icon: CheckCircle2, desc: 'Approve and manage ram orders' },
    { href: '/rep/ram/delivered', label: 'Delivered', icon: Truck, desc: 'Delivered ram orders' },
    { href: '/rep/ram/banks', label: 'Banks', icon: Landmark, desc: 'Vendor bank accounts' },
  ],
  exhibition: [
    { href: '/rep/exhibition/pending', label: 'Pending', icon: Clock, desc: 'Orders awaiting approval' },
    { href: '/rep/exhibition/approved', label: 'Approved', icon: CheckCircle2, desc: 'Ready for vendor handover' },
    { href: '/rep/exhibition/delivered', label: 'Delivered', icon: Truck, desc: 'Delivered to members' },
    { href: '/rep/exhibition/cancelled', label: 'Cancelled', icon: XCircle, desc: 'Review and restore' },
    { href: '/rep/exhibition/banks', label: 'Banks', icon: Landmark, desc: 'Vendor bank accounts' },
  ],
}

const STATUS_ORDER = ['Pending', 'Approved', 'Posted', 'Delivered', 'Cancelled']

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Per-module stats strips
   ═══════════════════════════════════════════════════════════════════ */
function FoodStats({ loading, data }) {
  const todayPending = data?.todayPending || {}
  const posted = data?.postedCycle || {}
  const delivered = data?.deliveredCycle || {}
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard
        loading={loading}
        featured
        icon={Clock}
        title="Pending today"
        value={loading ? '' : (todayPending.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(todayPending.total)}
        trend={(todayPending.count ?? 0) > 0 ? 'up' : 'flat'}
      />
      <StatCard
        loading={loading}
        icon={Send}
        title="Posted this cycle"
        value={loading ? '' : (posted.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(posted.total)}
        trend={(posted.count ?? 0) > 0 ? 'up' : 'flat'}
      />
      <StatCard
        loading={loading}
        icon={Truck}
        title="Delivered this cycle"
        value={loading ? '' : (delivered.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(delivered.total)}
        trend={(delivered.count ?? 0) > 0 ? 'up' : 'flat'}
      />
    </div>
  )
}

// Ram reps work only with Approved and Delivered — they never see Pending
// orders, so the strip skips Pending and the irrelevant "Today" figure.
function RamStats({ loading, data }) {
  const statuses = data?.statuses || {}
  const approved = statuses.Approved || {}
  const deliveredCycle = data?.deliveredCycle || {}
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard
        loading={loading}
        featured
        icon={CheckCircle2}
        title="Approved"
        value={loading ? '' : (approved.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(approved.total)}
        trend={(approved.count ?? 0) > 0 ? 'up' : 'flat'}
      />
      <StatCard
        loading={loading}
        icon={Truck}
        title="Delivered this cycle"
        value={loading ? '' : (deliveredCycle.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(deliveredCycle.total)}
        trend={(deliveredCycle.count ?? 0) > 0 ? 'up' : 'flat'}
      />
    </div>
  )
}

function PipelineStats({ loading, data, moduleName }) {
  const statuses = data?.statuses || {}
  const today = data?.today || {}
  const deliveredCycle = data?.deliveredCycle || {}
  const pending = statuses.Pending || {}
  const approved = statuses.Approved || {}
  const delivered = statuses.Delivered || {}
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        loading={loading}
        featured
        icon={Clock}
        title="Pending"
        value={loading ? '' : (pending.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(pending.total)}
        trend={(pending.count ?? 0) > 0 ? 'up' : 'flat'}
      />
      <StatCard
        loading={loading}
        icon={CheckCircle2}
        title="Approved"
        value={loading ? '' : (approved.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(approved.total)}
        trend={(approved.count ?? 0) > 0 ? 'up' : 'flat'}
      />
      <StatCard
        loading={loading}
        icon={Truck}
        title={`Delivered this ${moduleName === 'Exhibition' ? 'season' : 'cycle'}`}
        value={loading ? '' : (deliveredCycle.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(deliveredCycle.total)}
        trend={(deliveredCycle.count ?? 0) > 0 ? 'up' : 'flat'}
      />
      <StatCard
        loading={loading}
        icon={Sparkles}
        title="Today"
        value={loading ? '' : (today.count ?? 0).toLocaleString()}
        delta={loading ? '' : naira(today.total)}
        trend={(today.count ?? 0) > 0 ? 'up' : 'flat'}
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Season comparison (exhibition) — per-cycle breakdown so reps can
   compare activity across exhibition seasons at their branch.
   ═══════════════════════════════════════════════════════════════════ */
const CYCLE_TONE = { active: 'success', closed: 'neutral', draft: 'warning' }

function SeasonCompare({ loading, data }) {
  const cycles = data?.cycles || []
  const currentId = data?.cycle?.id
  return (
    <Card className="mt-6">
      <Card.Header>
        <Card.Title>Season comparison</Card.Title>
        <Card.Description>How each exhibition season performed at your branch.</Card.Description>
      </Card.Header>
      <Card.Body className="p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : cycles.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No exhibition seasons yet at this branch.</p>
        ) : (
          <ul className="divide-y divide-line">
            {cycles.map((c) => {
              const tone = CYCLE_TONE[c.status] || 'neutral'
              const del = c.statuses?.Delivered || { count: 0, total: 0 }
              const isCurrent = currentId != null && c.id === currentId
              return (
                <li
                  key={c.id}
                  className={[
                    'flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
                    isCurrent ? 'bg-brand-subtle/40' : '',
                  ].join(' ')}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{c.name}</span>
                      <Badge tone={tone} variant="subtle">
                        {c.status}
                      </Badge>
                      {isCurrent && (
                        <Badge tone="brand" variant="subtle">
                          current
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-chips text-muted">
                      {c.code}
                      {c.endsAt
                        ? ` · closes ${new Date(c.endsAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`
                        : ''}
                      {` · ${c.orders.toLocaleString()} orders`}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-6 sm:flex sm:items-center sm:gap-10">
                    <div>
                      <p className="text-chips uppercase tracking-wide text-muted">Delivered</p>
                      <p className="text-sm font-semibold text-fg">
                        {del.count.toLocaleString()}
                        <span className="font-normal text-muted"> · {naira(del.total)}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-chips uppercase tracking-wide text-muted">Season value</p>
                      <p className="text-sm font-semibold text-fg">{naira(c.total)}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card.Body>
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Quick-access tile
   ═══════════════════════════════════════════════════════════════════ */
function QuickLink({ q }) {
  return (
    <Link
      href={q.href}
      className="group flex items-center gap-3 rounded-xl border border-line bg-surface p-4 transition-[border-color,background-color] duration-200 ease-sakani hover:border-line-strong hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-fg transition-colors duration-200 ease-sakani group-hover:bg-brand-subtle group-hover:text-brand-fg">
        <q.icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{q.label}</span>
        <span className="block truncate text-chips text-muted">{q.desc}</span>
      </span>
      <ArrowRight
        className="ml-auto h-4 w-4 shrink-0 text-muted transition-transform duration-200 ease-sakani group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  )
}

function ModuleQuickAccess({ module }) {
  const links = QUICK_LINKS[module] || []
  const meta = MODULE_META[module]
  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand-fg">
            <meta.icon className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <Card.Title>{meta.label}</Card.Title>
            <Card.Description>{links.length} pages · jump straight in</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Body className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((q) => (
          <QuickLink key={q.href} q={q} />
        ))}
      </Card.Body>
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════════════════ */
export default function RepDashboard() {
  const { user } = useAuth()
  const portalModule = user?.module || null

  // Which modules this rep's session can reach — strict: the rep only sees the
  // module they signed in through (food reps get food only, never exhibition).
  // Pre-sign-in (portalModule null) every module is probed behind the prompt.
  const accessible = useMemo(() => {
    if (portalModule === 'ram') return ['ram']
    if (portalModule === 'exhibition') return ['exhibition']
    if (portalModule === 'food') return ['food']
    return ['food', 'ram', 'exhibition']
  }, [portalModule])

  const activeModule = portalModule === 'ram' ? 'ram' : portalModule === 'exhibition' ? 'exhibition' : 'food'
  const activeMeta = MODULE_META[activeModule]

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Latest-wins guard: the first mount fetches every accessible module while
  // auth resolves, then re-fetches only the signed-in module. Without the seq
  // check, the slower all-modules request could land last and clobber the
  // fresh module-scoped data with a stale partial-failure warning.
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError('')
    const jobs = []
    if (accessible.includes('food')) jobs.push(['food', fetch('/api/rep/orders/stats', { cache: 'no-store' })])
    if (accessible.includes('ram')) jobs.push(['ram', fetch('/api/rep/ram/stats', { cache: 'no-store' })])
    if (accessible.includes('exhibition')) jobs.push(['exhibition', fetch('/api/rep/exhibition/stats', { cache: 'no-store' })])

    const settled = await Promise.allSettled(jobs.map(([, p]) => p))
    const read = async (r) => {
      if (r.status !== 'fulfilled') return null
      try {
        const j = await r.value.json()
        return j?.ok ? j : null
      } catch {
        return null
      }
    }
    const rows = await Promise.all(settled.map(read))
    if (seq !== loadSeq.current) return // superseded by a newer load

    const next = {}
    let failed = 0
    jobs.forEach(([key], i) => {
      if (rows[i]) next[key] = rows[i]
      else failed += 1
    })
    if (failed === jobs.length) {
      setError("Couldn't reach the database. Showing zeros. Check the connection and try again.")
    } else if (failed > 0) {
      setError("Some data sources couldn't be reached. Figures below may be incomplete.")
    }
    setData(next)
    setLoading(false)
  }, [accessible])

  useEffect(() => {
    load()
  }, [load])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

  // "Good evening, Abuja Branch Rep" — the branch/vendor name plus the rep
  // role, so the greeting reads as the person, not the location alone.
  const baseName =
    portalModule === 'ram'
      ? user?.vendorName || user?.id || 'Rep'
      : user?.branchName || user?.id || 'Rep'
  const repName = /rep$/i.test(String(baseName)) ? baseName : `${baseName} Rep`

  const subtitle =
    portalModule === 'ram'
      ? `${user?.vendorName || 'Your locations'} · manage ram orders for your delivery locations`
      : portalModule === 'exhibition'
        ? `${user?.branchName || 'Your branch'} · approve exhibition orders from your branch's vendor market`
        : `${user?.branchName || 'Your branch'} · manage food orders and delivery for your branch`

  // ── Chart data for the active module ──────────────────────────────
  const chartData = useMemo(() => {
    if (activeModule === 'food') {
      const food = data?.food || {}
      return [
        { label: 'Pending', count: food.todayPending?.count ?? 0, value: food.todayPending?.total ?? 0 },
        { label: 'Posted', count: food.postedCycle?.count ?? 0, value: food.postedCycle?.total ?? 0 },
        { label: 'Delivered', count: food.deliveredCycle?.count ?? 0, value: food.deliveredCycle?.total ?? 0 },
      ]
    }
    const statuses = data?.[activeModule]?.statuses || {}
    return STATUS_ORDER.map((k) => ({
      label: k,
      count: statuses[k]?.count ?? 0,
      value: statuses[k]?.total ?? 0,
    })).filter((d) => d.count > 0)
  }, [activeModule, data])

  const chartTitle =
    activeModule === 'food'
      ? 'Orders by status'
      : 'Orders by status'
  const chartDesc =
    activeModule === 'food'
      ? 'Pending today · posted and delivered this cycle.'
      : 'The approval pipeline across your branch.'

  // Ram reps only care about the value they approve — their value card shows
  // Approved alone instead of the full status pipeline.
  const valueChartData = useMemo(() => {
    if (activeModule === 'ram') {
      const approved = data?.ram?.statuses?.Approved || { count: 0, total: 0 }
      return [{ label: 'Approved', value: approved.total || 0 }]
    }
    return chartData.map((d) => ({ label: d.label, value: d.value }))
  }, [activeModule, chartData, data])

  const valueChartTitle = activeModule === 'ram' ? 'Approved value' : 'Value by status'
  const valueChartDesc =
    activeModule === 'ram'
      ? 'Total value of the ram orders approved at your delivery locations.'
      : 'How much value is flowing through the pipeline.'

  // ── Unauthenticated → prompt to sign in ───────────────────────────
  if (!user || !user.authenticated) {
    return (
      <div className="relative flex min-h-[60vh] items-center justify-center p-6">
        <div className="ui-card w-full max-w-md p-6 text-center sm:p-8">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-on-accent">
            R
          </span>
          <h1 className="mt-4 text-h2 font-bold tracking-tight text-fg">Rep Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your passcode to see your branch&apos;s orders at a glance.</p>
          <Link
            href="/rep/access"
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover"
          >
            Go to rep sign in
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="relative p-4 sm:p-6 lg:p-8">
      {/* Ambient canvas glows (Sakani) */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-brand-fg">
              <Home className="h-3.5 w-3.5" strokeWidth={2.2} />
              Rep Dashboard
            </div>
            <h1 className="mt-1.5 font-display text-h1 font-semibold tracking-tight text-fg">
              {greeting}, {repName}
            </h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand" variant="subtle" icon={activeMeta.icon}>
              {activeMeta.label}
            </Badge>
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {!!error && (
          <div className="mb-6 rounded-xl border border-danger-border bg-danger-bg p-4 text-sm text-danger-fg">
            {error}
          </div>
        )}

        {/* Branch stats strip */}
        {activeModule === 'food' ? (
          <FoodStats loading={loading} data={data?.food} />
        ) : activeModule === 'ram' ? (
          <RamStats loading={loading} data={data?.ram} />
        ) : (
          <PipelineStats loading={loading} data={data?.[activeModule]} moduleName={activeMeta.moduleName} />
        )}

        {/* Charts row — lg breakpoint, same density as the admin dashboards */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <Card.Header>
              <Card.Title>{chartTitle}</Card.Title>
              <Card.Description>{chartDesc}</Card.Description>
            </Card.Header>
            <Card.Body>
              {loading ? (
                <ChartSkeleton />
              ) : chartData.length === 0 ? (
                <ChartEmpty empty="No orders to chart yet" />
              ) : (
                <BarChart
                  height={240}
                  data={chartData}
                  series={[{ key: 'count', label: 'Orders', color: 'var(--chart-1)' }]}
                  formatValue={(v) => `${v} orders`}
                />
              )}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>{valueChartTitle}</Card.Title>
              <Card.Description>{valueChartDesc}</Card.Description>
            </Card.Header>
            <Card.Body>
              {loading ? (
                <ChartSkeleton />
              ) : valueChartData.every((d) => !d.value) ? (
                <ChartEmpty empty="No order value yet" />
              ) : activeModule === 'ram' ? (
                <BarChart
                  height={240}
                  data={valueChartData}
                  series={[{ key: 'value', label: 'Approved value', color: 'var(--chart-2)' }]}
                  formatValue={naira}
                />
              ) : (
                <LineChart
                  height={240}
                  data={valueChartData}
                  color="var(--chart-2)"
                  formatValue={naira}
                />
              )}
            </Card.Body>
          </Card>
        </div>

        {/* Season comparison — exhibition only, per-cycle breakdown */}
        {activeModule === 'exhibition' && (
          <SeasonCompare loading={loading} data={data?.exhibition} />
        )}

        {/* Quick access — one card per accessible module */}
        <div className="mt-6 space-y-6">
          {accessible.map((key) => (
            <ModuleQuickAccess key={key} module={key} />
          ))}
        </div>
      </div>
    </div>
  )
}
