'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import RamOrderAuditModal from '../../../components/RamOrderAuditModal'
import ExportButton from '../../../components/ui/ExportButton'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../../lib/pdfExport'


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

function computePaymentVendor(o) {
  const pv = Number(o?.payment_vendor)
  if (Number.isFinite(pv)) return pv
  const principal = Number(o?.principal_amount || 0)
  const pct = Number.isFinite(Number(o?.vendor_deduction_rate_pct)) ? Number(o.vendor_deduction_rate_pct) : 6
  const fee = Math.round(principal * (Math.max(0, pct) / 100))
  return Math.max(0, principal - fee)
}

function RepRamDeliveredContent() {
  const [orders, setOrders] = useState([])
  const [term, setTerm] = useState('')
  const [deliveryLocationId, setDeliveryLocationId] = useState('')
  const [locationOptions, setLocationOptions] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [didLoadOnce, setDidLoadOnce] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [auditOrder, setAuditOrder] = useState(null)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const fetchCtl = useRef(null)
  const fetchSeq = useRef(0)
  const didInitRef = useRef(false)
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchOrders = async () => {
    const seq = ++fetchSeq.current
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const qs = new URLSearchParams({
        status: 'Delivered',
        limit: '1000',
        ...(term ? { term } : {}),
        ...(deliveryLocationId ? { delivery_location_id: deliveryLocationId } : {}),
      })
      const res = await fetch(`/api/rep/ram/orders/list?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/rep/ram/orders/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      const nextOrders = json.orders || []
      if (seq !== fetchSeq.current) return
      setOrders(nextOrders)
      setLocationOptions((prev) => {
        const byId = new Map((prev || []).map((l) => [Number(l.id), l]))
        for (const o of nextOrders || []) {
          const loc = o?.delivery_location
          const id = Number(loc?.id ?? o?.ram_delivery_location_id)
          if (!Number.isFinite(id) || id <= 0) continue
          const title = String(loc?.delivery_location || '').trim()
          const name = String(loc?.name || '').trim()
          const label = [title, name].filter(Boolean).join(' · ')
          if (!byId.has(id)) byId.set(id, { id, label: label || `Location ${id}` })
        }
        return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label))
      })
      setPage(1)
    } catch (e) {
      if (seq !== fetchSeq.current) return
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setOrders([])
    } finally {
      if (seq === fetchSeq.current) {
        setLoading(false)
        setDidLoadOnce(true)
      }
    }
  }

  useEffect(() => {
    fetchOrders()
    didInitRef.current = true
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
  }, [])

  useEffect(() => {
    if (!didInitRef.current) return
    fetchOrders()
  }, [deliveryLocationId])

  const selectedLocationLabel = useMemo(() => {
    const id = Number(deliveryLocationId)
    if (!Number.isFinite(id) || id <= 0) return ''
    return locationOptions.find((l) => Number(l.id) === id)?.label || ''
  }, [deliveryLocationId, locationOptions])

  const exportExcel = async () => {
    if (!orders.length) return
    setDownloadingExcel(true)
    setMsg(null)
    try {
      const rows = orders.map((o) => ({
        id: o.id,
        created_at: o.created_at,
        member_id: o.member_id,
        member_name: o.member?.full_name || '',
        member_phone: o.member?.phone || '',
        payment: o.payment_option || '',
        qty: o.qty,
        unit_price: o.unit_price,
        principal_amount: o.principal_amount,
        interest_amount: o.interest_amount,
        total_amount: o.total_amount,
        payment_vendor: computePaymentVendor(o),
        delivery_location: o.delivery_location?.delivery_location || '',
        vendor_name: o.delivery_location?.name || '',
        vendor_phone: o.delivery_location?.phone || '',
        status: o.status,
        signature: '',
      }))
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Delivered')

      ws.addRow(['Ram Sales · Delivered Orders (Rep)'])
      ws.addRow([`Delivery Location: ${selectedLocationLabel || 'All'} | Search: ${term || 'All'}`])

      const headers = Object.keys(rows[0] || { id: '' })
      ws.addRow(headers)
      for (const r of rows) ws.addRow(headers.map((h) => r[h]))

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rep_ram_delivered_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setDownloadingExcel(false)
    }
  }

  const exportPDF = async () => {
    if (!orders.length) return
    setDownloadingPdf(true)
    setMsg(null)
    try {
      const sanitize = sanitizePdfText
      const filters = [
        `Delivery: ${selectedLocationLabel || 'All'}`,
        `Search: ${term || 'All'}`,
      ].join('  |  ')
      const doc = await createManifestDoc({
        title: 'Ram Sales · Delivered Orders',
        meta: `Filters: ${sanitize(filters)}`,
      })

      const head = [
        [
          'OrderID',
          'CreatedAt',
          'MemberID',
          'MemberName',
          'MemberPhone',
          'Payment',
          'Qty',
          'Unit Price',
          'Principal',
          'Interest',
          'Total',
          'Pay Vendor',
          'Delivery',
          'Signature',
        ],
      ]

      const body = orders.map((o) => [
        String(o.id ?? ''),
        o.created_at ? new Date(o.created_at).toLocaleString() : '',
        sanitize(o.member_id),
        sanitize(o.member?.full_name || ''),
        sanitize(o.member?.phone || ''),
        sanitize(o.payment_option || ''),
        String(Number(o.qty || 0)),
        `NGN ${Number(o.unit_price || 0).toLocaleString()}`,
        `NGN ${Number(o.principal_amount || 0).toLocaleString()}`,
        `NGN ${Number(o.interest_amount || 0).toLocaleString()}`,
        `NGN ${Number(o.total_amount || 0).toLocaleString()}`,
        `NGN ${Number(computePaymentVendor(o) || 0).toLocaleString()}`,
        sanitize([o.delivery_location?.delivery_location || '', o.delivery_location?.name || '', o.delivery_location?.phone || ''].filter(Boolean).join('\n')),
        '',
      ])

      const totals = orders.reduce(
        (acc, o) => {
          acc.qty += Number(o.qty || 0)
          acc.principal += Number(o.principal_amount || 0)
          acc.interest += Number(o.interest_amount || 0)
          acc.payment_vendor += Number(computePaymentVendor(o) || 0)
          acc.total += Number(o.total_amount || 0)
          return acc
        },
        { qty: 0, principal: 0, interest: 0, payment_vendor: 0, total: 0 }
      )

      const totalsRowIndex = body.length
      body.push([
        'TOTAL',
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
        `NGN ${totals.payment_vendor.toLocaleString()}`,
        '',
        '',
      ])

      await addManifestTable(doc, {
        head,
        body,
        startY: 30,
        variant: 'ram',
        columnStyles: {
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right' },
          9: { halign: 'right' },
          10: { halign: 'right' },
          11: { halign: 'right' },
        },
        options: {
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index === totalsRowIndex) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [243, 244, 246]
            }
          },
        },
      })

      doc.save(`rep_ram_delivered_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Download failed' })
    } finally {
      setDownloadingPdf(false)
    }
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil((orders?.length || 0) / Math.max(1, pageSize))), [orders, pageSize])
  const safePage = Math.min(Math.max(1, page), pageCount)
  const startIndex = (safePage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const pageRows = useMemo(() => (orders || []).slice(startIndex, endIndex), [endIndex, orders, startIndex])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · Delivered</h1>
          <div className="text-xs sm:text-sm text-muted">Delivered ram orders for your delivery location(s).</div>
        </div>
      </div>

      {!!msg && (
        <div
          className={`mb-4 rounded-xl border p-3 text-sm ${
            msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="ui-card p-4 mb-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[420px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              placeholder="Search (Order ID / Member ID / Name)"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fetchOrders()
              }}
            />
            <button type="button" onClick={fetchOrders} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover">
              Search
            </button>
          </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={deliveryLocationId}
                onChange={(e) => setDeliveryLocationId(e.target.value)}
              >
                <option value="">All locations</option>
                {locationOptions.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.label}
                  </option>
                ))}
              </select>
              <ExportButton
                format="excel"
                onClick={exportExcel}
                disabled={!orders.length || downloadingExcel || downloadingPdf}
                busy={downloadingExcel}
                busyText="Preparing…"
              />
              <ExportButton
                format="pdf"
                onClick={exportPDF}
                disabled={!orders.length || downloadingExcel || downloadingPdf}
                busy={downloadingPdf}
                busyText="Preparing…"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="p-4 border-b border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">Delivered Orders</div>
            <button
              type="button"
              onClick={fetchOrders}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) || 50)}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              Prev
            </button>
            <div className="text-xs text-muted">
              Page {safePage} / {pageCount}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage >= pageCount}
            >
              Next
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle border-b border-line">
              <tr>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Order</th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Member</th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Delivery</th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Payment</th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Qty</th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Total</th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Action</th>
              </tr>
            </thead>
            <tbody>
              {!didLoadOnce || loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`sk_${i}`} className="border-b border-line last:border-b-0">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={`sk_${i}_${j}`} className="p-2">
                        <div className="h-4 w-full sakani-skeleton rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !pageRows.length ? (
                <tr>
                  <td className="p-3 text-muted" colSpan={7}>
                    No delivered orders.
                  </td>
                </tr>
              ) : (
                pageRows.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-b-0 hover:bg-subtle">
                    <td className="p-2 align-top">
                      <div className="font-medium">#{o.id}</div>
                      <div className="text-muted">{o.created_at ? new Date(o.created_at).toLocaleString() : ''}</div>
                    </td>
                    <td className="p-2 align-top">
                      <div className="font-medium">{o.member_id}</div>
                      <div className="text-muted">{o.member?.full_name || ''}</div>
                      <div className="text-muted">{o.member?.phone || ''}</div>
                    </td>
                    <td className="p-2 align-top whitespace-pre-line">
                      <div>{o.delivery_location?.delivery_location || ''}</div>
                      <div className="text-muted">{o.delivery_location?.name || ''}</div>
                      <div className="text-muted">{o.delivery_location?.phone || ''}</div>
                    </td>
                    <td className="p-2 align-top">{o.payment_option || ''}</td>
                    <td className="p-2 align-top text-right">{Number(o.qty || 0).toLocaleString()}</td>
                    <td className="p-2 align-top text-right">
                      <div className="font-medium">{money(o.total_amount)}</div>
                    </td>
                    <td className="p-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() => setAuditOrder(o)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
                      >
                        Activity
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order activity — audit trail: who did what and when */}
      <RamOrderAuditModal
        open={!!auditOrder}
        order={auditOrder}
        endpoint="/api/rep/ram/orders/audit"
        onClose={() => setAuditOrder(null)}
      />
    </div>
  )
}

export default function RepRamDeliveredPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepRamDeliveredContent />
    </ProtectedRoute>
  )
}
