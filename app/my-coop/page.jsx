// app/my-coop/page.jsx
// Member "My Coop" dashboard — the logged-in home for members.
// Shows savings, loan balance + interest, cycle status, recent orders,
// and a spending chart using the Sakani Charts components.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useModuleState from '../hooks/useModuleState'
import {
  ArrowRight,
  Banknote,
  Beef,
  Calendar,
  ClipboardList,
  Clock,
  CreditCard,
  Home,
  MapPin,
  Package,
  PiggyBank,
  ShoppingBasket,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import ProtectedRoute from '../components/ProtectedRoute'
import ContinueShoppingBanner from '../components/ContinueShoppingBanner'
import { FoodOrderStepper } from '../components/ui/OrderStepper'
import { supabase } from '@/lib/supabaseClient'
import StatCard from '../components/ui/StatCard'
import { BarChart, LineChart, ChartEmpty } from '../components/ui/Charts'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import CycleCountdown from '../components/ui/CycleCountdown'
import ModuleClosedPanel from '../components/ModuleClosedPanel'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

const CATEGORY_LABELS = { A: 'Active', R: 'Retiree', P: 'Pensioner', E: 'Coop Staff' }
// Modules shown in the shop picker — keys match the admin dashboard's ?module= param
// so the member's selection and the admin switcher stay in sync via the URL.
const PICKER_MODULES = [{ key: 'food' }, { key: 'ram' }, { key: 'exhibition' }]
const STATUS_TONES = {
  Pending: 'warning',
  Posted: 'info',
  Delivered: 'success',
  Approved: 'success',
  Cancelled: 'danger',
}

function MyCoopContent() {
  const { user } = useAuth()
  const router = useRouter()
  // The ?module= URL param keeps the member picker and admin switcher in sync;
  // the cards no longer show a selection ring (uniform treatment), but the
  // shared param is still written before routing so navigation stays linked.
  const [, setModule] = useModuleState(PICKER_MODULES)
  const memberId = String(user?.id || '').trim().toUpperCase()

  const [profile, setProfile] = useState(null)
  const [elig, setElig] = useState(null)
  const [orders, setOrders] = useState([])
  const [foodCycle, setFoodCycle] = useState(null)
  const [ramCycle, setRamCycle] = useState(null)
  const [ramStats, setRamStats] = useState(null)
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [ramOpen, setRamOpen] = useState(true)
  const [exhibitionOpen, setExhibitionOpen] = useState(false)
  const [exhibitionCycle, setExhibitionCycle] = useState(null)
  // Which module's "closed" panel is open (null = none)
  const [closedModule, setClosedModule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ── Load everything the dashboard needs ──────────────────────────
  useEffect(() => {
    if (!memberId) return
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError('')

      // 1) Member profile snapshot
      try {
        const { data: m, error: mErr } = await supabase
          .from('members')
          .select(`
            member_id,
            full_name,
            savings,
            loans,
            global_limit,
            category,
            branches:branch_id(code, name),
            departments:department_id(name)
          `)
          .eq('member_id', memberId)
          .maybeSingle()
        if (!cancelled) {
          if (!mErr) {
            setProfile(m || null)
          } else if (/failed to fetch|network|fetch/i.test(mErr.message || '')) {
            // Network-level failure (e.g. Coop unreachable) — show a friendly hint.
            setError('Could not reach the Coop right now. Check your connection and refresh to retry.')
          } else if (!/no rows/i.test(mErr.message || '')) {
            setError(mErr.message || 'Failed to load profile')
          }
        }
      } catch {
        if (!cancelled) setError('Could not reach the Coop right now. Check your connection and refresh to retry.')
      }

      // 2) Eligibility (savings/loan exposure + credit)
      try {
        const eligRes = await fetch(`/api/members/eligibility?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const eligJson = await eligRes.json().catch(() => null)
        if (!cancelled) setElig(eligJson?.ok ? eligJson.eligibility : null)
      } catch {
        // optional — leave eligibility blank
      }

      // 3) Food orders (enriched with principal + interest)
      try {
        const ordRes = await fetch(`/api/orders/member?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const ordJson = await ordRes.json().catch(() => null)
        if (!cancelled) setOrders(ordJson?.ok ? (ordJson.orders || []) : [])
      } catch {
        // optional — leave orders blank
      }

      // 4) Active food cycle
      try {
        const { data: fc } = await supabase.from('cycles').select('id, code, name, ends_at').eq('is_active', true).maybeSingle()
        if (!cancelled) setFoodCycle(fc || null)
      } catch {
        // optional
      }

      // 5) Active ram cycle + ram order totals for this member
      try {
        const { data: rc } = await supabase.from('ram_cycles').select('id, code, name, ends_at').eq('is_active', true).maybeSingle()
        if (!cancelled) setRamCycle(rc || null)

        const { data: ramOrders } = await supabase
          .from('ram_orders')
          .select('id, status, total_amount, ram_cycle_id')
          .eq('member_id', memberId)
          .neq('status', 'Cancelled')
        if (!cancelled) {
          const rows = Array.isArray(ramOrders) ? ramOrders : []
          const cycleRows = rc ? rows.filter((r) => Number(r.ram_cycle_id) === Number(rc.id)) : []
          setRamStats({
            count: rows.length,
            total: rows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
            cycleCount: cycleRows.length,
            cycleTotal: cycleRows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
          })
        }
      } catch {
        // optional
      }

      // 6) Shopping availability for quick actions (food, ram, exhibition)
      const [f, r, e] = await Promise.allSettled([
        fetch('/api/system/shopping', { cache: 'no-store' }),
        fetch('/api/system/ram-shopping', { cache: 'no-store' }),
        fetch(`/api/exhibition/catalog?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' }),
      ])
      if (f.status === 'fulfilled') {
        const j = await f.value.json().catch(() => null)
        if (!cancelled && j) setShoppingOpen(!!j.open)
      }
      if (r.status === 'fulfilled') {
        const j = await r.value.json().catch(() => null)
        if (!cancelled && j) setRamOpen(!!j.open)
      }
      if (e.status === 'fulfilled') {
        const j = await e.value.json().catch(() => null)
        if (!cancelled && j?.ok) {
          setExhibitionOpen(!!j.open)
          setExhibitionCycle(j.cycle || null)
        }
      }

      if (!cancelled) setLoading(false)
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  // ── Derived data ─────────────────────────────────────────────────
  const firstName = profile?.full_name ? String(profile.full_name).trim().split(/\s+/)[0] : memberId

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

  // Spending trend — last 6 months of order totals
  const spendSeries = useMemo(() => {
    const months = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'short' }) })
    }
    const sums = new Map(months.map((m) => [m.key, 0]))
    for (const o of orders) {
      if (o.status === 'Cancelled') continue
      const d = new Date(o.created_at)
      const k = `${d.getFullYear()}-${d.getMonth()}`
      if (sums.has(k)) sums.set(k, sums.get(k) + Number(o.total_amount || 0))
    }
    return months.map((m) => ({ label: m.label, value: sums.get(m.key) }))
  }, [orders])

  // Payment mix across all orders
  const paymentMix = useMemo(() => {
    const by = { Savings: 0, Loan: 0, Cash: 0 }
    for (const o of orders) {
      if (o.status === 'Cancelled') continue
      const k = o.payment_option
      if (k in by) by[k] += Number(o.total_amount || 0)
    }
    return [
      { label: 'Savings', Amount: by.Savings },
      { label: 'Loan', Amount: by.Loan },
      { label: 'Cash', Amount: by.Cash },
    ]
  }, [orders])

  // Orders in the current food cycle
  const cycleOrders = useMemo(
    () => (foodCycle ? orders.filter((o) => Number(o.cycle_id) === Number(foodCycle.id)) : []),
    [orders, foodCycle]
  )
  const cycleTotal = cycleOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0)

  const outstanding = elig ? Number(elig.outstandingLoansTotal || 0) : null
  const recentOrders = orders.filter((o) => o.status !== 'Cancelled').slice(0, 4)

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

  // ── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="min-h-screen bg-canvas">
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
            <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-6xl p-3 pb-16 sm:p-4 md:p-6">
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="mt-3 h-9 w-64 rounded-xl" />
            <Skeleton className="mt-2 h-4 w-40 rounded-md" />
            <Skeleton className="mt-6 h-5 w-16 rounded-md" />
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-40 rounded-2xl" />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <Skeleton className="h-64 rounded-2xl xl:col-span-2" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        {/* Ambient canvas glows (Sakani) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl p-3 pb-16 sm:p-4 md:p-6">
          {/* Hero */}
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-brand-fg">
                <Home className="h-3.5 w-3.5" strokeWidth={2.2} />
                My Coop
              </div>
              <h1 className="mt-1.5 font-display text-h1 font-semibold tracking-tight text-fg">
                {greeting}, {firstName || 'Member'}
              </h1>
              <p className="mt-1 text-sm text-muted">
                Your savings, loans and orders at a glance
              </p>
            </div>

            {/* Member chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="brand" variant="subtle" icon={CreditCard}>
                ID {memberId}
              </Badge>
              {profile?.category && (
                <Badge tone="accent" variant="subtle" icon={Sparkles}>
                  {CATEGORY_LABELS[profile.category] || profile.category}
                </Badge>
              )}
              {profile?.branches?.name && (
                <Badge tone="neutral" variant="subtle" icon={MapPin}>
                  {profile.branches.name}
                </Badge>
              )}
              {profile?.departments?.name && (
                <Badge tone="neutral" variant="subtle">
                  {profile.departments.name}
                </Badge>
              )}
            </div>
          </div>

          <ContinueShoppingBanner className="mb-4" />

          {!!error && (
            <div className="mb-4 rounded-lg border border-danger-border bg-danger-bg/60 p-3 text-xs font-medium text-danger-fg">
              {error}
            </div>
          )}

          {/* Shop modules — the hub for entering each module */}
          <div className="mb-6">
            <div className="mb-3">
              <h2 className="font-display text-h2 font-semibold tracking-tight text-fg">Shop</h2>
              <p className="mt-0.5 text-chips text-muted">Pick a module. Its open/closed status shows here</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Food Distribution module card */}
              <button
                type="button"
                onClick={() => {
                  // Sync the shared ?module= param first, then head to the module —
                  // or open the shared closed panel when the module is closed.
                  setModule('food')
                  if (shoppingOpen) router.push('/shop')
                  else setClosedModule('food')
                }}
                aria-label={shoppingOpen ? 'Open Food Distribution shop' : 'Food Distribution is closed. Tap to see options'}
                className={[
                  'group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ease-sakani',
                  'hover:-translate-y-0.5 hover:shadow-md',
                  shoppingOpen
                    ? 'border-line bg-surface hover:border-brand/40'
                    : 'border-line-subtle bg-surface/60',
                ].filter(Boolean).join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                    <ShoppingBasket className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <Badge tone={shoppingOpen ? 'success' : 'warning'} variant="subtle" icon={shoppingOpen ? null : Clock}>
                    <span className="inline-flex items-center gap-1">
                      <span className={['h-1.5 w-1.5 rounded-full', shoppingOpen ? 'bg-success-fg' : 'bg-warning'].join(' ')} />
                      {shoppingOpen ? 'Opened' : 'Closed'}
                    </span>
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-semibold text-fg">Food Distribution</p>
                <p className="mt-0.5 text-chips text-muted">
                  {shoppingOpen
                    ? (foodCycle?.name ? `${foodCycle.name}. Shop this cycle` : 'Seasonal food cycles at branch prices')
                    : 'Shop is closed. Check back when the next cycle opens'}
                </p>
                {shoppingOpen && foodCycle?.ends_at && <CycleCountdown endsAt={foodCycle.ends_at} noun="Cycle" />}
                <span
                  className={[
                    'mt-3 flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200',
                    shoppingOpen
                      ? 'bg-brand text-on-accent group-hover:bg-brand-hover'
                      : 'bg-subtle text-muted',
                  ].join(' ')}
                >
                  {shoppingOpen ? 'Shop Food' : 'See options'}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              </button>

              {/* Ram Sales module card */}
              <button
                type="button"
                onClick={() => {
                  // Sync the shared ?module= param first, then head to the module —
                  // or open the shared closed panel when the module is closed.
                  setModule('ram')
                  if (ramOpen) router.push('/ram/shop')
                  else setClosedModule('ram')
                }}
                aria-label={ramOpen ? 'Open Ram Sales shop' : 'Ram Sales is closed. Tap to see options'}
                className={[
                  'group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ease-sakani',
                  'hover:-translate-y-0.5 hover:shadow-md',
                  ramOpen
                    ? 'border-line bg-surface hover:border-brand/40'
                    : 'border-line-subtle bg-surface/60',
                ].filter(Boolean).join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                    <Beef className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <Badge tone={ramOpen ? 'success' : 'warning'} variant="subtle">
                    <span className="inline-flex items-center gap-1">
                      <span className={['h-1.5 w-1.5 rounded-full', ramOpen ? 'bg-success-fg' : 'bg-warning'].join(' ')} />
                      {ramOpen ? 'Opened' : 'Closed'}
                    </span>
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-semibold text-fg">Ram Sales</p>
                <p className="mt-0.5 text-chips text-muted">
                  {ramOpen
                    ? (ramCycle?.name ? `${ramCycle.name}. Purchase this season` : 'The Ram sales portal for this season')
                    : 'Season is closed. Check back when Ram opens'}
                </p>
                {ramOpen && ramCycle?.ends_at && <CycleCountdown endsAt={ramCycle.ends_at} />}
                <span
                  className={[
                    'mt-3 flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200',
                    ramOpen
                      ? 'bg-brand text-on-accent group-hover:bg-brand-hover'
                      : 'bg-subtle text-muted',
                  ].join(' ')}
                >
                  {ramOpen ? 'Shop Ram' : 'See options'}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              </button>

              {/* Coop Exhibition module card */}
              <button
                type="button"
                onClick={() => {
                  setModule('exhibition')
                  if (exhibitionOpen) router.push('/exhibition')
                  else setClosedModule('exhibition')
                }}
                aria-label={exhibitionOpen ? 'Open Coop Exhibition shop' : 'Coop Exhibition is closed. Tap to see options'}
                className={[
                  'group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ease-sakani',
                  'hover:-translate-y-0.5 hover:shadow-md',
                  exhibitionOpen
                    ? 'border-line bg-surface hover:border-brand/40'
                    : 'border-line-subtle bg-surface/60',
                ].filter(Boolean).join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                    <Store className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <Badge tone={exhibitionOpen ? 'success' : 'warning'} variant="subtle">
                    <span className="inline-flex items-center gap-1">
                      <span className={['h-1.5 w-1.5 rounded-full', exhibitionOpen ? 'bg-success-fg' : 'bg-warning'].join(' ')} />
                      {exhibitionOpen ? 'Opened' : 'Closed'}
                    </span>
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-semibold text-fg">Coop Exhibition</p>
                <p className="mt-0.5 text-chips text-muted">
                  {exhibitionOpen
                    ? (exhibitionCycle?.name ? `${exhibitionCycle.name}. Shop vendor stands` : 'Seasonal market with vendor stands')
                    : 'Market is closed. Check back when the exhibition opens'}
                </p>
                {exhibitionOpen && exhibitionCycle?.ends_at && <CycleCountdown endsAt={exhibitionCycle.ends_at} />}
                <span
                  className={[
                    'mt-3 flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200',
                    exhibitionOpen
                      ? 'bg-brand text-on-accent group-hover:bg-brand-hover'
                      : 'bg-subtle text-muted',
                  ].join(' ')}
                >
                  {exhibitionOpen ? 'Shop Exhibition' : 'See options'}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              </button>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              featured
              icon={PiggyBank}
              title="Savings"
              value={profile ? naira(profile.savings) : '—'}
              delta={elig ? (Number(elig.savingsEligible || 0) > 0 ? `${naira(elig.savingsEligible)} spendable` : 'fully secured') : 'unavailable'}
              trend={elig && Number(elig.savingsEligible || 0) > 0 ? 'up' : 'flat'}
            />
            <StatCard
              icon={Wallet}
              title="Loan balance"
              value={profile ? naira(profile.loans) : '—'}
              delta={elig ? `${elig.interest_rate_pct}% interest` : 'unavailable'}
              trend="flat"
            />
            <StatCard
              icon={Banknote}
              title="Outstanding"
              value={outstanding !== null ? naira(outstanding) : '—'}
              delta={elig ? 'loans + exposure' : 'unavailable'}
              trend={outstanding > 0 ? 'up' : 'flat'}
            />
            <StatCard
              icon={TrendingUp}
              title="Available credit"
              value={elig ? naira(Number(elig.loanEligible || 0) + Number(elig.savingsEligible || 0)) : '—'}
              delta={elig ? 'loan + savings credit' : 'unavailable'}
              trend={elig && Number(elig.loanEligible || 0) + Number(elig.savingsEligible || 0) > 0 ? 'up' : 'flat'}
            />
          </div>

          {/* Charts row */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="ui-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-h2 font-semibold tracking-tight text-fg">Your spending</h2>
                  <p className="mt-0.5 text-chips text-muted">Food orders · last 6 months</p>
                </div>
                <span className="hidden rounded-full bg-subtle px-2.5 py-1 text-chips font-medium text-muted sm:inline-flex">
                  ₦{spendSeries.reduce((s, p) => s + p.value, 0).toLocaleString()} total
                </span>
              </div>
              <div className="mt-4">
                <LineChart
                  height={230}
                  data={spendSeries.some((p) => p.value > 0) ? spendSeries : []}
                  formatValue={naira}
                  empty="No food orders yet. Start shopping to see your spending trend"
                />
              </div>
            </div>

            <div className="ui-card p-4">
              <div>
                <h2 className="font-display text-h2 font-semibold tracking-tight text-fg">Payment mix</h2>
                <p className="mt-0.5 text-chips text-muted">How you've paid across orders</p>
              </div>
              <div className="mt-4">
                <BarChart
                  height={200}
                  data={paymentMix}
                  series={[{ key: 'Amount', label: 'Spend' }]}
                  formatValue={naira}
                  empty="No payment data yet"
                />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-subtle/60 px-3 py-2">
                <span className="text-chips font-medium text-muted">Total spend</span>
                <span className="text-sm font-bold tabular-nums text-fg">
                  {naira(paymentMix.reduce((s, p) => s + p.Amount, 0))}
                </span>
              </div>
            </div>
          </div>

          {/* Cycle status + recent orders */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Cycle status */}
            <div className="ui-card flex flex-col p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                  <Calendar className="h-4 w-4" strokeWidth={2} />
                </span>
                <div>
                  <h2 className="font-display text-h2 font-semibold tracking-tight text-fg">Cycle status</h2>
                  <p className="text-chips text-muted">Food + Ram seasons</p>
                </div>
              </div>

              <div className="mt-4 flex-1 space-y-3">
                <div className="rounded-xl border border-line-subtle bg-subtle/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-chips font-medium text-muted">
                      <ShoppingBasket className="h-3.5 w-3.5" strokeWidth={2.2} />
                      Food cycle
                    </span>
                    <span className={[
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-chips font-semibold',
                      foodCycle ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg',
                    ].join(' ')}>
                      <span className={['h-1.5 w-1.5 rounded-full', foodCycle ? 'bg-success-fg' : 'bg-warning'].join(' ')} />
                      {foodCycle ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-fg">{foodCycle?.name || 'No active cycle'}</p>
                  <p className="mt-0.5 text-chips text-muted">
                    {foodCycle
                      ? `${cycleOrders.length} order${cycleOrders.length === 1 ? '' : 's'} · ${naira(cycleTotal)} this cycle`
                      : 'Waiting for the next food cycle to open'}
                  </p>
                </div>

                <div className="rounded-xl border border-line-subtle bg-subtle/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-chips font-medium text-muted">
                      <Beef className="h-3.5 w-3.5" strokeWidth={2.2} />
                      Ram cycle
                    </span>
                    <span className={[
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-chips font-semibold',
                      ramCycle ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg',
                    ].join(' ')}>
                      <span className={['h-1.5 w-1.5 rounded-full', ramCycle ? 'bg-success-fg' : 'bg-warning'].join(' ')} />
                      {ramCycle ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-fg">{ramCycle?.name || 'No active cycle'}</p>
                  <p className="mt-0.5 text-chips text-muted">
                    {ramCycle
                      ? `${ramStats?.cycleCount || 0} order${(ramStats?.cycleCount || 0) === 1 ? '' : 's'} · ${naira(ramStats?.cycleTotal || 0)} this cycle`
                      : 'Waiting for the next Ram season to open'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recent orders */}
            <div className="ui-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-h2 font-semibold tracking-tight text-fg">Recent orders</h2>
                  <p className="mt-0.5 text-chips text-muted">Latest food activity</p>
                </div>
                <Button variant="ghost" size="sm" rightIcon={ArrowRight} onClick={() => router.push('/orders')}>
                  View all
                </Button>
              </div>

              {recentOrders.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="No orders yet"
                  description="Orders you place in the shop will show up here with their status."
                >
                  {shoppingOpen && (
                    <Button leftIcon={ShoppingCart} onClick={() => router.push('/shop')}>
                      Start Shopping
                    </Button>
                  )}
                </EmptyState>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {recentOrders.map((order) => (
                    <button
                      key={order.order_id}
                      type="button"
                      onClick={() => router.push(`/shop/success/${order.order_id}`)}
                      className="group rounded-xl border border-line-subtle bg-subtle/40 p-3 text-left transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-fg">Order #{order.order_id}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-chips text-muted">
                            <Calendar className="h-3 w-3" strokeWidth={2} />
                            {formatDate(order.created_at)}
                          </div>
                        </div>
                        <Badge tone={STATUS_TONES[order.status] || 'neutral'} variant="subtle">
                          {order.status}
                        </Badge>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-1 text-chips font-medium text-muted">
                          <CreditCard className="h-3 w-3" strokeWidth={2} />
                          {order.payment_option}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-fg">
                          {naira(order.total_amount)}
                        </span>
                      </div>

                      {/* Pending → Posted → Delivered progress */}
                      <div className="mt-2.5 border-t border-line-subtle pt-2.5">
                        <FoodOrderStepper status={order.status} />
                      </div>

                      {(order.payment_option === 'Loan' && Number(order.loan_interest_amount || 0) > 0) && (
                        <p className="mt-1.5 text-chips text-muted">
                          incl. {naira(order.loan_interest_amount)} interest
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Shared closed-module panel — opens when a closed module card is tapped */}
      <ModuleClosedPanel
        module={closedModule || 'food'}
        variant="modal"
        open={!!closedModule}
        onClose={() => setClosedModule(null)}
        onViewOrders={() => {
          const dest = closedModule === 'ram' ? '/orders?tab=ram' : closedModule === 'exhibition' ? '/exhibition/orders' : '/orders'
          setClosedModule(null)
          router.push(dest)
        }}
        onBack={() => setClosedModule(null)}
      />
    </ProtectedRoute>
  )
}

export default function MyCoopPage() {
  return <MyCoopContent />
}
