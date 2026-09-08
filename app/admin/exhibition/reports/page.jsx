'use client'

// app/admin/exhibition/reports/page.jsx
// Exhibition admin reports — summary cards, breakdown tables, vendor performance,
// cycle payouts, and export (CSV). Mirrors the RAM reports pattern.
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'
import { FileBarChart2, RefreshCw } from 'lucide-react'

function safeJson(res, label) {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text().then((t) => { throw new Error(`Non-JSON from ${label}: ${t.slice(0, 200)}`) })
}

const money = (n) => `₦${Number(n || 0).toLocaleString()}`

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

function SummaryTable({ title, rows, columns }) {
  const cols = columns || [{ key: 'key', label: 'Key', align: 'left' }, { key: 'orders', label: 'Orders', align: 'right' }, { key: 'amount', label: 'Amount', align: 'right', fmt: money }]
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="border-b border-line bg-subtle/60 px-4 py-3 text-sm font-semibold text-fg">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle/30">
              {cols.map((c) => (
                <th key={c.key} className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(!rows || rows.length === 0) ? (
              <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-sm text-muted">No data</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.key || i} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                {cols.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.key === 'key' ? 'font-medium text-fg' : 'text-muted'}`}>
                    {c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
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
  const byPayment = s?.byPayment || []
  const byCategory = s?.byCategory || []
  const byLocation = s?.byLocation || []
  const vendorsByValue = s?.vendors_by_value || []
  const cyclePayouts = s?.cycle_payouts || []
  const recentOrders = s?.recent_orders || []

  const statusRows = useMemo(() => {
    if (!s) return []
    return Object.entries(byStatus).map(([status, count]) => ({
      key: status, orders: count, amount: 0,
    }))
  }, [s, byStatus])

  const paymentRows = useMemo(() => byPayment.map((p) => ({
    key: p.key, orders: p.orders, amount: p.amount,
  })), [byPayment])

  const exportAll = () => {
    const rows = []
    if (s) {
      rows.push({ section: 'Summary', metric: 'Vendors', value: s.vendors })
      rows.push({ section: 'Summary', metric: 'Products', value: s.products })
      rows.push({ section: 'Summary', metric: 'Orders', value: s.orders })
      rows.push({ section: 'Summary', metric: 'Loan Principal', value: s.loanPrincipal || 0 })
      rows.push({ section: 'Summary', metric: 'Loan Interest', value: s.loanInterest || 0 })
      rows.push({ section: 'Summary', metric: 'Loan Total', value: s.loanTotal || 0 })
      rows.push({ section: 'Summary', metric: 'Savings', value: s.amounts?.savings || 0 })
      rows.push({ section: 'Summary', metric: 'Cash', value: s.amounts?.cash || 0 })
      rows.push({ section: 'Summary', metric: 'Total Amount', value: s.amount || 0 })
    }
    downloadCsv(`exhibition-report-${fileStamp()}.csv`, rows)
  }

  const exportVendorCsv = () => downloadCsv(`exhibition-vendors-${fileStamp()}.csv`, vendorsByValue.map((v) => ({
    vendor: v.vendor_name, value: v.value,
  })))

  const exportCategoryCsv = () => downloadCsv(`exhibition-categories-${fileStamp()}.csv`, byCategory.map((c) => ({
    category: c.key, orders: c.orders, amount: c.amount,
  })))

  const exportLocationCsv = () => downloadCsv(`exhibition-locations-${fileStamp()}.csv`, byLocation.map((l) => ({
    location: l.key, orders: l.orders, amount: l.amount,
  })))

  const exportPayoutCsv = () => downloadCsv(`exhibition-payouts-${fileStamp()}.csv`, cyclePayouts.map((p) => ({
    cycle: p.name, code: p.code, status: p.status, gross: p.gross, deduction: p.deduction, net: p.net, paid: p.paid, balance: p.balance,
  })))

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition · Report</h1>
          <div className="flex gap-2">
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
            <Button onClick={load} disabled={loading} leftIcon={RefreshCw}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
            <Button variant="accent" onClick={exportAll} disabled={!s}>
              <FileBarChart2 className="h-4 w-4 mr-1" /> Export
            </Button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{err}</div>}

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : !s ? null : (
          <>
            {/* ─── Summary Cards ─── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
              {[
                { label: 'Vendors', value: s.vendors },
                { label: 'Products', value: s.products },
                { label: 'Pending', value: byStatus.Pending || 0 },
                { label: 'Approved', value: byStatus.Approved || 0 },
                { label: 'Delivered', value: byStatus.Delivered || 0 },
                { label: 'Loan Principal', value: money(s.loanPrincipal || 0) },
                { label: 'Loan Interest', value: money(s.loanInterest || 0) },
                { label: 'Loan Total', value: money(s.loanTotal || 0) },
                { label: 'Savings', value: money(s.amounts?.savings || 0) },
                { label: 'Cash', value: money(s.amounts?.cash || 0) },
                { label: 'Total Amount', value: money(s.amount || 0) },
                { label: 'Paid to Vendors', value: money(s.paid_to_vendors || 0) },
              ].map((c) => (
                <div key={c.label} className="ui-card p-4">
                  <div className="text-xs text-muted">{c.label}</div>
                  <div className="text-[13px] font-semibold sm:text-lg mt-1">{c.value}</div>
                </div>
              ))}
            </div>

            {/* ─── Breakdown Tables ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <SummaryTable title="By Status" rows={statusRows} columns={[
                { key: 'key', label: 'Status', align: 'left' },
                { key: 'orders', label: 'Orders', align: 'right' },
              ]} />
              <SummaryTable title="By Payment" rows={paymentRows} columns={[
                { key: 'key', label: 'Type', align: 'left' },
                { key: 'orders', label: 'Orders', align: 'right' },
                { key: 'amount', label: 'Amount', align: 'right', fmt: money },
              ]} />
              <SummaryTable title="By Category" rows={byCategory} columns={[
                { key: 'key', label: 'Category', align: 'left' },
                { key: 'orders', label: 'Orders', align: 'right' },
                { key: 'amount', label: 'Amount', align: 'right', fmt: money },
              ]} />
              <SummaryTable title="By Delivery Location" rows={byLocation} columns={[
                { key: 'key', label: 'Location', align: 'left' },
                { key: 'orders', label: 'Orders', align: 'right' },
                { key: 'amount', label: 'Amount', align: 'right', fmt: money },
              ]} />
            </div>

            {/* ─── Vendor Performance ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
              <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">By Vendor</h3>
                <Button size="sm" variant="secondary" onClick={exportVendorCsv}>Export CSV</Button>
              </div>
              {vendorsByValue.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No vendor data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                        <th className="px-4 py-2">#</th>
                        <th className="px-4 py-2">Vendor</th>
                        <th className="px-4 py-2 text-right">Order Value</th>
                        <th className="px-4 py-2 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorsByValue.map((v, i) => (
                        <tr key={v.vendor_id} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                          <td className="px-4 py-2.5 text-muted">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-fg">{v.vendor_name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{money(v.value)}</td>
                          <td className="px-4 py-2.5 text-right text-muted">{s.amount ? ((v.value / s.amount) * 100).toFixed(1) + '%' : '0%'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ─── Cycle Payouts ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
              <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">Applications Pack by Payment to Vendors</h3>
                <Button size="sm" variant="secondary" onClick={exportPayoutCsv}>Export CSV</Button>
              </div>
              {cyclePayouts.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No payout data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
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
                        <tr key={p.cycle_id} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                          <td className="px-4 py-2.5 font-medium text-fg">{p.name || `#${p.cycle_id}`}</td>
                          <td className="px-4 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'active' ? 'bg-success-bg text-success-fg' : 'bg-subtle text-muted'}`}>{p.status}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{money(p.gross)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(p.deduction)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(p.net)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-success-fg">{money(p.paid)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${p.balance > 0 ? 'text-warning-fg' : 'text-muted'}`}>{money(p.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ─── Recent Orders ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden">
              <div className="border-b border-line bg-subtle/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">Recent Orders</h3>
              </div>
              {recentOrders.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No recent orders</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
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
                        <tr key={o.id} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                          <td className="px-4 py-2.5 font-medium text-fg">#{o.order_id}</td>
                          <td className="px-4 py-2.5">
                            <div className="text-fg">{o.member_name_snapshot || '—'}</div>
                            <div className="text-xs text-muted">{o.member_id}</div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              o.status === 'Delivered' ? 'bg-success-bg text-success-fg'
                                : o.status === 'Cancelled' ? 'bg-danger-bg text-danger-fg'
                                : o.status === 'Approved' ? 'bg-info-bg text-info-fg'
                                : 'bg-warning-bg text-warning-fg'
                            }`}>{o.status}</span>
                          </td>
                          <td className="px-4 py-2.5 text-muted">{o.payment_option || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(o.total_amount)}</td>
                          <td className="px-4 py-2.5 text-right text-muted">{new Date(o.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  )
}
