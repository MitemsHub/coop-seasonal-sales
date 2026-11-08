'use client'

// app/vendor/reports/page.jsx
// Vendor exhibition reports — their own orders, revenue, product performance,
// and export. Scoped to the vendor's own data only.
import { useEffect, useMemo, useState } from 'react'
import Skeleton from '../../components/ui/Skeleton'
import Button from '../../components/ui/Button'
import ExportButton from '../../components/ui/ExportButton'
import { downloadExcelWorkbook } from '../../../lib/excelExport'
import { RefreshCw } from 'lucide-react'

function safeJson(res, label) {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text().then((t) => { throw new Error(`Non-JSON from ${label}: ${t.slice(0, 200)}`) })
}

const money = (n) => `₦${Number(n || 0).toLocaleString()}`
// ASCII-only currency for PDF output so the naira glyph never scrambles.
const pdfMoney = (n) => `NGN ${Number(n || 0).toLocaleString()}`

function fileStamp() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function VendorReportsPage() {
  const [stats, setStats] = useState(null)
  const [lines, setLines] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [excelBusy, setExcelBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const [statsRes, ordersRes, sessionJson] = await Promise.all([
        fetch('/api/vendor/exhibition/stats', { cache: 'no-store' }),
        fetch('/api/vendor/exhibition/orders?limit=200', { cache: 'no-store' }),
        fetch('/api/vendor/session', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json().catch(() => null) : null))
          .catch(() => null),
      ])
      const statsJson = await safeJson(statsRes, 'stats')
      const ordersJson = await safeJson(ordersRes, 'orders')
      if (statsJson?.ok) setStats(statsJson.stats)
      if (sessionJson?.ok) setProfile(sessionJson)
      if (ordersJson?.ok) {
        // Flatten order lines for the vendor
        const allLines = []
        for (const o of ordersJson.orders || []) {
          for (const l of o.lines || []) {
            allLines.push({
              order_id: o.order_id,
              status: o.status === 'Delivered' ? 'Confirmed' : o.status,
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
  const totalOrders = new Set(lines.map((l) => l.order_id)).size
  const vendorName = profile?.vendor?.name || 'Vendor'
  const branchName = profile?.vendor?.branch || ''
  const cycleName = profile?.cycle?.name || ''

  const exportExcel = async () => {
    setExcelBusy(true)
    setErr(null)
    try {
      const summaryRows = [
        { Metric: 'Vendor', Value: vendorName },
        { Metric: 'Branch', Value: branchName || '—' },
        { Metric: 'Cycle', Value: cycleName || '—' },
        { Metric: 'Orders', Value: totalOrders },
        { Metric: 'Confirmed orders', Value: orders.Confirmed || 0 },
        { Metric: 'Pending orders', Value: orders.Pending || 0 },
        { Metric: 'Approved orders', Value: orders.Approved || 0 },
        { Metric: 'Total lines', Value: totalLines },
        { Metric: 'Total revenue', Value: totalRevenue },
      ]
      await downloadExcelWorkbook(`vendor-report-${fileStamp()}.xlsx`, [
        { name: 'Summary', rows: summaryRows },
        { name: 'By Item', rows: byProduct.map((r) => ({ Item: r.key, Lines: r.orders, Qty: r.qty, Amount: r.amount })) },
        { name: 'By Payment', rows: byPayment.map((r) => ({ Method: r.key, Lines: r.orders, Amount: r.amount })) },
        {
          name: 'Order Lines',
          rows: lines.map((l) => ({
            Order: `#${l.order_id}`,
            Date: l.created_at ? new Date(l.created_at).toLocaleDateString('en-GB') : '',
            Member: l.member,
            Payment: l.payment,
            Item: l.product,
            Status: l.status,
            Qty: l.qty,
            'Unit Price': l.unit_price,
            Amount: l.amount,
          })),
        },
      ])
    } catch (e) {
      setErr(e.message || 'Excel export failed')
    } finally {
      setExcelBusy(false)
    }
  }

  const exportPdf = async () => {
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const brand = [15, 76, 58]
    const generated = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })

    doc.setFillColor(...brand)
    doc.rect(0, 0, pageWidth, 28, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('Vendor Sales Report', 14, 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`${cycleName || 'Coop Exhibition'}  ·  Generated ${generated}`, 14, 21)

    doc.setTextColor(25, 25, 25)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(vendorName, 14, 38)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(90, 90, 90)
    doc.text(
      [branchName && `Branch: ${branchName}`, cycleName && `Cycle: ${cycleName}`].filter(Boolean).join('   ·   ') || 'Vendor report',
      14,
      44
    )

    autoTable(doc, {
      startY: 50,
      head: [['Report summary', '']],
      body: [
        ['Vendor', vendorName],
        ['Branch', branchName || '—'],
        ['Cycle', cycleName || '—'],
        ['Report date', generated],
        ['Orders', String(totalOrders)],
        ['Confirmed orders', String(orders.Confirmed || 0)],
        ['Pending orders', String(orders.Pending || 0)],
        ['Approved orders', String(orders.Approved || 0)],
        ['Total lines', String(totalLines)],
        ['Total revenue', pdfMoney(totalRevenue)],
      ],
      theme: 'grid',
      headStyles: { fillColor: brand, textColor: 255, fontSize: 10 },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
      margin: { left: 14, right: 14 },
    })

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 50) + 8,
      head: [['By item', 'Lines', 'Qty', 'Amount']],
      body: byProduct.length
        ? byProduct.map((r) => [r.key, r.orders, r.qty, pdfMoney(r.amount)])
        : [['No item data', '', '', '']],
      theme: 'striped',
      headStyles: { fillColor: brand, textColor: 255, fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 50) + 8,
      head: [['By payment method', 'Lines', 'Amount']],
      body: byPayment.length
        ? byPayment.map((r) => [r.key, r.orders, pdfMoney(r.amount)])
        : [['No payment data', '', '']],
      theme: 'striped',
      headStyles: { fillColor: brand, textColor: 255, fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 50) + 8,
      head: [['Order', 'Date', 'Member', 'Payment method', 'Item', 'Status', 'Qty', 'Amount']],
      body: lines.length
        ? lines.map((l) => [
            `#${l.order_id}`,
            l.created_at ? new Date(l.created_at).toLocaleDateString('en-GB') : '—',
            l.member || '—',
            l.payment || '—',
            l.product || '—',
            l.status || '—',
            l.qty,
            pdfMoney(l.amount),
          ])
        : [['No order lines', '', '', '', '', '', '', '']],
      theme: 'striped',
      headStyles: { fillColor: brand, textColor: 255, fontSize: 9 },
      styles: { fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak' },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 20 },
        2: { cellWidth: 32 },
        3: { cellWidth: 24 },
        5: { cellWidth: 20 },
        6: { halign: 'right', cellWidth: 14 },
        7: { halign: 'right', cellWidth: 24 },
      },
      foot: [['', '', '', '', '', 'Total revenue', '', pdfMoney(totalRevenue)]],
      footStyles: { fillColor: [238, 243, 240], textColor: 25, fontStyle: 'bold', fontSize: 8 },
      margin: { left: 14, right: 14 },
    })

    const pageCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(110, 110, 110)
      doc.text(`Vendor report · ${vendorName}`, 14, pageHeight - 8)
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' })
    }

    doc.save(`vendor-report-${fileStamp()}.pdf`)
  }

  const handleExportPdf = async () => {
    setPdfBusy(true)
    setErr(null)
    try {
      await exportPdf()
    } catch (e) {
      setErr(e.message || 'PDF export failed')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-h2 font-bold tracking-tight text-fg">My Report</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={load} disabled={loading} leftIcon={RefreshCw}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <ExportButton
            format="excel"
            onClick={exportExcel}
            disabled={loading}
            busy={excelBusy}
            busyText="Preparing…"
          />
          <ExportButton
            format="pdf"
            onClick={handleExportPdf}
            disabled={loading}
            busy={pdfBusy}
            busyText="Preparing…"
          />
        </div>
      </div>

      {err && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{err}</div>}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-3 mb-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'Confirmed', value: orders.Confirmed || 0 },
              { label: 'Total Lines', value: totalLines },
              { label: 'Pending', value: orders.Pending || 0 },
              { label: 'Approved', value: orders.Approved || 0 },
              { label: 'Revenue', value: money(totalRevenue) },
            ].map((c) => (
              <div key={c.label} className="min-w-0 rounded-xl border border-line bg-surface p-4">
                <div className="text-xs text-muted">{c.label}</div>
                <div className="mt-1 truncate text-xl font-semibold tabular-nums text-fg" title={String(c.value)}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* By Item */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
            <div className="border-b border-line bg-subtle/60 px-4 py-3 text-sm font-semibold text-fg">By Item</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2">Item</th>
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
            <div className="border-b border-line bg-subtle/60 px-4 py-3 text-sm font-semibold text-fg">By Payment Method</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2">Method</th>
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
            <div className="border-b border-line bg-subtle/60 px-4 py-3 text-sm font-semibold text-fg">Order Lines (Recent)</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/30 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2">Order</th>
                    <th className="px-4 py-2">Item</th>
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
                          l.status === 'Confirmed' ? 'bg-success-bg text-success-fg'
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
