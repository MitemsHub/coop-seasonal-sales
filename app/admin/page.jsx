'use client'

// app/admin/page.jsx
// Admin dashboard landing — paginated by module. Each module (Food, Ram, …)
// gets its own dashboard view behind a segmented switcher; new modules are
// added to MODULES below and the URL (?module=) makes each view shareable.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import useModuleState from '../hooks/useModuleState'
import {
  Banknote,
  Beef,
  ClipboardList,
  Clock,
  Coins,
  Package,
  Percent,
  PiggyBank,
  RefreshCw,
  Send,
  ShoppingBasket,
  Store,
  Truck,
  Wallet,
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table'
import Skeleton from '../components/ui/Skeleton'
import { BarChart, LineChart, ChartEmpty } from '../components/ui/Charts'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

const STATUS_TONE = {
  Pending: 'warning',
  Posted: 'info',
  Delivered: 'success',
  Cancelled: 'danger',
  Approved: 'success',
}

const STATUS_LABEL = {
  Pending: 'Pending',
  Posted: 'Posted',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
  Approved: 'Approved',
}

// ── Dashboard modules — append new modules here as they launch ──────
const MODULES = [
  { key: 'food', label: 'Food Dashboard', icon: ShoppingBasket },
  { key: 'ram', label: 'Ram Dashboard', icon: Beef },
  { key: 'exhibition', label: 'Exhibition Dashboard', icon: Store },
]

const FOOD_STATUS_SERIES = [
  { key: 'Pending', label: 'Pending', color: 'var(--warning-solid)' },
  { key: 'Posted', label: 'Posted', color: 'var(--info-solid)' },
  { key: 'Delivered', label: 'Delivered', color: 'var(--success-solid)' },
]

const EXHIBITION_STATUS_SERIES = [
  { key: 'Pending', label: 'Pending', color: 'var(--warning-solid)' },
  { key: 'Approved', label: 'Approved', color: 'var(--info-solid)' },
  { key: 'Delivered', label: 'Delivered', color: 'var(--success-solid)' },
]

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Module switcher — segmented pills, URL-driven
   ═══════════════════════════════════════════════════════════════════ */
function ModuleSwitcher({ module, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard module"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-xs"
    >
      {MODULES.map((m) => {
        const isActive = module === m.key
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(m.key)}
            className={[
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-chips font-medium sm:px-3.5 sm:text-sm',
              'transition-all duration-200 ease-sakani focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              isActive
                ? 'bg-brand text-on-accent shadow-xs'
                : 'text-muted hover:bg-subtle hover:text-fg',
            ].join(' ')}
          >
            <m.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2} />
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Food dashboard
   ═══════════════════════════════════════════════════════════════════ */
function FoodDashboard({ loading, data }) {
  const totals = data?.summary?.totals || {}
  const amounts = data?.summary?.amounts || {}
  const byBranch = data?.summary?.byBranch || []
  // The pending list backs the preview table — only the latest 8 render.
  const recentOrders = (data?.orders?.orders || []).slice(0, 8)

  const branchChartData = byBranch.map((b) => ({
    label: b.branch_name || '—',
    Pending: Number(b.pending || 0),
    Posted: Number(b.posted || 0),
    Delivered: Number(b.delivered || 0),
  }))

  // Top / bottom branch performance — ranked by naira order value this cycle
  // (falls back to order volume only where per-branch amounts aren't available).
  const branchVolumes = byBranch
    .map((b) => {
      const rawValue = Number(b.value)
      return {
        label: b.branch_name || '—',
        value: Number.isFinite(rawValue)
          ? rawValue
          : Number(b.pending || 0) + Number(b.posted || 0) + Number(b.delivered || 0),
      }
    })
    .sort((a, b) => b.value - a.value)
  const topBranches = branchVolumes.slice(0, 10)
  const bottomBranches = [...branchVolumes].reverse().slice(0, 10)

  const lifecycleData = [
    { label: 'Pending', value: Number(totals.totalPending || 0) },
    { label: 'Posted', value: Number(totals.totalPosted || 0) },
    { label: 'Delivered', value: Number(totals.totalDelivered || 0) },
  ]

  return (
    <>
      {/* KPI + payment cards — one 3-up grid, from total orders down to cash */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard loading={loading} icon={ClipboardList} title="Total orders" value={loading ? '' : (totals.totalAll ?? 0).toLocaleString()} delta="this cycle" trend="flat" />
        <StatCard loading={loading} icon={Clock} title="Pending" value={loading ? '' : (totals.totalPending ?? 0).toLocaleString()} delta="awaiting approval" trend="flat" />
        <StatCard loading={loading} icon={Send} title="Posted" value={loading ? '' : Math.max(0, (totals.totalPosted ?? 0) - (totals.totalDelivered ?? 0)).toLocaleString()} delta="awaiting delivery" trend="flat" />
        <StatCard loading={loading} icon={Truck} title="Delivered" value={loading ? '' : (totals.totalDelivered ?? 0).toLocaleString()} delta="completed" trend="flat" />
        <StatCard loading={loading} featured icon={Banknote} title="Total order value" value={loading ? '' : naira(amounts.totalAll)} delta="loan + savings + cash" trend="flat" />
        <StatCard loading={loading} icon={Wallet} title="Loan value" value={loading ? '' : naira(amounts.loansPrincipal)} delta="excl. interest" trend="flat" />
        <StatCard loading={loading} icon={Percent} title="Loan interest" value={loading ? '' : naira(amounts.loansInterest)} delta="interest portion" trend="flat" />
        <StatCard loading={loading} icon={PiggyBank} title="Savings" value={loading ? '' : naira(amounts.savings)} delta="recorded line amounts" trend="flat" />
        <StatCard loading={loading} icon={Coins} title="Cash" value={loading ? '' : naira(amounts.cash)} delta="recorded line amounts" trend="flat" />
      </div>

      {/* Charts row */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Card.Header>
            <Card.Title>Orders by branch</Card.Title>
            <Card.Description>This cycle, across delivery branches, stacked by status.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : byBranch.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={branchChartData}
                series={FOOD_STATUS_SERIES}
                formatValue={(v) => `${v} orders`}
              />
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Order lifecycle</Card.Title>
            <Card.Description>How this cycle&apos;s orders move through the pipeline.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <LineChart
                height={240}
                data={lifecycleData}
                color="var(--chart-1)"
                formatValue={(v) => `${v} orders`}
              />
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Top / bottom branch performance */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>Top 10 branches</Card.Title>
            <Card.Description>Highest order value this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : topBranches.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={topBranches}
                series={[{ key: 'value', label: 'Order value', color: 'var(--chart-2)' }]}
                formatValue={(v) => naira(v)}
              />
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Bottom 10 branches</Card.Title>
            <Card.Description>Lowest order value this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : bottomBranches.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={bottomBranches}
                series={[{ key: 'value', label: 'Order value', color: 'var(--chart-4)' }]}
                formatValue={(v) => naira(v)}
              />
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Recent pending orders */}
      <Card className="mt-6">
        <Card.Header className="flex-row items-center justify-between">
          <div>
            <Card.Title>Recent pending orders</Card.Title>
            <Card.Description>Latest orders waiting for approval.</Card.Description>
          </div>
          <Link
            href="/admin/food/pending"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand transition-colors duration-200 ease-sakani hover:bg-brand-subtle"
          >
            View all
          </Link>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-muted">
              No pending orders right now.
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="border-0">
                  <TH>Order</TH>
                  <TH>Member</TH>
                  <TH>Branch</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {recentOrders.map((o) => (
                  <TR key={o.order_id}>
                    <TD className="font-medium">#{o.order_id}</TD>
                    <TD>
                      <div className="max-w-[180px] truncate font-medium">{o.member_name_snapshot || o.member_id}</div>
                      <div className="text-xs text-muted">{o.payment_option || ''}</div>
                    </TD>
                    <TD className="text-muted">{o.delivery?.name || o.member_branch?.name || '—'}</TD>
                    <TD className="text-right font-medium">{naira(o.total_amount)}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[o.status] || 'neutral'} variant="subtle">
                        {STATUS_LABEL[o.status] || o.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Ram dashboard
   ═══════════════════════════════════════════════════════════════════ */
function RamDashboard({ loading, data }) {
  const ramTotals = data?.ram?.totals || {}
  // Ram value splits like the food cards: principal (amount minus interest) and
  // its own interest card, so the loan breakdown is visible on this dashboard too.
  const ramPrincipal = Math.max(0, Number(ramTotals.amount || 0) - Number(ramTotals.loan_interest || 0))
  const byStatus = data?.ram?.byStatus || []
  const byPayment = data?.ram?.byPayment || []
  const byLocation = data?.ram?.byLocation || []
  // Payment-split cards like the food dashboard — savings and cash come from the
  // per-payment aggregates the summary already computes.
  const ramSavings = Number((byPayment.find((p) => String(p.key) === 'Savings') || {}).amount || 0)
  const ramCash = Number((byPayment.find((p) => String(p.key) === 'Cash') || {}).amount || 0)
  // Top / bottom delivery locations — ranked by naira order value this cycle so
  // "best performing" reflects actual sales, mirroring the food branch charts.
  const locVolumes = byLocation
    .map((l) => ({ label: l.key || '—', value: Number(l.amount || 0) }))
    .sort((a, b) => b.value - a.value)
  const topLocations = locVolumes.slice(0, 10)
  const bottomLocations = [...locVolumes].reverse().slice(0, 10)

  // Keep a stable pipeline order for the lifecycle line.
  const STATUS_ORDER = ['Pending', 'Approved', 'Delivered', 'Cancelled']
  const statusRows = [...byStatus].sort((a, b) => {
    const ia = STATUS_ORDER.indexOf(a.key)
    const ib = STATUS_ORDER.indexOf(b.key)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const statusChartData = statusRows.map((s) => ({ label: s.key || '—', orders: Number(s.orders || 0) }))
  const valueLifecycleData = statusRows.map((s) => ({ label: s.key || '—', value: Number(s.amount || 0) }))

  return (
    <>
      {/* KPI cards — one 3-up grid, matching the food dashboard */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard loading={loading} icon={ClipboardList} title="Ram orders" value={loading ? '' : (ramTotals.orders ?? 0).toLocaleString()} delta="this cycle" trend="flat" />
        <StatCard loading={loading} featured icon={Banknote} title="Total value" value={loading ? '' : naira(ramTotals.amount)} delta="this cycle" trend="flat" />
        <StatCard loading={loading} icon={Wallet} title="Loan value" value={loading ? '' : naira(ramPrincipal)} delta="excl. interest" trend="flat" />
        <StatCard loading={loading} icon={Percent} title="Ram interest" value={loading ? '' : naira(ramTotals.loan_interest)} delta="interest portion" trend="flat" />
        <StatCard loading={loading} icon={PiggyBank} title="Savings" value={loading ? '' : naira(ramSavings)} delta="recorded amounts" trend="flat" />
        <StatCard loading={loading} icon={Coins} title="Cash" value={loading ? '' : naira(ramCash)} delta="recorded amounts" trend="flat" />
        <StatCard loading={loading} icon={Truck} title="Total quantity" value={loading ? '' : (ramTotals.qty ?? 0).toLocaleString()} delta="units ordered" trend="flat" />
      </div>

      {/* Charts row — mirrors the food dashboard: pipeline chart wide + value line */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Card.Header>
            <Card.Title>Orders by status</Card.Title>
            <Card.Description>Approval pipeline volume this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : byStatus.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={statusChartData}
                series={[{ key: 'orders', label: 'Orders', color: 'var(--chart-1)' }]}
                formatValue={(v) => `${v} orders`}
              />
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Ram value by status</Card.Title>
            <Card.Description>Total value flowing through the pipeline.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : byStatus.length === 0 ? (
              <ChartEmpty />
            ) : (
              <LineChart
                height={240}
                data={valueLifecycleData}
                color="var(--chart-2)"
                formatValue={naira}
              />
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Top / bottom delivery locations — by naira value, like the food charts */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>Top 10 delivery locations</Card.Title>
            <Card.Description>Highest order value this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : topLocations.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={topLocations}
                series={[{ key: 'value', label: 'Order value', color: 'var(--chart-3)' }]}
                formatValue={naira}
              />
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Bottom 10 delivery locations</Card.Title>
            <Card.Description>Lowest order value this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : bottomLocations.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={bottomLocations}
                series={[{ key: 'value', label: 'Order value', color: 'var(--chart-4)' }]}
                formatValue={naira}
              />
            )}
          </Card.Body>
        </Card>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Exhibition dashboard
   ═══════════════════════════════════════════════════════════════════ */
function ExhibitionDashboard({ loading, data }) {
  const summary = data?.exhibition?.summary || {}
  const byStatus = summary.byStatus || {}
  const recentOrders = summary.recent_orders || []
  const amounts = summary.amounts || {}
  // Top / bottom vendors — ranked by naira order value this cycle, mirroring
  // the food dashboard's branch performance charts.
  const vendorsByValue = summary.vendors_by_value || []
  const topVendors = vendorsByValue.slice(0, 10)
  const bottomVendors = [...vendorsByValue].reverse().slice(0, 10)

  const statusChartData = ['Pending', 'Approved', 'Delivered', 'Cancelled']
    .filter((k) => Number(byStatus[k] || 0) > 0)
    .map((k) => ({ label: k, orders: Number(byStatus[k] || 0) }))

  return (
    <>
      {/* KPI cards — row 1: cycles, vendors, orders (unchanged) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard loading={loading} icon={Store} title="Active cycles" value={loading ? '' : (summary.active_cycles ?? 0).toLocaleString()} delta={`${summary.branches ?? 0} branch${summary.branches === 1 ? '' : 'es'}`} trend="flat" />
        <StatCard loading={loading} icon={Package} title="Vendors" value={loading ? '' : (summary.vendors ?? 0).toLocaleString()} delta={`${summary.products ?? 0} products`} trend="flat" />
        <StatCard loading={loading} icon={ClipboardList} title="Orders" value={loading ? '' : (summary.orders ?? 0).toLocaleString()} delta={`${summary.active_orders ?? 0} this cycle`} trend="flat" />
        <StatCard loading={loading} featured icon={Banknote} title="Total value" value={loading ? '' : naira(amounts.total)} delta="non-cancelled, this cycle" trend="flat" />
        <StatCard loading={loading} icon={Wallet} title="Loan" value={loading ? '' : naira(amounts.loans)} delta="loan orders" trend="flat" />
        <StatCard loading={loading} icon={PiggyBank} title="Savings" value={loading ? '' : naira(amounts.savings)} delta="savings orders" trend="flat" />
        <StatCard loading={loading} icon={Coins} title="Cash" value={loading ? '' : naira(amounts.cash)} delta="cash orders" trend="flat" />
        <StatCard loading={loading} icon={Clock} title="Pending" value={loading ? '' : (byStatus.Pending ?? 0).toLocaleString()} delta="awaiting approval" trend="flat" />
        <StatCard loading={loading} icon={Send} title="Approved" value={loading ? '' : (byStatus.Approved ?? 0).toLocaleString()} delta="ready for delivery" trend="flat" />
        <StatCard loading={loading} icon={Truck} title="Delivered" value={loading ? '' : (byStatus.Delivered ?? 0).toLocaleString()} delta="delivered" trend="flat" />
      </div>

      {/* Charts row — status chart wide + cycle health, one row */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Card.Header>
            <Card.Title>Orders by status</Card.Title>
            <Card.Description>The exhibition pipeline for the active cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : statusChartData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={statusChartData}
                series={EXHIBITION_STATUS_SERIES.filter((s) => statusChartData.some((d) => d.label === s.key))}
                formatValue={(v) => `${v} orders`}
              />
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Cycle health</Card.Title>
            <Card.Description>Setup across the branch network.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2.5">
                  <span className="text-sm text-muted">Cycles created</span>
                  <span className="text-sm font-semibold text-fg">{summary.cycles ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2.5">
                  <span className="text-sm text-muted">Active now</span>
                  <span className="text-sm font-semibold text-fg">{summary.active_cycles ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2.5">
                  <span className="text-sm text-muted">Active products</span>
                  <span className="text-sm font-semibold text-fg">{summary.active_products ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2.5">
                  <span className="text-sm text-muted">Pending orders</span>
                  <span className="text-sm font-semibold text-fg">{byStatus.Pending ?? 0}</span>
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Top / bottom vendors — by naira value, like the food charts */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>Top 10 vendors</Card.Title>
            <Card.Description>Highest order value this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : topVendors.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={topVendors}
                series={[{ key: 'value', label: 'Order value', color: 'var(--chart-2)' }]}
                formatValue={naira}
              />
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Bottom 10 vendors</Card.Title>
            <Card.Description>Lowest order value this cycle.</Card.Description>
          </Card.Header>
          <Card.Body>
            {loading ? (
              <ChartSkeleton />
            ) : bottomVendors.length === 0 ? (
              <ChartEmpty />
            ) : (
              <BarChart
                height={240}
                data={bottomVendors}
                series={[{ key: 'value', label: 'Order value', color: 'var(--chart-4)' }]}
                formatValue={naira}
              />
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Recent orders */}
      <Card className="mt-6">
        <Card.Header className="flex-row items-center justify-between">
          <div>
            <Card.Title>Recent orders</Card.Title>
            <Card.Description>Latest exhibition orders across branches.</Card.Description>
          </div>
          <Link
            href="/admin/exhibition/pending"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand transition-colors duration-200 ease-sakani hover:bg-brand-subtle"
          >
            View all
          </Link>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-muted">
              No exhibition orders yet.
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="border-0">
                  <TH>Order</TH>
                  <TH>Member</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {recentOrders.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-medium">{o.order_id || `#${o.id}`}</TD>
                    <TD>
                      <div className="max-w-[180px] truncate font-medium">{o.member_name_snapshot || o.member_id}</div>
                      <div className="text-xs text-muted">{o.payment_option || ''}</div>
                    </TD>
                    <TD className="text-right font-medium">{naira(o.total_amount)}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[o.status] || 'neutral'} variant="subtle">
                        {STATUS_LABEL[o.status] || o.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Landing — shared data load + module switcher
   ═══════════════════════════════════════════════════════════════════ */
export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [module, setModule] = useModuleState(MODULES)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [cyclesRes, summaryRes, ramRes, ordersRes, foodShopRes, ramShopRes, exhRes] = await Promise.allSettled([
      fetch('/api/admin/cycles', { cache: 'no-store' }),
      fetch('/api/admin/reports/summary', { cache: 'no-store' }),
      fetch('/api/admin/ram/summary', { cache: 'no-store' }),
      fetch('/api/admin/food/orders/list?status=Pending&limit=100', { cache: 'no-store' }),
      fetch('/api/admin/system/shopping', { cache: 'no-store' }),
      fetch('/api/admin/system/ram-shopping', { cache: 'no-store' }),
      fetch('/api/admin/exhibition/summary', { cache: 'no-store' }),
    ])

    const json = async (r) => {
      try {
        const j = await r.value.json()
        return j?.ok ? j : null
      } catch {
        return null
      }
    }

    const [cycles, summary, ram, orders, foodShop, ramShop, exhibition] = await Promise.all([
      cyclesRes.status === 'fulfilled' ? json(cyclesRes) : null,
      summaryRes.status === 'fulfilled' ? json(summaryRes) : null,
      ramRes.status === 'fulfilled' ? json(ramRes) : null,
      ordersRes.status === 'fulfilled' ? json(ordersRes) : null,
      foodShopRes.status === 'fulfilled' ? json(foodShopRes) : null,
      ramShopRes.status === 'fulfilled' ? json(ramShopRes) : null,
      exhRes.status === 'fulfilled' ? json(exhRes) : null,
    ])

    const failed = [cycles, summary, ram, orders, foodShop, ramShop, exhibition].filter((v) => v == null).length
    if (failed === 7) {
      setError(
        "Couldn't reach the database. Showing zeros. Check the Supabase connection and try again."
      )
    } else if (failed > 0) {
      setError("Some data sources couldn't be reached. Figures below may be incomplete.")
    }

    setData({ cycles, summary, ram, orders, foodShop, ramShop, exhibition })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header — module selector, live status and refresh on one scrollable row */}
      <div className="mb-6 flex items-center gap-3 overflow-x-auto">
        <ModuleSwitcher module={module} onChange={setModule} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {module === 'food' && data?.foodShop && (
            <Badge tone={data.foodShop.open ? 'success' : 'neutral'} variant="subtle" icon={data.foodShop.open ? undefined : Package}>
              {data.foodShop.open ? 'Food shopping open' : 'Food shopping closed'}
            </Badge>
          )}
          {module === 'ram' && data?.ramShop && (
            <Badge tone={data.ramShop.open ? 'success' : 'neutral'} variant="subtle">
              {data.ramShop.open ? 'Ram shopping open' : 'Ram shopping closed'}
            </Badge>
          )}
          {module === 'exhibition' && data?.exhibition && (
            <Badge tone={Number(data.exhibition.summary?.active_cycles) > 0 ? 'success' : 'neutral'} variant="subtle">
              {Number(data.exhibition.summary?.active_cycles) > 0 ? 'Exhibition open' : 'Exhibition closed'}
            </Badge>
          )}
          <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-danger-border bg-danger-bg p-4 text-sm text-danger-fg">
          {error}
        </div>
      )}

      {module === 'food' ? (
        <FoodDashboard loading={loading} data={data || {}} />
      ) : module === 'exhibition' ? (
        <ExhibitionDashboard loading={loading} data={data || {}} />
      ) : (
        <RamDashboard loading={loading} data={data || {}} />
      )}
    </div>
  )
}
