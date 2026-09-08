'use client'

// app/vendor/reports/page.jsx
// Vendor exhibition reports — their own orders, revenue, product performance,
// and export. Scoped to the vendor's own data only.
import { useEffect, useMemo, useState } from 'react'
import Skeleton from '../../components/ui/Skeleton'
import Button from '../../components/ui/Button'
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

export default function VendorReportsPage() {
  const [stats, setStats] = useState(null)
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const [statsRes, ordersRes] = await Promise.all([
        fetch('/api/vendor/exhibition/stats', { cache: 'no-store' }),
        fetch('/api/vendor/exhibition/orders', { cache: 'no-store' }),
      ])
      const statsJson = await safeJson(statsRes, 'stats')
      const ordersJson = await safeJson(ordersRes, 'orders')
      if (statsJson?.ok) setStats(statsJson.stats)
      if (ordersJson?.ok) {
        // Flatten order lines for the vendor
        const allLines = []
        for (const o of ordersJson.orders || []) {
          for (const l of o.lines || []) {
            allLines.push({
              order_id: o.order_id,
              status: o.status,
              payment: o.payment_option,
              member: o.member_name_snapshot || o.member_id,
              product: l.product_name || '',
              qty: Number(l.qty || 0),
              unit_price: Number(l.unit_price || l.final_price || 0),
              amount: Number(l.amount || 0),
              created_at: o.created_at,
            })
          }
        }
        setLines(allLines)
      }
    } catch (e) {
      setErr(e.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const s = stats || {}
  const orders = s.orders || {}
  const byProduct = useMemo(() => {
    const map = new Map()
    for (const l of lines) {
      const key = l.product || 'Unknown'
      if (!map.has(key)) map.set(key, { key, orders: 0, qty: 0, amount: 0 })
      const agg = map.get(key)
      agg.orders += 1
      agg.qty += l.qty
      agg.amount += l.amount
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [lines])

  const byPayment = useMemo(() => {
    const map = new Map()
    for (const l of lines) {
      const key = l.payment || 'Unknown'
      if (!map.has(key)) map.set(key, { key, orders: 0, amount: 0 })
      const agg = map.get(key)
      agg.orders += 1
      agg.amount += l.amount
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [lines])

  const totalRevenue = s.revenue || 0
  const totalLines = lines.length

  const exportLinesCsv = () => downloadCsv(`vendor-orders-${fileStamp()}.csv`, lines.map((l) => ({
    order: l.order_id, status: l.status, payment: l.payment, member: l.member,
    product: l.product, qty: l.qty, unit_price: l.unit_price, amount: l.amount, date: l.created_at,
  })))

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-h2 font-bold tracking-tight text-fg">My Report</h1>
        <div className="flex gap-2">
          <Button onClick={load} disabled={loading} leftIcon={RefreshCw}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button variant="accent" onClick={exportLinesCsv} disabled={!lines.length}>
            <FileBarChart2 className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {err && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{err}</div>}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
            {[
              { label: 'Active Products', value: s.product_count || 0 },
              { label: 'Total Lines', value: totalLines },
              { label: 'Pending', value: orders.Pending || 0 },
              { label: 'Approved', value: orders.Approved || 0 },
              { label: 'Delivered', value: orders.Delivered || 0 },
              { label: 'Revenue', value: money(totalRevenue) },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-line bg-surface p-4">
                <div className="text-xs text-muted">{c.label}</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{c.value}</div>
              </div>
            ))}
          </div>

          {/* By Product */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
            <div className="border-b border-line bg-subtle/60 px-4 py-3 text-sm font-semibold text-fg">By Product</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2 text-right">Lines</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {byProduct.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">No data</td></tr>
                  ) : byProduct.map((r) => (
                    <tr key={r.key} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                      <td className="px-4 py-2.5 font-medium text-fg">{r.key}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.orders}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.qty}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By Payment */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
            <div className="border-b border-line bg-subtle/60 px-4 py-3 text-sm font-semibold text-fg">By Payment Type</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2 text-right">Lines</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {byPayment.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-muted">No data</td></tr>
                  ) : byPayment.map((r) => (
                    <tr key={r.key} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                      <td className="px-4 py-2.5 font-medium text-fg">{r.key}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.orders}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Lines */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-3">
              <h3 className="text-sm font-semibold text-fg">Order Lines (Recent)</h3>
              <Button size="sm" variant="secondary" onClick={exportLinesCsv}>Export CSV</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2">Order</th>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.slice(0, 50).map((l, i) => (
                    <tr key={i} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                      <td className="px-4 py-2.5 font-medium text-fg">#{l.order_id}</td>
                      <td className="px-4 py-2.5 text-muted">{l.product}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          l.status === 'Delivered' ? 'bg-success-bg text-success-fg'
                            : l.status === 'Cancelled' ? 'bg-danger-bg text-danger-fg'
                            : l.status === 'Approved' ? 'bg-info-bg text-info-fg'
                            : 'bg-warning-bg text-warning-fg'
                        }`}>{l.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{l.qty}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(l.amount)}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{new Date(l.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
