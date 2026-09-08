'use client'

// app/admin/exhibition/reports/page.jsx
// Exhibition admin reports — summary cards, vendor performance, cycle payouts,
// and export (CSV + PDF). Mirrors the food/ram reports pattern.
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import ExportButton from '../../../components/ui/ExportButton'
import Skeleton from '../../../components/ui/Skeleton'
import { FileBarChart2 } from 'lucide-react'

function safeJson(res, label) {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text().then((t) => { throw new Error(`Non-JSON from ${label}: ${t.slice(0, 200)}`) })
}

const fmt = (n) => `₦${Number(n || 0).toLocaleString()}`
const pct = (n) => `${Number(n || 0).toFixed(1)}%`

function fileStamp() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function downloadCsv(filename, rows) {
  if (!rows?.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function ExhibitionReportsPage() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cycleId, setCycleId] = useState('')
  const [cycles, setCycles] = useState([])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const qs = cycleId ? `?cycle_id=${cycleId}` : ''
      const [summaryRes, cyclesRes] = await Promise.all([
        fetch(`/api/admin/exhibition/summary${qs}`, { cache: 'no-store' }),
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }),
      ])
      const summary = await safeJson(summaryRes, 'summary')
      const cyclesJson = await safeJson(cyclesRes, 'cycles')
      if (!summary.ok) throw new Error(summary.error)
      setData(summary.summary)
      if (cyclesJson.ok) setCycles(cyclesJson.cycles || [])
    } catch (e) {
      setErr(e.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [cycleId]) // eslint-disable-line react-hooks/exhaustive-deps

  const s = data
  const byStatus = s?.byStatus || {}
  const amounts = s?.amounts || {}
  const vendorsByValue = s?.vendors_by_value || []
  const cyclePayouts = s?.cycle_payouts || []
  const recentOrders = s?.recent_orders || []

  const statusRows = useMemo(() => {
    if (!s) return []
    return Object.entries(byStatus).map(([status, count]) => ({
      status,
      orders: count,
      pct: s.orders ? ((count / s.orders) * 100).toFixed(1) + '%' : '0%',
    }))
  }, [s, byStatus])

  const paymentRows = useMemo(() => {
    if (!amounts.total) return []
    return [
      { type: 'Loan', amount: amounts.loans, pct: amounts.total ? ((amounts.loans / amounts.total) * 100).toFixed(1) + '%' : '0%' },
      { type: 'Savings', amount: amounts.savings, pct: amounts.total ? ((amounts.savings / amounts.total) * 100).toFixed(1) + '%' : '0%' },
      { type: 'Cash', amount: amounts.cash, pct: amounts.total ? ((amounts.cash / amounts.total) * 100).toFixed(1) + '%' : '0%' },
    ].filter((r) => r.amount > 0)
  }, [amounts])

  const exportVendorCsv = () => downloadCsv(`exhibition-vendors-${fileStamp()}.csv`, vendorsByValue.map((v) => ({
    vendor: v.vendor_name, value: v.value,
  })))

  const exportPayoutCsv = () => downloadCsv(`exhibition-payouts-${fileStamp()}.csv`, cyclePayouts.map((p) => ({
    cycle: p.name, code: p.code, status: p.status, gross: p.gross, deduction: p.deduction, net: p.net, paid: p.paid, balance: p.balance,
  })))

  const exportOrdersCsv = () => downloadCsv(`exhibition-orders-${fileStamp()}.csv`, recentOrders.map((o) => ({
    id: o.order_id, status: o.status, member: o.member_name_snapshot, member_id: o.member_id,
    payment: o.payment_option, total: o.total_amount, date: o.created_at,
  })))

  if (err) return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-6 text-center text-danger-fg">{err}</div>
    </ProtectedRoute>
  )

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Report</h1>
            <p className="mt-0.5 text-sm text-muted">Summary of cycles, orders, vendors, and payouts.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
            >
              <option value="">All active cycles</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.name || `Cycle ${c.id}`} ({c.code})</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        ) : !s ? null : (
          <>
            {/* Summary Cards */}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Cycles', value: s.cycles, sub: `${s.active_cycles} active` },
                { label: 'Vendors', value: s.vendors },
                { label: 'Products', value: s.products, sub: `${s.active_products} active` },
                { label: 'Orders', value: s.orders },
                { label: 'Gross Value', value: fmt(s.amount) },
                { label: 'Paid to Vendors', value: fmt(s.paid_to_vendors) },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-line bg-surface p-4">
                  <p className="text-chips font-medium text-muted">{c.label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-fg">{c.value}</p>
                  {c.sub && <p className="text-chips text-muted">{c.sub}</p>}
                </div>
              ))}
            </section>

            {/* Status + Payment breakdown */}
            <section className="mb-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-fg">By Status</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-chips text-muted">
                      <th className="pb-2">Status</th><th className="pb-2 text-right">Orders</th><th className="pb-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map((r) => (
                      <tr key={r.status} className="border-b border-line/50 last:border-0">
                        <td className="py-2 font-medium text-fg">{r.status}</td>
                        <td className="py-2 text-right tabular-nums">{r.orders}</td>
                        <td className="py-2 text-right text-muted">{r.pct}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-fg">By Payment Type</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-chips text-muted">
                      <th className="pb-2">Type</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentRows.map((r) => (
                      <tr key={r.type} className="border-b border-line/50 last:border-0">
                        <td className="py-2 font-medium text-fg">{r.type}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(r.amount)}</td>
                        <td className="py-2 text-right text-muted">{r.pct}</td>
                      </tr>
                    ))}
                    {paymentRows.length === 0 && (
                      <tr><td colSpan={3} className="py-4 text-center text-muted">No payment data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Vendor Performance */}
            <section className="mb-6 rounded-xl border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">Vendor Performance</h3>
                <ExportButton onClick={exportVendorCsv} label="Export CSV" />
              </div>
              {vendorsByValue.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No vendor data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/60 text-left text-chips text-muted">
                        <th className="px-4 py-2">#</th>
                        <th className="px-4 py-2">Vendor</th>
                        <th className="px-4 py-2 text-right">Order Value</th>
                        <th className="px-4 py-2 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorsByValue.map((v, i) => {
                        const share = s.amount ? ((v.value / s.amount) * 100).toFixed(1) + '%' : '0%'
                        return (
                          <tr key={v.vendor_id} className="border-b border-line/50 last:border-0">
                            <td className="px-4 py-2 text-muted">{i + 1}</td>
                            <td className="px-4 py-2 font-medium text-fg">{v.vendor_name}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmt(v.value)}</td>
                            <td className="px-4 py-2 text-right text-muted">{share}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Cycle Payouts */}
            <section className="mb-6 rounded-xl border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">Cycle Payouts</h3>
                <ExportButton onClick={exportPayoutCsv} label="Export CSV" />
              </div>
              {cyclePayouts.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No payout data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/60 text-left text-chips text-muted">
                        <th className="px-4 py-2">Cycle</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2 text-right">Gross</th>
                        <th className="px-4 py-2 text-right">Deduction</th>
                        <th className="px-4 py-2 text-right">Net</th>
                        <th className="px-4 py-2 text-right">Paid</th>
                        <th className="px-4 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cyclePayouts.map((p) => (
                        <tr key={p.cycle_id} className="border-b border-line/50 last:border-0">
                          <td className="px-4 py-2 font-medium text-fg">{p.name || `#${p.cycle_id}`}</td>
                          <td className="px-4 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'active' ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted'}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(p.gross)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(p.deduction)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(p.net)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-success-fg">{fmt(p.paid)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums font-medium ${p.balance > 0 ? 'text-warning-fg' : 'text-muted'}`}>{fmt(p.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Recent Orders */}
            <section className="rounded-xl border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">Recent Orders</h3>
                <ExportButton onClick={exportOrdersCsv} label="Export CSV" />
              </div>
              {recentOrders.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No recent orders</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/60 text-left text-chips text-muted">
                        <th className="px-4 py-2">Order</th>
                        <th className="px-4 py-2">Member</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Payment</th>
                        <th className="px-4 py-2 text-right">Total</th>
                        <th className="px-4 py-2 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((o) => (
                        <tr key={o.id} className="border-b border-line/50 last:border-0">
                          <td className="px-4 py-2 font-medium text-fg">#{o.order_id}</td>
                          <td className="px-4 py-2">
                            <div className="text-fg">{o.member_name_snapshot || '—'}</div>
                            <div className="text-chips text-muted">{o.member_id}</div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              o.status === 'Delivered' ? 'bg-success-bg text-success-fg'
                                : o.status === 'Cancelled' ? 'bg-danger-bg text-danger-fg'
                                : o.status === 'Approved' ? 'bg-info-bg text-info-fg'
                                : 'bg-warning-bg text-warning-fg'
                            }`}>{o.status}</span>
                          </td>
                          <td className="px-4 py-2 text-muted">{o.payment_option || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(o.total_amount)}</td>
                          <td className="px-4 py-2 text-right text-muted">{new Date(o.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </ProtectedRoute>
  )
}
