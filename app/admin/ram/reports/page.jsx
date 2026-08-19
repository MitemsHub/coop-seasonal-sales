'use client'

import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import ExportButton from '../../../components/ui/ExportButton'
import { FileBarChart2 } from 'lucide-react'

function safeJsonFactory() {
  return async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }
}

function money(n) {
  return `₦${Number(n || 0).toLocaleString()}`
}

function exportTableCsv(filename, rows) {
  if (!rows?.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadBase64({ filename, type, data }) {
  const byteCharacters = atob(data)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], { type: type || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'download'
  a.click()
  URL.revokeObjectURL(url)
}

function fileStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function toApplicationExportRows(orders) {
  return (orders || []).map((o) => ({
    id: o.id,
    created_at: o.created_at,
    status: o.status,
    payment: o.payment_option,
    member_id: o.member_id,
    member_name: o.member?.full_name || '',
    member_phone: o.member?.phone || '',
    delivery_location: o.delivery_location?.delivery_location || '',
    vendor_name: o.delivery_location?.name || '',
    vendor_phone: o.delivery_location?.phone || '',
    qty: Number(o.qty || 0),
    unit_price: Number(o.unit_price || 0),
    principal_amount: Number(o.principal_amount || 0),
    interest_amount: Number(o.interest_amount || 0),
    total_amount: Number(o.total_amount || 0),
    signature: '',
  }))
}

function computePaymentVendor(o) {
  const pv = Number(o?.payment_vendor)
  if (Number.isFinite(pv)) return pv
  const principal = Number(o?.principal_amount || 0)
  const pct = Number.isFinite(Number(o?.vendor_deduction_rate_pct)) ? Number(o.vendor_deduction_rate_pct) : 6
  const fee = Math.round(principal * (Math.max(0, pct) / 100))
  return Math.max(0, principal - fee)
}

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

function toVendorPaymentExportRows(orders) {
  return (orders || []).map((o) => ({
    id: o.id,
    created_at: o.created_at,
    status: o.status,
    payment: o.payment_option,
    member_id: o.member_id,
    member_name: o.member?.full_name || '',
    member_phone: o.member?.phone || '',
    delivery_location: o.delivery_location?.delivery_location || '',
    vendor_name: o.delivery_location?.name || '',
    vendor_phone: o.delivery_location?.phone || '',
    qty: Number(o.qty || 0),
    unit_price: Number(o.unit_price || 0),
    principal_amount: Number(o.principal_amount || 0),
    payment_vendor: computePaymentVendor(o),
  }))
}

function SummaryTable({ title, rows, pagination, loading }) {
  const pageSize = Number(pagination?.pageSize || 0)
  const pageCount = pageSize ? Math.max(1, Math.ceil((rows?.length || 0) / pageSize)) : 1
  const safePage = pageSize ? Math.min(Math.max(1, Number(pagination?.page || 1)), pageCount) : 1
  const pagedRows = pageSize ? (rows || []).slice((safePage - 1) * pageSize, safePage * pageSize) : rows

  return (
    <div className="ui-card overflow-hidden">
      <div className="p-4 border-b border-line bg-subtle text-sm font-semibold flex items-center justify-between gap-2">
        <div className="text-fg">{title}</div>
        {pageSize ? (
          <div className="flex items-center gap-2 text-xs font-normal text-subtext">
            <button
              type="button"
              className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50"
              onClick={() => pagination?.onChange?.(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
            >
              Prev
            </button>
            <div>
              Page {safePage} / {pageCount}
            </div>
            <button
              type="button"
              className="px-2 py-1 rounded border border-line bg-surface hover:bg-subtle disabled:opacity-50"
              onClick={() => pagination?.onChange?.(Math.min(pageCount, safePage + 1))}
              disabled={safePage >= pageCount}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="bg-subtle border-b border-line">
            <tr>
              <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Key</th>
              <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Orders</th>
              <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Rams</th>
              <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Principal</th>
              <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Interest</th>
            </tr>
          </thead>
          <tbody>
            {!!loading && (
              <>
                {Array.from({ length: pageSize ? Math.min(3, pageSize) : 5 }).map((_, i) => (
                  <tr key={`sk-${title}-${i}`} className="border-b border-line last:border-b-0">
                    <td className="p-2" colSpan={5}>
                      <div className="h-4 sakani-skeleton rounded w-full" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!loading && !rows?.length && (
              <tr>
                <td className="p-3 text-muted" colSpan={5}>
                  No data.
                </td>
              </tr>
            )}
            {!loading &&
              (pagedRows || []).map((r) => (
                <tr key={r.key} className="border-b border-line last:border-b-0 hover:bg-subtle">
                  <td className="p-2">{r.key}</td>
                  <td className="p-2 text-right">{r.orders}</td>
                  <td className="p-2 text-right">{r.qty}</td>
                  <td className="p-2 text-right">{money(Math.max(0, Number(r.amount || 0) - Number(r.loan_interest || 0)))}</td>
                  <td className="p-2 text-right">{money(r.loan_interest)}</td>
              </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RamReportsContent() {
  const [summary, setSummary] = useState(null)
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [byLocationPage, setByLocationPage] = useState(1)
  const [appsLocationId, setAppsLocationId] = useState('')
  const [appsStatus, setAppsStatus] = useState('')
  const [appsPayment, setAppsPayment] = useState('')
  const [appsFrom, setAppsFrom] = useState('')
  const [appsTo, setAppsTo] = useState('')
  const [appsExcelBusy, setAppsExcelBusy] = useState(false)
  const [appsPdfBusy, setAppsPdfBusy] = useState(false)
  const appsBusy = appsExcelBusy || appsPdfBusy

  const [packStatus, setPackStatus] = useState('')
  const [packPayment, setPackPayment] = useState('')
  const [packLocationId, setPackLocationId] = useState('')
  const [packFrom, setPackFrom] = useState('')
  const [packTo, setPackTo] = useState('')
  const [packExcelBusy, setPackExcelBusy] = useState(false)
  const [packPdfBusy, setPackPdfBusy] = useState(false)
  const packBusy = packExcelBusy || packPdfBusy
  const [packProgress, setPackProgress] = useState({ current: 0, total: 0 })

  const [deliveryPackLocationId, setDeliveryPackLocationId] = useState('')
  const [deliveryPackFrom, setDeliveryPackFrom] = useState('')
  const [deliveryPackTo, setDeliveryPackTo] = useState('')
  const [deliveryPackBusy, setDeliveryPackBusy] = useState(false)

  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchLocations = async () => {
    try {
      const res = await fetch('/api/admin/ram/delivery-locations', { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load locations')
      setDeliveryLocations(json.locations || [])
    } catch {
      setDeliveryLocations([])
    }
  }

  const fetchSummary = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/summary', { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/summary')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setSummary(json)
    } catch (e) {
      setSummary(null)
      setMsg({ type: 'error', text: e?.message || 'Failed to load' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLocations()
    fetchSummary()
  }, [])

  const totals = summary?.totals || { orders: 0, qty: 0, amount: 0, loan_interest: 0 }
  const byStatus = summary?.byStatus || []
  const byPayment = summary?.byPayment || []
  const byCategory = summary?.byCategory || []
  const byLocation = summary?.byLocation || []
  const cashAgg = byPayment.find((r) => String(r?.key || '') === 'Cash') || { orders: 0, qty: 0, amount: 0, loan_interest: 0 }
  const savingsAgg = byPayment.find((r) => String(r?.key || '') === 'Savings') || { orders: 0, qty: 0, amount: 0, loan_interest: 0 }
  const loanAgg = byPayment.find((r) => String(r?.key || '') === 'Loan') || { orders: 0, qty: 0, amount: 0, loan_interest: 0 }
  const cashPrincipalAmount = Math.max(0, Number(cashAgg.amount || 0) - Number(cashAgg.loan_interest || 0))
  const savingsPrincipalAmount = Math.max(0, Number(savingsAgg.amount || 0) - Number(savingsAgg.loan_interest || 0))
  const loanPrincipalAmount = Math.max(0, Number(loanAgg.amount || 0) - Number(loanAgg.loan_interest || 0))
  const totalPrincipalAmount = Math.max(0, Number(totals.amount || 0) - Number(totals.loan_interest || 0))
  const locations = useMemo(
    () =>
      (deliveryLocations || [])
        .filter((l) => l.is_active !== false)
        .slice()
        .sort((a, b) => String(a.delivery_location || '').localeCompare(String(b.delivery_location || ''))),
    [deliveryLocations]
  )

  const refreshAll = () => {
    fetchLocations()
    fetchSummary()
  }

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil((byLocation?.length || 0) / 3))
    setByLocationPage((p) => Math.min(Math.max(1, p), pageCount))
  }, [byLocation])

  const downloadReport = async () => {
    if (!summary) return
    setReportBusy(true)
    setMsg(null)
    try {
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const sanitize = (s) => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')
      const asInt = (v) => Number(v || 0)
      const asMoney = (v) => `NGN ${asInt(v).toLocaleString()}`
      const asPrincipal = (r) => Math.max(0, asInt(r?.amount) - asInt(r?.loan_interest))
      const pageWidth = doc.internal.pageSize.getWidth()
      const marginX = 12

      doc.setFontSize(14)
      doc.text('Ram Sales · Report', 12, 12)
      doc.setFontSize(9)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)

      const metricColW = { metric: 52, value: 36, note: 60 }
      const metricTableW = metricColW.metric + metricColW.value + metricColW.note

      autoTable(doc, {
        head: [['Metric', 'Value', 'Note']],
        body: [
          ['Total Orders', String(totals.orders ?? 0), ''],
          ['Total Rams', String(totals.qty ?? 0), ''],
          ['Cash', asMoney(cashPrincipalAmount), `${Number(cashAgg.orders || 0)} order(s)`],
          ['Savings', asMoney(savingsPrincipalAmount), `${Number(savingsAgg.orders || 0)} order(s)`],
          ['Loan', asMoney(loanPrincipalAmount), `${Number(loanAgg.orders || 0)} order(s)`],
          ['Loan Interest', asMoney(totals.loan_interest), ''],
          ['Total', asMoney(totals.amount), ''],
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
          2: { cellWidth: metricColW.note, overflow: 'linebreak' },
        },
        didParseCell: (data) => {
          if (data.section !== 'head' && data.section !== 'body') return
          if (data.column.index === 0) data.cell.styles.halign = 'left'
          if (data.column.index === 1) data.cell.styles.halign = 'right'
          if (data.column.index === 2) data.cell.styles.halign = 'left'
        },
        margin: { left: marginX, right: Math.max(marginX, pageWidth - metricTableW - marginX) },
      })

      const addSummarySection = (title, rows) => {
        const body = (rows || []).map((r) => [
          sanitize(r.key),
          String(r.orders ?? 0),
          String(r.qty ?? 0),
          sanitize(asMoney(asPrincipal(r))),
          sanitize(asMoney(r.loan_interest)),
        ])

        const summaryColW = { key: 50, orders: 22, rams: 22, principal: 52, interest: 42 }
        const summaryTableW = summaryColW.key + summaryColW.orders + summaryColW.rams + summaryColW.principal + summaryColW.interest

        let startY = (doc.lastAutoTable?.finalY || 22) + 10
        if (startY > 180) {
          doc.addPage()
          startY = 22
        }
        doc.setFontSize(12)
        doc.text(title, 12, startY - 2)
        autoTable(doc, {
          head: [['Key', 'Orders', 'Rams', 'Principal', 'Interest']],
          body,
          startY,
          rowPageBreak: 'avoid',
          tableWidth: summaryTableW,
          styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          columnStyles: {
            0: { cellWidth: summaryColW.key },
            1: { cellWidth: summaryColW.orders },
            2: { cellWidth: summaryColW.rams },
            3: { cellWidth: summaryColW.principal },
            4: { cellWidth: summaryColW.interest },
          },
          didParseCell: (data) => {
            if (data.section !== 'head' && data.section !== 'body') return
            if (data.column.index === 0) data.cell.styles.halign = 'left'
            if (data.column.index > 0) data.cell.styles.halign = 'right'
          },
          margin: { left: marginX, right: Math.max(marginX, pageWidth - summaryTableW - marginX) },
        })
      }

      addSummarySection('By Status', byStatus)
      addSummarySection('By Payment', byPayment)
      addSummarySection('By Category', byCategory)
      addSummarySection('By Delivery Location', byLocation)

      doc.save(`ram_report_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setReportBusy(false)
    }
  }

  const fetchApplications = async (opts) => {
    const pageSize = 1000
    const hardLimit = Number(opts?.limit || 0)
    let page = 1
    let totalCount = 0
    const all = []

    while (true) {
      const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (opts?.status) qs.set('status', opts.status)
      if (opts?.payment) qs.set('payment', opts.payment)
      if (opts?.delivery_location_id) qs.set('delivery_location_id', String(opts.delivery_location_id))
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)

      let res = null
      let attempt = 0
      while (true) {
        res = await fetch(`/api/admin/ram/orders/list?${qs.toString()}`, { cache: 'no-store' })
        if (res.status !== 429) break
        attempt += 1
        if (attempt > 5) break
        await new Promise((r) => setTimeout(r, 400 * attempt))
      }

      const json = await safeJson(res, '/api/admin/ram/orders/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load applications')
      const chunk = json.orders || []
      const nextTotal = Number(json?.meta?.total_count ?? 0)
      if (Number.isFinite(nextTotal) && nextTotal > 0) totalCount = nextTotal
      all.push(...chunk)
      if (!chunk.length) break
      if (hardLimit > 0 && all.length >= hardLimit) break
      if (totalCount > 0 && all.length >= totalCount) break
      page += 1
      if (page > 200) break
    }

    return hardLimit > 0 ? all.slice(0, hardLimit) : all
  }

  const fetchVendorBankMetaByLocationId = async () => {
    const res = await fetch('/api/admin/ram/vendor-banks/locations?active=0', { cache: 'no-store' })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok && res.status === 404) return new Map()
    if (!ct.includes('application/json')) {
      if (res.status === 404) return new Map()
      const text = await res.text()
      throw new Error(`Non-JSON response from /api/admin/ram/vendor-banks/locations (${res.status}): ${text.slice(0, 300)}`)
    }
    const json = await res.json()
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load bank details')
    const map = new Map()
    for (const l of json.locations || []) {
      if (l?.id == null) continue
      map.set(String(l.id), l)
    }
    return map
  }

  const fetchVendorInvoices = async (deliveryLocationId) => {
    const qs = new URLSearchParams({ delivery_location_id: String(deliveryLocationId) })
    const res = await fetch(`/api/admin/ram/vendor-banks/invoices/list?${qs.toString()}`, { cache: 'no-store' })
    const json = await safeJson(res, '/api/admin/ram/vendor-banks/invoices/list')
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load invoices')
    return json.invoices || []
  }

  const resolveInvoiceLink = async (deliveryLocationId, cycleId, fallbackUrl) => {
    try {
      const invoices = await fetchVendorInvoices(deliveryLocationId)
      const filtered = cycleId ? invoices.filter((inv) => String(inv?.ram_cycle_id ?? '') === String(cycleId)) : invoices
      const firstWithUrl = (filtered.find((inv) => !!inv?.url) || invoices.find((inv) => !!inv?.url)) ?? null
      return firstWithUrl?.url || fallbackUrl || null
    } catch {
      return fallbackUrl || null
    }
  }

  const formatDateTime = (v) => {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return String(v)
    return d.toLocaleString()
  }

  const exportApplicationsExcel = async () => {
    setAppsExcelBusy(true)
    setMsg(null)
    try {
      const orders = await fetchApplications({
        delivery_location_id: appsLocationId || undefined,
        status: appsStatus,
        payment: appsPayment,
        from: appsFrom,
        to: appsTo,
        limit: 10000,
      })
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Applications')
      const locLabel = appsLocationId ? (locations.find((l) => String(l.id) === String(appsLocationId))?.delivery_location || String(appsLocationId)) : 'All delivery locations'
      ws.addRow(['Ram Sales · Applications'])
      ws.addRow([`Location: ${locLabel} | Status: ${appsStatus || 'All'} | Payment: ${appsPayment || 'All'} | From: ${appsFrom || 'Any'} | To: ${appsTo || 'Any'}`])
      const rows = toApplicationExportRows(orders)
      ws.addRow(Object.keys(rows[0] || { id: '' }))
      for (const r of rows) {
        ws.addRow(Object.keys(rows[0] || { id: '' }).map((k) => r[k]))
      }
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const slug = appsLocationId ? `location_${appsLocationId}` : 'all_locations'
      a.download = `ram_applications_${slug}_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setAppsExcelBusy(false)
    }
  }

  const exportApplicationsPdf = async () => {
    setAppsPdfBusy(true)
    setMsg(null)
    try {
      const orders = await fetchApplications({
        delivery_location_id: appsLocationId || undefined,
        status: appsStatus,
        payment: appsPayment,
        from: appsFrom,
        to: appsTo,
        limit: 10000,
      })
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

      const sanitize = (s) => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')
      const locLabel = appsLocationId ? (locations.find((l) => String(l.id) === String(appsLocationId))?.delivery_location || String(appsLocationId)) : 'All delivery locations'
      const filters = [
        `Location: ${locLabel}`,
        `Status: ${appsStatus || 'All'}`,
        `Payment: ${appsPayment || 'All'}`,
        `From: ${appsFrom || 'Any'}`,
        `To: ${appsTo || 'Any'}`,
      ].join('  |  ')

      doc.setFontSize(14)
      doc.text('Ram Sales · Applications', 12, 12)
      doc.setFontSize(9)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)
      doc.text(`Filters: ${sanitize(filters)}`, 12, 24)

      const head = [
        [
          'OrderID',
          'CreatedAt',
          'Status',
          'Payment',
          'MemberID',
          'MemberName',
          'MemberPhone',
          'DeliveryLocation',
          'VendorName',
          'VendorPhone',
          'Qty',
          'Unit Price',
          'Principal',
          'Interest',
          'Total',
          'Signature',
        ],
      ]

      const body = (orders || []).map((o) => [
        String(o.id ?? ''),
        o.created_at ? new Date(o.created_at).toLocaleString() : '',
        sanitize(o.status || ''),
        sanitize(o.payment_option || ''),
        sanitize(o.member_id),
        sanitize(o.member?.full_name || ''),
        sanitize(o.member?.phone || ''),
        sanitize(o.delivery_location?.delivery_location || o.delivery_location?.name || ''),
        sanitize(o.delivery_location?.name || ''),
        sanitize(o.delivery_location?.phone || ''),
        String(Number(o.qty || 0)),
        `NGN ${Number(o.unit_price || 0).toLocaleString()}`,
        `NGN ${Number(o.principal_amount || 0).toLocaleString()}`,
        `NGN ${Number(o.interest_amount || 0).toLocaleString()}`,
        `NGN ${Number(o.total_amount || 0).toLocaleString()}`,
        '',
      ])

      const totals = (orders || []).reduce(
        (acc, o) => {
          acc.qty += Number(o.qty || 0)
          acc.principal += Number(o.principal_amount || 0)
          acc.interest += Number(o.interest_amount || 0)
          acc.total += Number(o.total_amount || 0)
          return acc
        },
        { qty: 0, principal: 0, interest: 0, total: 0 }
      )

      const totalsRowIndex = body.length
      body.push([
        'TOTAL',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        String(totals.qty.toLocaleString()),
        '',
        `NGN ${totals.principal.toLocaleString()}`,
        `NGN ${totals.interest.toLocaleString()}`,
        `NGN ${totals.total.toLocaleString()}`,
        '',
      ])

      autoTable(doc, {
        head,
        body,
        startY: 30,
        rowPageBreak: 'avoid',
        styles: { fontSize: 7 },
        headStyles: { fillColor: [75, 85, 99] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          10: { halign: 'right' },
          11: { halign: 'right' },
          12: { halign: 'right' },
          13: { halign: 'right' },
          14: { halign: 'right' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === totalsRowIndex) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fillColor = [243, 244, 246]
          }
        },
        margin: { left: 12, right: 12 },
      })

      const slug = appsLocationId ? `location_${appsLocationId}` : 'all_locations'
      doc.save(`ram_applications_${slug}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setAppsPdfBusy(false)
    }
  }

  const exportVendorPaymentsPackExcel = async () => {
    if (!locations.length) return
    setPackExcelBusy(true)
    const selectedLocations = packLocationId ? locations.filter((l) => String(l.id) === String(packLocationId)) : locations
    setPackProgress({ current: 0, total: selectedLocations.length })
    setMsg(null)
    try {
      const bankMetaById = await fetchVendorBankMetaByLocationId()
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const safeName = (name) => String(name || 'Sheet').replace(/[\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet'

      const ordersByLocationId = new Map()
      if (!packLocationId) {
        const allOrders = await fetchApplications({
          status: packStatus,
          payment: packPayment,
          from: packFrom,
          to: packTo,
        })
        for (const o of allOrders || []) {
          const id = String(o?.delivery_location?.id ?? o?.ram_delivery_location_id ?? '')
          if (!id) continue
          const arr = ordersByLocationId.get(id) || []
          arr.push(o)
          ordersByLocationId.set(id, arr)
        }
      }

      let i = 0
      for (const loc of selectedLocations) {
        i += 1
        setPackProgress({ current: i, total: selectedLocations.length })
        const meta = bankMetaById.get(String(loc.id)) || null
        const cycleForInvoices = meta?.paid?.ram_cycle_id ?? meta?.active_ram_cycle_id ?? null
        const invoicesUrl = `${window.location.origin}/admin/ram/banks?open=invoices&delivery_location_id=${encodeURIComponent(String(loc.id))}&active=0${
          cycleForInvoices != null ? `&cycle_id=${encodeURIComponent(String(cycleForInvoices))}` : ''
        }`
        const orders = packLocationId ? await fetchApplications({
          delivery_location_id: loc.id,
          status: packStatus,
          payment: packPayment,
          from: packFrom,
          to: packTo,
        }) : (ordersByLocationId.get(String(loc.id)) || [])
        const invoiceLink = await resolveInvoiceLink(loc.id, meta?.paid?.ram_cycle_id ?? null, invoicesUrl)
        const ws = wb.addWorksheet(safeName(loc.delivery_location || loc.name || `Location ${loc.id}`))
        ws.addRow(['Ram Sales · Payment to Vendors'])
        ws.addRow([`Location: ${loc.delivery_location || loc.name || `Location ${loc.id}`}`])
        ws.addRow([`Filters: Status ${packStatus || 'All'} | Payment ${packPayment || 'All'} | From ${packFrom || 'Any'} | To ${packTo || 'Any'}`])
        ws.addRow([])
        ws.addRow(['Bank Details'])
        ws.addRow(['Bank Name', meta?.bank?.bank_name || ''])
        ws.addRow(['Account Name', meta?.bank?.account_name || ''])
        ws.addRow(['Account Number', meta?.bank?.account_number || ''])
        ws.addRow(['Paid', meta?.paid?.is_paid ? 'Yes' : 'No'])
        ws.addRow(['Paid At', meta?.paid?.paid_at ? formatDateTime(meta.paid.paid_at) : ''])
        ws.addRow([])
        const rows = toVendorPaymentExportRows(orders)
        const headers = Object.keys(rows[0] || { id: '' })
        ws.addRow(headers)
        for (const r of rows) {
          ws.addRow(headers.map((h) => r[h]))
        }
        ws.addRow([])
        ws.addRow(['Invoices'])
        const linkRow = ws.addRow(['To view invoice, click:', 'VIEW INVOICE'])
        const linkCell = linkRow.getCell(2)
        linkCell.value = { text: 'VIEW INVOICE', hyperlink: invoiceLink }
        linkCell.font = { color: { argb: 'FF2563EB' }, underline: true }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const slug = packLocationId ? `location_${packLocationId}` : 'all_locations'
      a.download = `ram_payment_to_vendors_${slug}_${fileStamp()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setPackExcelBusy(false)
      setPackProgress({ current: 0, total: 0 })
    }
  }

  const exportVendorPaymentsPackPdf = async () => {
    if (!locations.length) return
    setPackPdfBusy(true)
    const selectedLocations = packLocationId ? locations.filter((l) => String(l.id) === String(packLocationId)) : locations
    setPackProgress({ current: 0, total: selectedLocations.length })
    setMsg(null)
    try {
      const bankMetaById = await fetchVendorBankMetaByLocationId()
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const sanitize = (s) => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')

      doc.setFontSize(14)
      doc.text('Ram Sales · Payment to Vendors', 12, 12)
      doc.setFontSize(9)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)
      doc.text(
        `Filters: Status ${sanitize(packStatus || 'All')}  |  Payment ${sanitize(packPayment || 'All')}  |  From ${sanitize(packFrom || 'Any')}  |  To ${sanitize(packTo || 'Any')}`,
        12,
        24
      )

      const ordersByLocationId = new Map()
      if (!packLocationId) {
        const allOrders = await fetchApplications({
          status: packStatus,
          payment: packPayment,
          from: packFrom,
          to: packTo,
        })
        for (const o of allOrders || []) {
          const id = String(o?.delivery_location?.id ?? o?.ram_delivery_location_id ?? '')
          if (!id) continue
          const arr = ordersByLocationId.get(id) || []
          arr.push(o)
          ordersByLocationId.set(id, arr)
        }
      }

      let i = 0
      for (const loc of selectedLocations) {
        i += 1
        setPackProgress({ current: i, total: selectedLocations.length })
        const meta = bankMetaById.get(String(loc.id)) || null
        const cycleForInvoices = meta?.paid?.ram_cycle_id ?? meta?.active_ram_cycle_id ?? null
        const invoicesUrl = `${window.location.origin}/admin/ram/banks?open=invoices&delivery_location_id=${encodeURIComponent(String(loc.id))}&active=0${
          cycleForInvoices != null ? `&cycle_id=${encodeURIComponent(String(cycleForInvoices))}` : ''
        }`
        const orders = packLocationId ? await fetchApplications({
          delivery_location_id: loc.id,
          status: packStatus,
          payment: packPayment,
          from: packFrom,
          to: packTo,
        }) : (ordersByLocationId.get(String(loc.id)) || [])
        const invoiceLink = await resolveInvoiceLink(loc.id, meta?.paid?.ram_cycle_id ?? null, invoicesUrl)
        const rows = toVendorPaymentExportRows(orders)
        const locTitle = sanitize(loc.delivery_location || loc.name || `Location ${loc.id}`)
        let y = (doc.lastAutoTable?.finalY || 0) ? (doc.lastAutoTable.finalY + 8) : 32
        if (y > 180) {
          doc.addPage()
          y = 32
        }
        doc.setFontSize(11)
        doc.text(`Location: ${locTitle}`, 12, y)

        autoTable(doc, {
          head: [['Bank Detail', 'Value']],
          body: [
            ['Bank Name', meta?.bank?.bank_name || ''],
            ['Account Name', meta?.bank?.account_name || ''],
            ['Account Number', meta?.bank?.account_number || ''],
            ['Paid', meta?.paid?.is_paid ? 'Yes' : 'No'],
            ['Paid At', meta?.paid?.paid_at ? formatDateTime(meta.paid.paid_at) : ''],
          ].map((r) => r.map(sanitize)),
          startY: y + 4,
          rowPageBreak: 'avoid',
          styles: { fontSize: 8 },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { left: 12, right: 12 },
        })

        const head = [[
          'id',
          'created_at',
          'status',
          'payment',
          'member_id',
          'member_name',
          'member_phone',
          'delivery_location',
          'vendor_name',
          'vendor_phone',
          'qty',
          'unit_price',
          'principal_amount',
          'payment_vendor',
        ]]

        const body = rows.map((r) => [
          String(r.id ?? ''),
          r.created_at ? new Date(r.created_at).toLocaleString() : '',
          sanitize(r.status || ''),
          sanitize(r.payment || ''),
          sanitize(r.member_id || ''),
          sanitize(r.member_name || ''),
          sanitize(r.member_phone || ''),
          sanitize(r.delivery_location || ''),
          sanitize(r.vendor_name || ''),
          sanitize(r.vendor_phone || ''),
          String(Number(r.qty || 0)),
          `NGN ${Number(r.unit_price || 0).toLocaleString()}`,
          `NGN ${Number(r.principal_amount || 0).toLocaleString()}`,
          `NGN ${Number(r.payment_vendor || 0).toLocaleString()}`,
        ])

        const totals = rows.reduce(
          (acc, r) => {
            acc.qty += Number(r.qty || 0)
            acc.principal += Number(r.principal_amount || 0)
            acc.pay += Number(r.payment_vendor || 0)
            return acc
          },
          { qty: 0, principal: 0, pay: 0 }
        )
        const totalsRowIndex = body.length
        body.push([
          'TOTAL',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          String(totals.qty.toLocaleString()),
          '',
          `NGN ${totals.principal.toLocaleString()}`,
          `NGN ${totals.pay.toLocaleString()}`,
        ])

        autoTable(doc, {
          head,
          body,
          startY: (doc.lastAutoTable?.finalY || y + 4) + 6,
          rowPageBreak: 'avoid',
          styles: { fontSize: 7 },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          columnStyles: { 10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' }, 13: { halign: 'right' } },
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index === totalsRowIndex) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [243, 244, 246]
            }
          },
          margin: { left: 12, right: 12 },
        })

        let invY = (doc.lastAutoTable?.finalY || 0) + 8
        if (invY > 195) {
          doc.addPage()
          invY = 32
        }
        doc.setFontSize(9)
        doc.text('Invoices:', 12, invY)
        doc.setTextColor(37, 99, 235)
        doc.textWithLink('CLICK HERE TO VIEW INVOICE', 30, invY, { url: invoiceLink })
        doc.setTextColor(0, 0, 0)
      }

      const slug = packLocationId ? `location_${packLocationId}` : 'all_locations'
      doc.save(`ram_payment_to_vendors_${slug}_${fileStamp()}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setPackPdfBusy(false)
      setPackProgress({ current: 0, total: 0 })
    }
  }

  const downloadDeliveryPack = async () => {
    setDeliveryPackBusy(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams()
      if (deliveryPackLocationId) qs.set('delivery_location_id', deliveryPackLocationId)
      if (deliveryPackFrom) qs.set('from', deliveryPackFrom)
      if (deliveryPackTo) qs.set('to', deliveryPackTo)

      const res = await fetch(`/api/admin/ram/reports/delivery-pack?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/reports/delivery-pack')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Download failed')
      downloadBase64(json)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setDeliveryPackBusy(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · Report</h1>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={refreshAll}
            disabled={loading}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="w-4 h-4" />
                Refreshing…
              </span>
            ) : (
              'Refresh'
            )}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
            onClick={downloadReport}
            disabled={!summary || reportBusy}
          >
            {reportBusy ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="w-4 h-4" />
                Preparing…
              </span>
            ) : (
              <>
                <FileBarChart2 className="h-4 w-4" />
                Download Report
              </>
            )}
          </button>
        </div>
      </div>

      {!!msg && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3 mb-4">
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Total Orders</div>
          {loading ? <div className="mt-2 h-6 w-20 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{totals.orders}</div>}
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Total Rams</div>
          {loading ? <div className="mt-2 h-6 w-20 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{totals.qty}</div>}
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Cash</div>
          {loading ? <div className="mt-2 h-6 w-28 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{money(cashPrincipalAmount)}</div>}
          {loading ? <div className="mt-2 h-3 w-24 sakani-skeleton rounded animate-pulse" /> : <div className="text-xs text-muted mt-1">{`${Number(cashAgg.orders || 0)} order(s)`}</div>}
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Savings</div>
          {loading ? <div className="mt-2 h-6 w-28 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{money(savingsPrincipalAmount)}</div>}
          {loading ? <div className="mt-2 h-3 w-24 sakani-skeleton rounded animate-pulse" /> : <div className="text-xs text-muted mt-1">{`${Number(savingsAgg.orders || 0)} order(s)`}</div>}
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Loan</div>
          {loading ? <div className="mt-2 h-6 w-28 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{money(loanPrincipalAmount)}</div>}
          {loading ? <div className="mt-2 h-3 w-24 sakani-skeleton rounded animate-pulse" /> : <div className="text-xs text-muted mt-1">{`${Number(loanAgg.orders || 0)} order(s)`}</div>}
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Loan Interest</div>
          {loading ? <div className="mt-2 h-6 w-28 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{money(totals.loan_interest)}</div>}
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-muted">Total</div>
          {loading ? <div className="mt-2 h-6 w-28 sakani-skeleton rounded animate-pulse" /> : <div className="text-[13px] font-semibold sm:text-lg">{money(totals.amount)}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SummaryTable title="By Status" rows={byStatus} loading={loading} />
        <SummaryTable title="By Payment" rows={byPayment} loading={loading} />
        <SummaryTable title="By Category" rows={byCategory} loading={loading} />
        <SummaryTable
          title="By Delivery Location"
          rows={byLocation}
          pagination={{ page: byLocationPage, pageSize: 3, onChange: setByLocationPage }}
          loading={loading}
        />
      </div>

      <div className="mt-6 ui-card overflow-hidden">
        <div className="p-4 border-b border-line bg-subtle">
          <div className="text-sm font-semibold text-fg">Applications by Delivery Location</div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={appsLocationId}
              onChange={(e) => setAppsLocationId(e.target.value)}
            >
            <option value="">All delivery locations</option>
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.delivery_location || l.name}
              </option>
            ))}
            </select>

            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={appsStatus}
              onChange={(e) => setAppsStatus(e.target.value)}
            >
            <option value="">All statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Cancelled">Cancelled</option>
            </select>

            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={appsPayment}
              onChange={(e) => setAppsPayment(e.target.value)}
            >
            <option value="">All payments</option>
            <option value="Cash">Cash</option>
            <option value="Loan">Loan</option>
            <option value="Savings">Savings</option>
            </select>

            <input
              type="date"
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={appsFrom}
              onChange={(e) => setAppsFrom(e.target.value)}
            />
            <input
              type="date"
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={appsTo}
              onChange={(e) => setAppsTo(e.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <ExportButton
              format="excel"
              onClick={exportApplicationsExcel}
              disabled={appsBusy}
              busy={appsExcelBusy}
              busyText="Preparing…"
            />
            <ExportButton
              format="pdf"
              onClick={exportApplicationsPdf}
              disabled={appsBusy}
              busy={appsPdfBusy}
              busyText="Preparing…"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 ui-card overflow-hidden">
        <div className="p-4 border-b border-line bg-subtle">
          <div className="text-sm font-semibold text-fg">Applications Pack by Payment to Vendors</div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={packLocationId}
              onChange={(e) => setPackLocationId(e.target.value)}
            >
            <option value="">All delivery locations</option>
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.delivery_location || l.name}
              </option>
            ))}
            </select>
            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={packStatus}
              onChange={(e) => setPackStatus(e.target.value)}
            >
            <option value="">All statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Cancelled">Cancelled</option>
            </select>
            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={packPayment}
              onChange={(e) => setPackPayment(e.target.value)}
            >
            <option value="">All payments</option>
            <option value="Cash">Cash</option>
            <option value="Loan">Loan</option>
            <option value="Savings">Savings</option>
            </select>
            <input
              type="date"
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={packFrom}
              onChange={(e) => setPackFrom(e.target.value)}
            />
            <input
              type="date"
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={packTo}
              onChange={(e) => setPackTo(e.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <ExportButton
              format="excel"
              onClick={exportVendorPaymentsPackExcel}
              disabled={packBusy || !locations.length}
              busy={packExcelBusy}
              busyText="Preparing…"
            />
            <ExportButton
              format="pdf"
              onClick={exportVendorPaymentsPackPdf}
              disabled={packBusy || !locations.length}
              busy={packPdfBusy}
              busyText="Preparing…"
            />
            {packBusy && packProgress?.total ? (
              <div className="text-xs sm:text-sm text-muted">
                {packProgress.current}/{packProgress.total}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 ui-card overflow-hidden">
        <div className="p-4 border-b border-line bg-subtle">
          <div className="text-sm font-semibold text-fg">Delivery Pack (Master/Cash/Loan/Savings)</div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <select
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={deliveryPackLocationId}
              onChange={(e) => setDeliveryPackLocationId(e.target.value)}
            >
            <option value="">All delivery locations</option>
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.delivery_location || l.name}
              </option>
            ))}
            </select>
            <input
              type="date"
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={deliveryPackFrom}
              onChange={(e) => setDeliveryPackFrom(e.target.value)}
            />
            <input
              type="date"
              className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={deliveryPackTo}
              onChange={(e) => setDeliveryPackTo(e.target.value)}
            />
          </div>
          <div className="mt-3">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
              onClick={downloadDeliveryPack}
              disabled={deliveryPackBusy}
            >
              {deliveryPackBusy ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="w-4 h-4" />
                  Preparing…
                </span>
              ) : (
                'Download Delivery Pack'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RamReportsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamReportsContent />
    </ProtectedRoute>
  )
}
