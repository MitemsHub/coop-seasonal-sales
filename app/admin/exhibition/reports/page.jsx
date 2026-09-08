'use client'

// app/admin/exhibition/reports/page.jsx
// Exhibition admin reports — summary cards, breakdown tables, vendor performance,
// cycle payouts, and three export sections matching the RAM reports pattern.
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import ExportButton from '../../../components/ui/ExportButton'
import Skeleton from '../../../components/ui/Skeleton'
import { FileBarChart2, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'

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

function downloadBase64({ filename, type, data }) {
  const byteCharacters = atob(data)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i)
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: type || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename || 'download'; a.click()
  URL.revokeObjectURL(url)
}

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

const selectCls = 'bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30'

function SummaryTable({ title, rows, columns, pagination }) {
  const pageSize = pagination?.pageSize || 0
  const page = pagination?.page || 1
  const pageCount = pageSize ? Math.max(1, Math.ceil((rows?.length || 0) / pageSize)) : 1
  const safePage = pageSize ? Math.min(Math.max(1, page), pageCount) : 1
  const paged = pageSize ? (rows || []).slice((safePage - 1) * pageSize, safePage * pageSize) : rows
  const cols = columns || [{ key: 'key', label: 'Key', align: 'left' }, { key: 'orders', label: 'Orders', align: 'right' }, { key: 'amount', label: 'Amount', align: 'right', fmt: money }]

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {pageSize > 0 && pageCount > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <button type="button" className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50"
              onClick={() => pagination.onChange?.(Math.max(1, safePage - 1))} disabled={safePage <= 1}>Prev</button>
            <span>{safePage} / {pageCount}</span>
            <button type="button" className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50"
              onClick={() => pagination.onChange?.(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount}>Next</button>
          </div>
        )}
      </div>
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
            {(!paged || paged.length === 0) ? (
              <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-sm text-muted">No data</td></tr>
            ) : paged.map((r, i) => (
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
  const [branches, setBranches] = useState([])

  // Pagination for By Location
  const [locPage, setLocPage] = useState(1)

  // Vendor table search + pagination
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorPage, setVendorPage] = useState(1)
  const vendorPageSize = 8

  // Applications by Branch filters
  const [appBranchId, setAppBranchId] = useState('')
  const [appStatus, setAppStatus] = useState('')
  const [appPayment, setAppPayment] = useState('')
  const [appFrom, setAppFrom] = useState('')
  const [appTo, setAppTo] = useState('')
  const [appBusy, setAppBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)

  // Applications Pack by Payment to Vendors filters
  const [packVendorId, setPackVendorId] = useState('')
  const [packStatus, setPackStatus] = useState('')
  const [packPayment, setPackPayment] = useState('')
  const [packFrom, setPackFrom] = useState('')
  const [packTo, setPackTo] = useState('')
  const [packExcelBusy, setPackExcelBusy] = useState(false)
  const [packPdfBusy, setPackPdfBusy] = useState(false)
  const packBusy = packExcelBusy || packPdfBusy
  const [packProgress, setPackProgress] = useState({ current: 0, total: 0 })

  // Delivery Pack filters
  const [dpBranchId, setDpBranchId] = useState('')
  const [dpFrom, setDpFrom] = useState('')
  const [dpTo, setDpTo] = useState('')
  const [dpBusy, setDpBusy] = useState(false)

  const safeJsonMemo = (res, label) => safeJson(res, label)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const qs = cycleId ? `?cycle_id=${cycleId}` : ''
      const [summaryRes, cyclesRes, branchesRes] = await Promise.all([
        fetch(`/api/admin/exhibition/summary${qs}`, { cache: 'no-store' }),
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }),
        fetch('/api/branches/list', { cache: 'no-store' }),
      ])
      const summary = await safeJson(summaryRes, 'summary')
      const cyclesJson = await safeJson(cyclesRes, 'cycles')
      const branchesJson = await safeJson(branchesRes, 'branches')
      if (!summary.ok) throw new Error(summary.error)
      setData(summary.summary)
      if (cyclesJson.ok) setCycles(cyclesJson.cycles || [])
      if (branchesJson.ok) setBranches(branchesJson.branches || [])
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
  const statusRows = useMemo(() => Object.entries(byStatus).map(([key, orders]) => ({ key, orders, amount: 0 })), [byStatus])
  const paymentRows = useMemo(() => byPayment.map((p) => ({ key: p.key, orders: p.orders, amount: p.amount })), [byPayment])

  // ─── Export helpers ───
  const exportAllPdf = async () => {
    if (!s) return
    setReportBusy(true)
    try {
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const sanitize = (val) => String(val ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')
      const pageWidth = doc.internal.pageSize.getWidth()
      const marginX = 12

      doc.setFontSize(14)
      doc.text('Exhibition · Report', 12, 12)
      doc.setFontSize(9)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)

      // Summary metrics table
      const metricColW = { metric: 52, value: 36 }
      const metricTableW = metricColW.metric + metricColW.value
      autoTable(doc, {
        head: [['Metric', 'Value']],
        body: [
          ['Vendors', String(s.vendors ?? 0)],
          ['Products', String(s.products ?? 0)],
          ['Orders', String(s.orders ?? 0)],
          ['Loan Principal', money(s.loanPrincipal || 0)],
          ['Loan Interest', money(s.loanInterest || 0)],
          ['Loan Total', money(s.loanTotal || 0)],
          ['Savings', money(s.amounts?.savings || 0)],
          ['Cash', money(s.amounts?.cash || 0)],
          ['Total Amount', money(s.amount || 0)],
        ].map((r) => r.map(sanitize)),
        startY: 22,
        rowPageBreak: 'avoid',
        tableWidth: metricTableW,
        styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
        headStyles: { fillColor: [75, 85, 99] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: metricColW.metric },
          1: { cellWidth: metricColW.value },
        },
        didParseCell: (data) => {
          if (data.section !== 'head' && data.section !== 'body') return
          if (data.column.index === 0) data.cell.styles.halign = 'left'
          if (data.column.index === 1) data.cell.styles.halign = 'right'
        },
        margin: { left: marginX, right: Math.max(marginX, pageWidth - metricTableW - marginX) },
      })

      // Breakdown tables
      const addBreakdownSection = (title, rows, columns) => {
        let startY = (doc.lastAutoTable?.finalY || 22) + 10
        if (startY > 180) {
          doc.addPage()
          startY = 22
        }
        doc.setFontSize(12)
        doc.text(title, 12, startY - 2)
        const body = (rows || []).map((r) => columns.map((c) => sanitize(c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? ''))))
        const head = [columns.map((c) => c.label)]
        const colWidths = columns.map((c) => c.width || 40)
        const totalW = colWidths.reduce((a, b) => a + b, 0)
        autoTable(doc, {
          head,
          body,
          startY,
          rowPageBreak: 'avoid',
          tableWidth: totalW,
          styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          columnStyles: columns.reduce((acc, c, i) => {
            acc[i] = { cellWidth: c.width || 40 }
            return acc
          }, {}),
          didParseCell: (data) => {
            if (data.section !== 'head' && data.section !== 'body') return
            data.cell.styles.halign = data.column.index === 0 ? 'left' : 'right'
          },
          margin: { left: marginX, right: Math.max(marginX, pageWidth - totalW - marginX) },
        })
      }

      addBreakdownSection('By Status', statusRows, [
        { key: 'key', label: 'Status', width: 50 },
        { key: 'orders', label: 'Orders', width: 30 },
      ])

      addBreakdownSection('By Payment', paymentRows, [
        { key: 'key', label: 'Type', width: 50 },
        { key: 'orders', label: 'Orders', width: 30 },
        { key: 'amount', label: 'Amount', width: 52, fmt: money },
      ])

      addBreakdownSection('By Category', byCategory, [
        { key: 'key', label: 'Category', width: 50 },
        { key: 'orders', label: 'Orders', width: 30 },
        { key: 'amount', label: 'Amount', width: 52, fmt: money },
      ])

      addBreakdownSection('By Delivery Location', byLocation, [
        { key: 'key', label: 'Location', width: 60 },
        { key: 'orders', label: 'Orders', width: 30 },
        { key: 'amount', label: 'Amount', width: 52, fmt: money },
      ])

      // Vendor performance
      if (vendorsByValue.length > 0) {
        addBreakdownSection('By Vendor', vendorsByValue, [
          { key: 'vendor_name', label: 'Vendor', width: 80 },
          { key: 'value', label: 'Order Value', width: 52, fmt: money },
        ])
      }

      doc.save(`exhibition_report_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      setErr(e?.message || 'Download failed')
    } finally {
      setReportBusy(false)
    }
  }

  // ─── Exhibition orders fetcher (paginated) ───
  const fetchExhibitionOrders = async (opts) => {
    const pageSize = 500
    let offset = 0
    const all = []
    while (true) {
      const qs = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
      if (opts?.status) qs.set('status', opts.status)
      if (opts?.payment) qs.set('payment', opts.payment)
      if (opts?.branch_id) qs.set('branch_id', String(opts.branch_id))
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      if (cycleId) qs.set('cycle_id', cycleId)
      const res = await fetch(`/api/admin/exhibition/orders?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJsonMemo(res, '/api/admin/exhibition/orders')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders')
      const chunk = json.orders || []
      all.push(...chunk)
      if (chunk.length < pageSize) break
      offset += pageSize
      if (offset > 10000) break
    }
    return all
  }

  // ─── Vendor bank details fetcher ───
  const fetchVendorBanks = async () => {
    const qs = cycleId ? `?cycle_id=${cycleId}` : ''
    const res = await fetch(`/api/admin/exhibition/vendor-banks/vendors${qs}`, { cache: 'no-store' })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok && res.status === 404) return new Map()
    if (!ct.includes('application/json')) {
      if (res.status === 404) return new Map()
      const text = await res.text()
      throw new Error(`Non-JSON from vendor-banks (${res.status}): ${text.slice(0, 300)}`)
    }
    const json = await res.json()
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load bank details')
    const map = new Map()
    for (const v of json.vendors || []) {
      if (v?.id == null) continue
      map.set(String(v.id), v)
    }
    return map
  }

  // ─── Applications Pack by Payment to Vendors — Excel ───
  const exportVendorPackExcel = async () => {
    setPackExcelBusy(true)
    setErr(null)
    try {
      const [orders, bankMap] = await Promise.all([
        fetchExhibitionOrders({
          status: packStatus,
          payment: packPayment,
          branch_id: appBranchId || undefined,
          from: packFrom,
          to: packTo,
        }),
        fetchVendorBanks(),
      ])

      // Group lines by vendor_id
      const vendorLines = new Map()
      for (const o of orders || []) {
        for (const l of o.lines || []) {
          const vid = String(l.vendor_id || '')
          if (!vid) continue
          const arr = vendorLines.get(vid) || []
          arr.push({
            order_id: o.order_id || o.id,
            created_at: o.created_at,
            status: o.status,
            payment: o.payment_option,
            member_id: o.member_id,
            member_name: o.member_name_snapshot || '',
            branch: o.branch_name || '',
            product_name: l.product_name || '',
            sku: l.sku || '',
            unit: l.unit || '',
            qty: Number(l.qty || 0),
            vendor_price: Number(l.vendor_price || 0),
            final_price: Number(l.final_price || 0),
            amount: Number(l.amount || 0),
            delivered: l.delivered,
          })
          vendorLines.set(vid, arr)
        }
      }

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const safeName = (name) => String(name || 'Sheet').replace(/[\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet'

      const vendorIds = packVendorId ? [packVendorId] : [...vendorLines.keys()]
      const totalVendors = vendorIds.length
      setPackProgress({ current: 0, total: totalVendors })

      let i = 0
      for (const vid of vendorIds) {
        i += 1
        setPackProgress({ current: i, total: totalVendors })
        const lines = vendorLines.get(vid) || []
        if (!lines.length && packVendorId) {
          // Still create a sheet for the selected vendor even if no lines
          const vInfo = bankMap.get(vid)
          const ws = wb.addWorksheet(safeName(vInfo?.name || `Vendor ${vid}`))
          ws.addRow(['Exhibition · Payment to Vendors'])
          ws.addRow([`Vendor: ${vInfo?.name || vid}`])
          ws.addRow([`Filters: Status ${packStatus || 'All'} | Payment ${packPayment || 'All'} | From ${packFrom || 'Any'} | To ${packTo || 'Any'}`])
          ws.addRow([])
          ws.addRow(['Bank Details'])
          ws.addRow(['Bank Name', vInfo?.bank?.bank_name || ''])
          ws.addRow(['Account Name', vInfo?.bank?.account_name || ''])
          ws.addRow(['Account Number', vInfo?.bank?.account_number || ''])
          continue
        }
        if (!lines.length) continue

        const vInfo = bankMap.get(vid)
        const vendorName = vInfo?.name || lines[0]?.member_name || `Vendor ${vid}`
        const ws = wb.addWorksheet(safeName(vendorName))
        ws.addRow(['Exhibition · Payment to Vendors'])
        ws.addRow([`Vendor: ${vendorName}`])
        ws.addRow([`Filters: Status ${packStatus || 'All'} | Payment ${packPayment || 'All'} | From ${packFrom || 'Any'} | To ${packTo || 'Any'}`])
        ws.addRow([])
        ws.addRow(['Bank Details'])
        ws.addRow(['Bank Name', vInfo?.bank?.bank_name || ''])
        ws.addRow(['Account Name', vInfo?.bank?.account_name || ''])
        ws.addRow(['Account Number', vInfo?.bank?.account_number || ''])
        ws.addRow([])

        const headers = ['Order', 'Date', 'Status', 'Payment', 'Member ID', 'Member Name', 'Branch', 'Product', 'SKU', 'Unit', 'Qty', 'Unit Price', 'Amount']
        ws.addRow(headers)
        for (const l of lines) {
          ws.addRow([
            l.order_id,
            l.created_at ? new Date(l.created_at).toLocaleString() : '',
            l.status,
            l.payment,
            l.member_id,
            l.member_name,
            l.branch,
            l.product_name,
            l.sku,
            l.unit,
            l.qty,
            l.vendor_price,
            l.amount,
          ])
        }
        ws.addRow([])
        const totalQty = lines.reduce((a, l) => a + l.qty, 0)
        const totalAmt = lines.reduce((a, l) => a + l.amount, 0)
        ws.addRow(['TOTAL', '', '', '', '', '', '', '', '', '', totalQty, '', totalAmt])
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `exhibition_payment_to_vendors_${fileStamp()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(e?.message || 'Download failed')
    } finally {
      setPackExcelBusy(false)
      setPackProgress({ current: 0, total: 0 })
    }
  }

  // ─── Applications Pack by Payment to Vendors — PDF ───
  const exportVendorPackPdf = async () => {
    setPackPdfBusy(true)
    setErr(null)
    try {
      const [orders, bankMap] = await Promise.all([
        fetchExhibitionOrders({
          status: packStatus,
          payment: packPayment,
          branch_id: appBranchId || undefined,
          from: packFrom,
          to: packTo,
        }),
        fetchVendorBanks(),
      ])

      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const sanitize = (val) => String(val ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')

      doc.setFontSize(14)
      doc.text('Exhibition · Payment to Vendors', 12, 12)
      doc.setFontSize(9)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)
      doc.text(
        `Filters: Status ${sanitize(packStatus || 'All')}  |  Payment ${sanitize(packPayment || 'All')}  |  From ${sanitize(packFrom || 'Any')}  |  To ${sanitize(packTo || 'Any')}`,
        12, 24
      )

      // Group lines by vendor_id
      const vendorLines = new Map()
      for (const o of orders || []) {
        for (const l of o.lines || []) {
          const vid = String(l.vendor_id || '')
          if (!vid) continue
          const arr = vendorLines.get(vid) || []
          arr.push({
            order_id: o.order_id || o.id,
            created_at: o.created_at,
            status: o.status,
            payment: o.payment_option,
            member_id: o.member_id,
            member_name: o.member_name_snapshot || '',
            branch: o.branch_name || '',
            product_name: l.product_name || '',
            sku: l.sku || '',
            unit: l.unit || '',
            qty: Number(l.qty || 0),
            vendor_price: Number(l.vendor_price || 0),
            final_price: Number(l.final_price || 0),
            amount: Number(l.amount || 0),
          })
          vendorLines.set(vid, arr)
        }
      }

      const vendorIds = packVendorId ? [packVendorId] : [...vendorLines.keys()]
      const totalVendors = vendorIds.length
      setPackProgress({ current: 0, total: totalVendors })

      let i = 0
      for (const vid of vendorIds) {
        i += 1
        setPackProgress({ current: i, total: totalVendors })
        const lines = vendorLines.get(vid) || []
        if (!lines.length) continue

        const vInfo = bankMap.get(vid)
        const vendorName = sanitize(vInfo?.name || lines[0]?.member_name || `Vendor ${vid}`)

        let y = (doc.lastAutoTable?.finalY || 0) ? (doc.lastAutoTable.finalY + 8) : 32
        if (y > 160) {
          doc.addPage()
          y = 32
        }
        doc.setFontSize(11)
        doc.text(`Vendor: ${vendorName}`, 12, y)

        autoTable(doc, {
          head: [['Bank Detail', 'Value']],
          body: [
            ['Bank Name', vInfo?.bank?.bank_name || ''],
            ['Account Name', vInfo?.bank?.account_name || ''],
            ['Account Number', vInfo?.bank?.account_number || ''],
          ].map((r) => r.map(sanitize)),
          startY: y + 4,
          rowPageBreak: 'avoid',
          styles: { fontSize: 8 },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { left: 12, right: 12 },
        })

        const head = [['Order', 'Date', 'Status', 'Payment', 'Member', 'Branch', 'Product', 'SKU', 'Qty', 'Unit Price', 'Amount']]
        const body = lines.map((l) => [
          String(l.order_id ?? ''),
          l.created_at ? new Date(l.created_at).toLocaleString() : '',
          sanitize(l.status || ''),
          sanitize(l.payment || ''),
          sanitize(l.member_name || l.member_id || ''),
          sanitize(l.branch || ''),
          sanitize(l.product_name || ''),
          sanitize(l.sku || ''),
          String(l.qty),
          `NGN ${l.vendor_price.toLocaleString()}`,
          `NGN ${l.amount.toLocaleString()}`,
        ])

        const totals = lines.reduce((acc, l) => {
          acc.qty += l.qty
          acc.amount += l.amount
          return acc
        }, { qty: 0, amount: 0 })
        body.push(['TOTAL', '', '', '', '', '', '', '', String(totals.qty), '', `NGN ${totals.amount.toLocaleString()}`])
        const totalsRowIndex = body.length - 1

        autoTable(doc, {
          head,
          body,
          startY: (doc.lastAutoTable?.finalY || y + 4) + 6,
          rowPageBreak: 'avoid',
          styles: { fontSize: 7 },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          columnStyles: { 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index === totalsRowIndex) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [243, 244, 246]
            }
          },
          margin: { left: 12, right: 12 },
        })
      }

      doc.save(`exhibition_payment_to_vendors_${fileStamp()}.pdf`)
    } catch (e) {
      setErr(e?.message || 'Download failed')
    } finally {
      setPackPdfBusy(false)
      setPackProgress({ current: 0, total: 0 })
    }
  }

  const exportVendorCsv = () => downloadCsv(`exhibition-vendors-${fileStamp()}.csv`, vendorsByValue.map((v) => ({ vendor: v.vendor_name, value: v.value })))
  const exportCategoryCsv = () => downloadCsv(`exhibition-categories-${fileStamp()}.csv`, byCategory.map((c) => ({ category: c.key, orders: c.orders, amount: c.amount })))
  const exportLocationCsv = () => downloadCsv(`exhibition-locations-${fileStamp()}.csv`, byLocation.map((l) => ({ location: l.key, orders: l.orders, amount: l.amount })))
  const filteredVendors = useMemo(() => {
    const term = vendorSearch.trim().toLowerCase()
    let list = vendorsByValue
    if (term) list = list.filter((v) => (v.vendor_name || '').toLowerCase().includes(term))
    return list
  }, [vendorsByValue, vendorSearch])
  const vendorPageCount = Math.max(1, Math.ceil(filteredVendors.length / vendorPageSize))
  const safeVendorPage = Math.min(Math.max(1, vendorPage), vendorPageCount)
  const pagedVendors = filteredVendors.slice((safeVendorPage - 1) * vendorPageSize, safeVendorPage * vendorPageSize)

  // ─── PDF builder helper ───
  const buildPdf = (title, rows, headers) => async () => {
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const sanitize = (s) => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')
    doc.setFontSize(14)
    doc.text(title, 12, 12)
    doc.setFontSize(9)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)
    autoTable(doc, {
      head: [headers],
      body: rows.map((r) => headers.map((h) => sanitize(String(r[h] ?? '')))),
      startY: 22,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [75, 85, 99] },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      margin: { left: 12, right: 12 },
    })
    doc.save(`${title.replace(/[^a-zA-Z0-9]/g, '_')}_${fileStamp()}.pdf`)
  }

  // ─── Applications by Branch export ───
  const exportApps = async (format) => {
    setAppBusy(true)
    try {
      const qs = new URLSearchParams()
      if (appBranchId) qs.set('branch_id', appBranchId)
      if (appStatus) qs.set('status', appStatus)
      if (appPayment) qs.set('payment', appPayment)
      if (appFrom) qs.set('from', appFrom)
      if (appTo) qs.set('to', appTo)
      qs.set('limit', '5000')
      const res = await fetch(`/api/admin/exhibition/orders?${qs}`, { cache: 'no-store' })
      const json = await safeJsonMemo(res, 'orders')
      if (!json.ok) throw new Error(json.error)
      const orders = json.orders || []
      const rows = []
      for (const o of orders) {
        for (const l of o.lines || []) {
          rows.push({ order: o.order_id, status: o.status, payment: o.payment_option, member: o.member_name_snapshot || o.member_id, branch: o.branches?.name || '', vendor: l.vendor_name || '', product: l.product_name || '', qty: l.qty, amount: l.amount })
        }
      }
      const headers = ['order', 'status', 'payment', 'member', 'branch', 'vendor', 'product', 'qty', 'amount']
      if (format === 'pdf') {
        await buildPdf('Exhibition · Applications by Branch', rows, headers)()
      } else {
        downloadCsv(`exhibition-apps-branch-${fileStamp()}.csv`, rows)
      }
    } catch (e) { alert(e.message || 'Export failed') }
    finally { setAppBusy(false) }
  }



  // ─── Delivery Pack download ───
  const downloadDeliveryPack = async () => {
    setDpBusy(true)
    try {
      const qs = new URLSearchParams()
      if (dpBranchId) qs.set('branch_id', dpBranchId)
      if (dpFrom) qs.set('from', dpFrom)
      if (dpTo) qs.set('to', dpTo)
      const res = await fetch(`/api/admin/exhibition/reports/delivery-pack?${qs}`, { cache: 'no-store' })
      const json = await safeJsonMemo(res, 'delivery-pack')
      if (!json.ok) throw new Error(json.error)
      downloadBase64(json)
    } catch (e) { alert(e.message || 'Download failed') }
    finally { setDpBusy(false) }
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition · Report</h1>
          <div className="flex gap-2">
            <select value={cycleId} onChange={(e) => setCycleId(e.target.value)} className={selectCls}>
              <option value="">All active cycles</option>
              {cycles.map((c) => <option key={c.id} value={c.id}>{c.name || `Cycle ${c.id}`} ({c.code})</option>)}
            </select>
            <Button onClick={load} disabled={loading} leftIcon={RefreshCw}>{loading ? 'Loading…' : 'Refresh'}</Button>
            <Button variant="accent" onClick={exportAllPdf} disabled={!s || reportBusy}>
              {reportBusy ? (
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Preparing…
                </span>
              ) : (
                <>
                  <FileBarChart2 className="h-4 w-4 mr-1" /> Download Report
                </>
              )}
            </Button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{err}</div>}

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : !s ? null : (
          <>
            {/* ─── Summary Cards ─── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-4">
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Vendors</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{s.vendors}</div>
                <div className="text-[10px] text-muted mt-0.5">Products: {s.products || 0}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Pending</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{byStatus.Pending || 0}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Approved</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{byStatus.Approved || 0}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Delivered</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{byStatus.Delivered || 0}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Loan Principal</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{money(s.loanPrincipal || 0)}</div>
                <div className="text-[10px] text-muted mt-0.5">Interest: {money(s.loanInterest || 0)} · Total: {money(s.loanTotal || 0)}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Savings</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{money(s.amounts?.savings || 0)}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Cash</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{money(s.amounts?.cash || 0)}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs text-muted">Total Amount</div>
                <div className="text-[13px] font-semibold sm:text-lg mt-1">{money(s.amount || 0)}</div>
              </div>
            </div>

            {/* ─── Breakdown Tables ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <SummaryTable title="By Status" rows={statusRows} columns={[{ key: 'key', label: 'Status', align: 'left' }, { key: 'orders', label: 'Orders', align: 'right' }]} />
              <SummaryTable title="By Payment" rows={paymentRows} columns={[{ key: 'key', label: 'Type', align: 'left' }, { key: 'orders', label: 'Orders', align: 'right' }, { key: 'amount', label: 'Amount', align: 'right', fmt: money }]} />
              <SummaryTable title="By Category" rows={byCategory} columns={[{ key: 'key', label: 'Category', align: 'left' }, { key: 'orders', label: 'Orders', align: 'right' }, { key: 'amount', label: 'Amount', align: 'right', fmt: money }]} />
              <SummaryTable title="By Delivery Location" rows={byLocation} pagination={{ page: locPage, pageSize: 3, onChange: setLocPage }} columns={[{ key: 'key', label: 'Location', align: 'left' }, { key: 'orders', label: 'Orders', align: 'right' }, { key: 'amount', label: 'Amount', align: 'right', fmt: money }]} />
            </div>

            {/* ─── Vendor Performance ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
              <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-fg">By Vendor</h3>
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Search vendor…" value={vendorSearch} onChange={(e) => { setVendorSearch(e.target.value); setVendorPage(1) }}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg w-40 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30" />
                  <Button size="sm" variant="secondary" onClick={exportVendorCsv}>Export CSV</Button>
                </div>
              </div>
              {filteredVendors.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No vendor data</p> : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-line bg-subtle/30 text-left font-semibold uppercase tracking-wide text-muted">
                        <th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">Vendor</th><th className="px-3 py-1.5 text-right">Order Value</th><th className="px-3 py-1.5 text-right">Share</th>
                      </tr></thead>
                      <tbody>{pagedVendors.map((v, i) => (
                        <tr key={v.vendor_id} className="border-b border-line/50 last:border-0 hover:bg-subtle/30">
                          <td className="px-3 py-1.5 text-muted">{(safeVendorPage - 1) * vendorPageSize + i + 1}</td>
                          <td className="px-3 py-1.5 font-medium text-fg">{v.vendor_name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(v.value)}</td>
                          <td className="px-3 py-1.5 text-right text-muted">{s.amount ? ((v.value / s.amount) * 100).toFixed(1) + '%' : '0%'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {vendorPageCount > 1 && (
                    <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
                      <span>{filteredVendors.length} vendors</span>
                      <div className="flex items-center gap-2">
                        <button type="button" className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50" onClick={() => setVendorPage((p) => Math.max(1, p - 1))} disabled={safeVendorPage <= 1}>Prev</button>
                        <span>{safeVendorPage} / {vendorPageCount}</span>
                        <button type="button" className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50" onClick={() => setVendorPage((p) => Math.min(vendorPageCount, p + 1))} disabled={safeVendorPage >= vendorPageCount}>Next</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ─── Applications by Branch (RAM-style export section) ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
              <div className="border-b border-line bg-subtle px-4 py-3">
                <div className="text-sm font-semibold text-fg">Applications by Branch</div>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  <select className={selectCls} value={appBranchId} onChange={(e) => setAppBranchId(e.target.value)}>
                    <option value="">All branches</option>
                    {branches.map((b) => <option key={b.branch_id || b.id} value={b.branch_id || b.id}>{b.name} ({b.code})</option>)}
                  </select>
                  <select className={selectCls} value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <select className={selectCls} value={appPayment} onChange={(e) => setAppPayment(e.target.value)}>
                    <option value="">All payments</option>
                    <option value="Cash">Cash</option>
                    <option value="Loan">Loan</option>
                    <option value="Savings">Savings</option>
                  </select>
                  <input type="date" className={selectCls} value={appFrom} onChange={(e) => setAppFrom(e.target.value)} />
                  <input type="date" className={selectCls} value={appTo} onChange={(e) => setAppTo(e.target.value)} />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="accent" size="sm" onClick={() => exportApps('csv')} disabled={appBusy}>
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> {appBusy ? 'Preparing…' : 'Excel'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => exportApps('pdf')} disabled={appBusy}>
                    <FileText className="h-4 w-4 mr-1" /> {appBusy ? 'Preparing…' : 'PDF'}
                  </Button>
                </div>
              </div>
            </div>

            {/* ─── Applications Pack by Payment to Vendors ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
              <div className="border-b border-line bg-subtle px-4 py-3">
                <div className="text-sm font-semibold text-fg">Applications Pack by Payment to Vendors</div>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  <select className={selectCls} value={packVendorId} onChange={(e) => setPackVendorId(e.target.value)}>
                    <option value="">All vendors</option>
                    {vendorsByValue.map((v) => (
                      <option key={v.vendor_id || v.vendor_name} value={String(v.vendor_id || '')}>{v.vendor_name}</option>
                    ))}
                  </select>
                  <select className={selectCls} value={packStatus} onChange={(e) => setPackStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <select className={selectCls} value={packPayment} onChange={(e) => setPackPayment(e.target.value)}>
                    <option value="">All payments</option>
                    <option value="Cash">Cash</option>
                    <option value="Loan">Loan</option>
                    <option value="Savings">Savings</option>
                  </select>
                  <input type="date" className={selectCls} value={packFrom} onChange={(e) => setPackFrom(e.target.value)} />
                  <input type="date" className={selectCls} value={packTo} onChange={(e) => setPackTo(e.target.value)} />
                </div>
                <div className="mt-3 flex gap-2">
                  <ExportButton format="excel" onClick={exportVendorPackExcel} disabled={packBusy} busy={packExcelBusy} busyText="Preparing…" />
                  <ExportButton format="pdf" onClick={exportVendorPackPdf} disabled={packBusy} busy={packPdfBusy} busyText="Preparing…" />
                </div>
              </div>
            </div>

            {/* ─── Delivery Pack (RAM-style download section) ─── */}
            <div className="rounded-xl border border-line bg-surface overflow-hidden mb-6">
              <div className="border-b border-line bg-subtle px-4 py-3">
                <div className="text-sm font-semibold text-fg">Delivery Pack (Master/Cash/Loan/Savings)</div>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  <select className={selectCls} value={dpBranchId} onChange={(e) => setDpBranchId(e.target.value)}>
                    <option value="">All branches</option>
                    {branches.map((b) => <option key={b.branch_id || b.id} value={b.branch_id || b.id}>{b.name} ({b.code})</option>)}
                  </select>
                  <input type="date" className={selectCls} value={dpFrom} onChange={(e) => setDpFrom(e.target.value)} />
                  <input type="date" className={selectCls} value={dpTo} onChange={(e) => setDpTo(e.target.value)} />
                </div>
                <div className="mt-3">
                  <Button onClick={downloadDeliveryPack} disabled={dpBusy}>
                    {dpBusy ? <><Spinner className="w-4 h-4 mr-1" /> Preparing…</> : 'Download Delivery Pack'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  )
}
