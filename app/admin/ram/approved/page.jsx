'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { AnimatePresence, motion } from 'framer-motion'
import DraggableModal from '../../../components/DraggableModal'
import RamOrderAuditModal from '../../../components/RamOrderAuditModal'
import ExportButton from '../../../components/ui/ExportButton'
import { CheckSquare, ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw, Search, Truck } from 'lucide-react'

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

const toastMotion = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function RamApprovedContent() {
  const [orders, setOrders] = useState([])
  const [term, setTerm] = useState('')
  const [deliveryLocationId, setDeliveryLocationId] = useState('')
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [didLoadOnce, setDidLoadOnce] = useState(false)
  const [rollbackBusyId, setRollbackBusyId] = useState(null)
  const [receiptBusyId, setReceiptBusyId] = useState(null)
  const [delivering, setDelivering] = useState(false)
  const [deliverBusyIds, setDeliverBusyIds] = useState(() => new Set())
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [deliverConfirmOpen, setDeliverConfirmOpen] = useState(false)
  const [deliverConfirmIds, setDeliverConfirmIds] = useState([])
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [rollbackConfirmOrder, setRollbackConfirmOrder] = useState(null)
  const [rollbackBulkConfirmOpen, setRollbackBulkConfirmOpen] = useState(false)
  const [rollbackBulkBusy, setRollbackBulkBusy] = useState(false)
  const [auditOrder, setAuditOrder] = useState(null)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const fetchCtl = useRef(null)
  const fetchSeq = useRef(0)
  const didInitRef = useRef(false)
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchOrders = async (opts = {}) => {
    const seq = ++fetchSeq.current
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const nextPage = Number(opts.page || page || 1)
      const nextPageSize = Number(opts.pageSize || pageSize || 50)
      const nextTerm = typeof opts.term === 'string' ? opts.term : term
      const nextLocationId = typeof opts.locationId === 'string' ? opts.locationId : deliveryLocationId
      const qs = new URLSearchParams({
        status: 'Approved',
        page: String(Math.max(1, nextPage)),
        page_size: String(Math.max(1, nextPageSize)),
        ...(nextTerm ? { term: nextTerm } : {}),
        ...(nextLocationId ? { delivery_location_id: String(nextLocationId) } : {}),
      })
      const res = await fetch(`/api/admin/ram/orders/list?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/ram/orders/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      const rows = json.orders || []
      if (seq !== fetchSeq.current) return
      setOrders(rows)
      setTotalCount(Number(json?.meta?.total_count ?? rows.length))
      setSelectedIds(new Set())
    } catch (e) {
      if (seq !== fetchSeq.current) return
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setOrders([])
      setTotalCount(0)
      setSelectedIds(new Set())
    } finally {
      if (seq === fetchSeq.current) {
        setLoading(false)
        setDidLoadOnce(true)
      }
    }
  }

  const fetchLocations = async () => {
    try {
      const res = await fetch('/api/admin/ram/delivery-locations', { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations')
      if (json?.ok) setDeliveryLocations(json.locations || [])
    } catch {
      setDeliveryLocations([])
    }
  }

  useEffect(() => {
    fetchLocations()
    fetchOrders({ page: 1, pageSize })
    didInitRef.current = true
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
  }, [])

  useEffect(() => {
    if (!didInitRef.current) return
    setSelectedIds(new Set())
    setPage(1)
    fetchOrders({ page: 1, locationId: deliveryLocationId })
  }, [deliveryLocationId])

  const rollbackToPending = async (id) => {
    const orderId = Number(id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    if (rollbackBusyId) return
    setRollbackBusyId(orderId)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/orders/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: orderId, status: 'Pending' }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update-status')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Rollback failed')
      setOrders((prev) => (prev || []).filter((o) => o.id !== orderId))
      setMsg({ type: 'success', text: `Order #${orderId} rolled back to Pending` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Rollback failed' })
    } finally {
      setRollbackBusyId(null)
    }
  }

  const requestRollbackSelected = () => {
    if (!selectedIds.size || delivering || rollbackBusyId || rollbackBulkBusy) return
    setRollbackBulkConfirmOpen(true)
  }

  const confirmRollbackSelected = async () => {
    const ids = Array.from(selectedIds)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
    setRollbackBulkConfirmOpen(false)
    if (!ids.length) return
    setRollbackBulkBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/orders/update-status-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids, status: 'Pending' }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update-status-bulk')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Rollback failed')
      setOrders((prev) => (prev || []).filter((o) => !ids.includes(Number(o.id))))
      setSelectedIds(new Set())
      setMsg({ type: 'success', text: `Rolled back ${ids.length} order(s) to Pending` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Rollback failed' })
    } finally {
      setRollbackBulkBusy(false)
    }
  }

  const printReceipt = async (order) => {
    const orderId = Number(order?.id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    if (receiptBusyId) return
    setReceiptBusyId(orderId)
    setMsg(null)
    try {
      const { jsPDF } = await import('jspdf')
      const autoTableMod = await import('jspdf-autotable')
      const autoTable = autoTableMod?.default ?? autoTableMod
      const doc = new jsPDF()

      const sanitize = (s) => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')
      const currencyPDF = (n) => `NGN ${Number(n || 0).toLocaleString()}`

      const pageWidth = doc.internal.pageSize.getWidth()
      const marginX = 12
      const headerY = 10
      const headerH = 18

      doc.setFillColor(21, 128, 61)
      doc.rect(marginX, headerY, pageWidth - marginX * 2, headerH, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(14)
      doc.text('CBN Coop · Ram Sales Receipt', marginX + 6, headerY + 12)

      doc.setTextColor(0, 0, 0)
      doc.setFontSize(9)
      doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - marginX, headerY + 12, { align: 'right' })

      const detailsBody = [
        ['Order ID', `#${orderId}`, 'Status', sanitize(order?.status || '—')],
        ['Date', order?.created_at ? new Date(order.created_at).toLocaleString() : '—', 'Payment', sanitize(order?.payment_option || '—')],
        ['Member', sanitize(`${order?.member?.full_name || '—'} (${order?.member_id || '—'})`), 'Member Phone', sanitize(order?.member?.phone || '—')],
        ['Quantity', String(Number(order?.qty || 0).toLocaleString()), 'Unit Price', currencyPDF(order?.unit_price)],
      ]

      autoTable(doc, {
        head: [['Order Details', '', '', '']],
        body: detailsBody,
        startY: headerY + headerH + 6,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 64 }, 2: { cellWidth: 28 }, 3: { cellWidth: 64 } },
        margin: { left: marginX, right: marginX },
      })

      const principal = Number(order?.principal_amount ?? 0)
      const interest = Number(order?.interest_amount ?? order?.loan_interest ?? 0)
      const total = Number(order?.total_amount ?? 0)

      autoTable(doc, {
        head: [['Amount Breakdown', '', '']],
        body: [
          ['Principal', currencyPDF(principal), ''],
          ['Interest', currencyPDF(interest), ''],
          ['Total', currencyPDF(total), ''],
        ],
        startY: (doc.lastAutoTable?.finalY || 0) + 6,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 40 }, 1: { halign: 'right', cellWidth: 60 }, 2: { cellWidth: 84 } },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === 2) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fillColor = [240, 253, 244]
          }
        },
        margin: { left: marginX, right: marginX },
      })

      const vendorRows = [
        ['Delivery Location', sanitize(order?.delivery_location?.delivery_location || order?.delivery_location?.name || '—')],
        ['Vendor Name', sanitize(order?.delivery_location?.name || '—')],
        ['Vendor Phone No', sanitize(order?.delivery_location?.phone || '—')],
      ]
      if (order?.delivery_location?.address) vendorRows.push(['Vendor Address', sanitize(order.delivery_location.address)])

      autoTable(doc, {
        head: [['Vendor Details', '']],
        body: vendorRows,
        startY: (doc.lastAutoTable?.finalY || 0) + 6,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 166 } },
        margin: { left: marginX, right: marginX },
      })

      autoTable(doc, {
        head: [['Signature', '']],
        body: [['', '']],
        startY: (doc.lastAutoTable?.finalY || 0) + 8,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 6, lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: [249, 250, 251], textColor: [55, 65, 81], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 166 } },
        margin: { left: marginX, right: marginX },
      })

      if (typeof doc.autoPrint === 'function') doc.autoPrint()
      const blobUrl = doc.output('bloburl')
      const w = window.open(blobUrl, '_blank', 'noopener,noreferrer')
      if (!w) doc.save(`RamReceipt_${orderId}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to generate receipt' })
    } finally {
      setReceiptBusyId(null)
    }
  }

  const locationOptions = useMemo(() => {
    const options = (deliveryLocations || [])
      .filter((l) => l.is_active !== false)
      .map((l) => {
        const id = Number(l.id)
        const label = [String(l.delivery_location || '').trim(), String(l.name || '').trim()].filter(Boolean).join(' · ')
        return { id, label: label || `Location ${id}` }
      })
      .filter((l) => Number.isFinite(l.id) && l.id > 0)
      .sort((a, b) => a.label.localeCompare(b.label))
    return options
  }, [deliveryLocations])

  const selectedLocationLabel = useMemo(() => {
    const id = Number(deliveryLocationId)
    if (!Number.isFinite(id) || id <= 0) return ''
    return locationOptions.find((l) => l.id === id)?.label || ''
  }, [deliveryLocationId, locationOptions])

  const fetchAllForExport = async () => {
    const pageSizeForExport = 1000
    const all = []
    let nextPage = 1
    let total = 0
    while (true) {
      const qs = new URLSearchParams({
        status: 'Approved',
        page: String(nextPage),
        page_size: String(pageSizeForExport),
        ...(term ? { term } : {}),
        ...(deliveryLocationId ? { delivery_location_id: String(deliveryLocationId) } : {}),
      })
      const res = await fetch(`/api/admin/ram/orders/list?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/orders/list (export)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders for export')
      const chunk = json.orders || []
      const t = Number(json?.meta?.total_count ?? 0)
      if (Number.isFinite(t) && t > 0) total = t
      all.push(...chunk)
      if (!chunk.length) break
      if (total && all.length >= total) break
      nextPage += 1
      if (nextPage > 200) break
    }
    return all
  }

  const exportExcel = async () => {
    const list = await fetchAllForExport()
    const rows = list.map((o) => ({
      id: o.id,
      created_at: o.created_at,
      member_id: o.member_id,
      member_name: o.member?.full_name || '',
      member_phone: o.member?.phone || '',
      member_category: o.member_category || '',
      member_grade: o.member_grade || '',
      payment: o.payment_option || '',
      delivery_location: o.delivery_location?.delivery_location || '',
      vendor_name: o.delivery_location?.name || '',
      vendor_phone: o.delivery_location?.phone || '',
      qty: o.qty,
      unit_price: o.unit_price,
      total_amount: o.total_amount,
      loan_interest: o.loan_interest,
      status: o.status,
      signature: '',
    }))
    if (!rows.length) return
    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Approved')

    ws.addRow(['Ram Sales · Approved Orders (Admin)'])
    ws.addRow([`Delivery Location: ${selectedLocationLabel || 'All'} | Search: ${term || 'All'}`])

    const headers = Object.keys(rows[0] || { id: '' })
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `admin_ram_approved_${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = async () => {
    const list = await fetchAllForExport()
    if (!list.length) return
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    const sanitize = (s) => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')
    const filters = [
      `Delivery: ${selectedLocationLabel || 'All'}`,
      `Search: ${term || 'All'}`,
    ].join('  |  ')

    doc.setFontSize(14)
    doc.text('Ram Sales · Approved Orders', 12, 12)
    doc.setFontSize(9)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)
    doc.text(`Filters: ${sanitize(filters)}`, 12, 24)

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
        'Delivery',
        'Signature',
      ],
    ]

    const body = list.map((o) => [
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
      sanitize([o.delivery_location?.delivery_location || '', o.delivery_location?.name || '', o.delivery_location?.phone || ''].filter(Boolean).join('\n')),
      '',
    ])

    const totals = list.reduce(
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
      String(totals.qty.toLocaleString()),
      '',
      `NGN ${totals.principal.toLocaleString()}`,
      `NGN ${totals.interest.toLocaleString()}`,
      `NGN ${totals.total.toLocaleString()}`,
      '',
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
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
        9: { halign: 'right' },
        10: { halign: 'right' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalsRowIndex) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [243, 244, 246]
        }
      },
      margin: { left: 12, right: 12 },
    })

    doc.save(`ram_approved_orders_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil((totalCount || 0) / Math.max(1, pageSize))), [totalCount, pageSize])
  const safePage = Math.min(Math.max(1, page), pageCount)
  const pagedOrders = orders || []

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage)
      fetchOrders({ page: safePage })
    }
  }, [page, safePage])

  const selectedCount = selectedIds.size
  const allSelected = pagedOrders.length > 0 && pagedOrders.every((o) => selectedIds.has(Number(o.id)))

  const toggleSelect = (id) => {
    const orderId = Number(id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    setSelectedIds((prev) => {
      const next = new Set(prev || [])
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const cur = new Set(prev || [])
      const ids = (pagedOrders || []).map((o) => Number(o.id)).filter((n) => Number.isFinite(n) && n > 0)
      if (!ids.length) return cur
      const everySelected = ids.every((id) => cur.has(id))
      if (everySelected) {
        for (const id of ids) cur.delete(id)
        return cur
      }
      for (const id of ids) cur.add(id)
      return cur
    })
  }

  const requestDeliver = (ids) => {
    const list = Array.from(new Set((ids || []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)))
    if (!list.length) return
    if (delivering) return
    setDeliverConfirmIds(list)
    setDeliverConfirmOpen(true)
  }

  const deliverIds = async (ids) => {
    const list = Array.from(new Set((ids || []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)))
    if (!list.length) return
    if (delivering) return
    setDelivering(true)
    setMsg(null)
    setDeliverBusyIds(new Set(list))
    try {
      const res = await fetch('/api/admin/ram/orders/update-status-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: list, status: 'Delivered' }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update-status-bulk')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to deliver')
      const updatedIds = new Set((json.updated || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0))
      setOrders((prev) => (prev || []).filter((o) => !updatedIds.has(Number(o.id))))
      setSelectedIds((prev) => {
        const next = new Set(prev || [])
        for (const id of updatedIds) next.delete(id)
        return next
      })
      setMsg({ type: 'success', text: `${updatedIds.size} order(s) marked as Delivered` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to deliver' })
    } finally {
      setDelivering(false)
      setDeliverBusyIds(new Set())
    }
  }

  const requestRollback = (order) => {
    const orderId = Number(order?.id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    if (rollbackBusyId || delivering) return
    setRollbackConfirmOrder(order || null)
    setRollbackConfirmOpen(true)
  }

  const confirmRollback = async () => {
    const orderId = Number(rollbackConfirmOrder?.id)
    setRollbackConfirmOpen(false)
    setRollbackConfirmOrder(null)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    await rollbackToPending(orderId)
  }

  const deliverSelected = async () => {
    if (!selectedIds.size) return
    requestDeliver(Array.from(selectedIds))
  }

  const confirmDeliver = async () => {
    const ids = Array.from(deliverConfirmIds || [])
    setDeliverConfirmOpen(false)
    setDeliverConfirmIds([])
    await deliverIds(ids)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · Approved</h1>
        <p className="text-sm text-muted">Deliver or roll back approved ram orders.</p>
      </div>

      <AnimatePresence mode="wait">
        {msg ? (
          <motion.div
            key={`${msg.type}-${msg.text}`}
            {...toastMotion}
            className={`mb-4 rounded-xl border p-4 text-sm ${
              msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
            }`}
          >
            {msg.text}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="ui-card p-4 mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[420px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Search (Order ID / Member ID)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    fetchOrders({ page: 1 })
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setPage(1)
                  fetchOrders({ page: 1 })
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
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
                onClick={() => exportExcel().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
                disabled={!totalCount}
              />
              <ExportButton
                format="pdf"
                onClick={() => exportPDF().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
                disabled={!totalCount}
              />
            </div>
          </div>

          <div className="text-sm text-muted">Orders: <span className="font-medium text-fg">{Number(totalCount || 0).toLocaleString()}</span> · Selected: <span className="font-medium text-fg">{selectedCount.toLocaleString()}</span></div>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold text-fg">Approved Orders</div>
            <button
              type="button"
              onClick={fetchOrders}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
            >
              <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={!pagedOrders.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <button
              type="button"
              onClick={deliverSelected}
              disabled={!selectedCount || delivering}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
            >
              <Truck className="h-3.5 w-3.5" />
              {delivering && selectedCount ? 'Delivering…' : `Deliver Selected (${selectedCount})`}
            </button>
            <button
              type="button"
              onClick={requestRollbackSelected}
              disabled={!selectedCount || delivering || rollbackBulkBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-warning-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {rollbackBulkBusy && selectedCount ? 'Rolling back…' : `Rollback Selected (${selectedCount})`}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value) || 50
                setPageSize(next)
                setPage(1)
                fetchOrders({ page: 1, pageSize: next })
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                const next = Math.max(1, safePage - 1)
                setPage(next)
                fetchOrders({ page: next })
              }}
              disabled={safePage <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <div className="text-sm text-muted">
              Page <span className="font-medium text-fg">{safePage}</span> / {pageCount}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                const next = Math.min(pageCount, safePage + 1)
                setPage(next)
                fetchOrders({ page: next })
              }}
              disabled={safePage >= pageCount}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-left">
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={!pagedOrders.length}
                    className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                    aria-label="Select all"
                  />
                </th>
              <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Order</th>
              <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Member</th>
              <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Delivery</th>
              <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Payment</th>
              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Qty</th>
              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Total</th>
              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
            </tr>
          </thead>
          <motion.tbody layout>
            {(!didLoadOnce || loading) && (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-line">
                    <td className="p-3"><div className="sakani-skeleton h-4 w-4 rounded" /></td>
                    <td className="p-3">
                      <div className="sakani-skeleton h-4 w-24 rounded" />
                      <div className="sakani-skeleton mt-2 h-3 w-32 rounded" />
                    </td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-40 rounded" /></td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-36 rounded" /></td>
                    <td className="p-3"><div className="sakani-skeleton h-4 w-16 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-10 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-20 rounded" /></td>
                    <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-8 w-24 rounded" /></td>
                  </tr>
                ))}
              </>
            )}

            {didLoadOnce && !loading && orders.length === 0 && (
              <tr>
                <td className="p-10 text-center" colSpan={8}>
                  <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                      <Inbox className="h-6 w-6 text-subtext" />
                    </div>
                    <p className="text-sm font-medium text-fg">No approved ram orders</p>
                    <p className="text-xs text-muted">Approve pending orders and they will appear here.</p>
                  </div>
                </td>
              </tr>
            )}

            <AnimatePresence initial={false}>
              {didLoadOnce && !loading &&
                pagedOrders.map((o) => (
                  <motion.tr
                    key={o.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="border-b border-line last:border-b-0 transition-colors duration-150 ease-sakani hover:bg-subtle"
                  >
                    <td className="p-3 align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(Number(o.id))}
                        onChange={() => toggleSelect(o.id)}
                        className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                        aria-label={`Select order ${o.id}`}
                      />
                    </td>
                    <td className="p-3 align-top">
                      <div className="font-medium text-fg">#{o.id}</div>
                      <div className="text-xs text-subtext">{new Date(o.created_at).toLocaleString()}</div>
                    </td>
                    <td className="p-3 align-top">
                      <div className="font-medium text-fg">{o.member_id}</div>
                      <div className="text-muted break-words">{o.member?.full_name || '-'}</div>
                      <div className="text-xs text-subtext">{o.member?.phone || ''}</div>
                    </td>
                    <td className="p-3 align-top whitespace-pre-line">
                      <div className="font-medium text-fg">{o.delivery_location?.delivery_location || '-'}</div>
                      <div className="text-xs text-subtext">{o.delivery_location?.name || ''}</div>
                      <div className="text-xs text-subtext">{o.delivery_location?.phone || ''}</div>
                    </td>
                    <td className="p-3 align-top">
                      <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg">
                        {o.payment_option || '-'}
                      </span>
                    </td>
                    <td className="p-3 align-top text-right">{Number(o.qty || 0).toLocaleString()}</td>
                    <td className="p-3 align-top text-right">
                      <div className="font-medium text-fg">{money(o.total_amount)}</div>
                    </td>
                    <td className="p-3 align-top text-right">
                      <div className="flex justify-end">
                        <select
                          defaultValue=""
                          disabled={loading || delivering || rollbackBusyId === o.id || receiptBusyId === o.id || deliverBusyIds.has(Number(o.id))}
                          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
                          onChange={(e) => {
                            const v = e.target.value
                            e.target.value = ''
                            if (!v) return
                            if (v === 'deliver') requestDeliver([o.id])
                            else if (v === 'rollback') requestRollback(o)
                            else if (v === 'receipt') printReceipt(o)
                            else if (v === 'activity') setAuditOrder(o)
                          }}
                        >
                          <option value="" disabled>
                            Actions
                          </option>
                          <option value="deliver">Deliver</option>
                          <option value="rollback">Rollback</option>
                          <option value="receipt">Receipt</option>
                          <option value="activity">Activity</option>
                        </select>
                      </div>
                    </td>
                  </motion.tr>
                ))}
            </AnimatePresence>
          </motion.tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={deliverConfirmOpen}
        onClose={() => {
          if (delivering) return
          setDeliverConfirmOpen(false)
          setDeliverConfirmIds([])
        }}
        title="Confirm Delivery"
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                setDeliverConfirmOpen(false)
                setDeliverConfirmIds([])
              }}
              disabled={delivering}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-success-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              onClick={confirmDeliver}
              disabled={delivering}
            >
              {delivering ? 'Delivering…' : 'Yes, Delivered'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-muted">
          <div className="font-semibold text-fg">Has the member taken possession of the Ram?</div>
          <div className="mt-1">
            {deliverConfirmIds.length === 1
              ? `This will mark order #${deliverConfirmIds[0]} as Delivered.`
              : `This will mark ${deliverConfirmIds.length} order(s) as Delivered.`}
          </div>
          <div className="mt-3 text-xs">This action can be rolled back by Admin if needed.</div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={rollbackConfirmOpen}
        onClose={() => {
          if (rollbackBusyId) return
          setRollbackConfirmOpen(false)
          setRollbackConfirmOrder(null)
        }}
        title="Confirm Rollback"
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                setRollbackConfirmOpen(false)
                setRollbackConfirmOrder(null)
              }}
              disabled={!!rollbackBusyId}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-warning-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              onClick={confirmRollback}
              disabled={!!rollbackBusyId}
            >
              {rollbackBusyId ? 'Rolling back…' : 'Yes, Rollback'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-muted">
          <div className="font-semibold text-fg">Are you sure you want to rollback this order?</div>
          <div className="mt-1">
            This will move order #{rollbackConfirmOrder?.id ?? '—'} from <span className="font-semibold text-fg">Approved</span> to{' '}
            <span className="font-semibold text-fg">Pending</span> records.
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-line bg-subtle p-2">
              <div className="text-subtext">Member</div>
              <div className="font-semibold text-fg">{rollbackConfirmOrder?.member_id || '—'}</div>
              <div className="text-muted">{rollbackConfirmOrder?.member?.full_name || ''}</div>
            </div>
            <div className="rounded-lg border border-line bg-subtle p-2">
              <div className="text-subtext">Delivery Location</div>
              <div className="font-semibold text-fg">{rollbackConfirmOrder?.delivery_location?.delivery_location || '—'}</div>
              <div className="text-muted">{rollbackConfirmOrder?.delivery_location?.name || ''}</div>
              <div className="text-muted">{rollbackConfirmOrder?.delivery_location?.phone || ''}</div>
            </div>
          </div>
          <div className="mt-3 text-xs">After rollback, you’ll find it under Admin → Ram Sales → Pending.</div>
        </div>
      </DraggableModal>

      <DraggableModal
        open={rollbackBulkConfirmOpen}
        onClose={() => {
          if (rollbackBulkBusy) return
          setRollbackBulkConfirmOpen(false)
        }}
        title="Confirm Bulk Rollback"
        overlayClassName="bg-black/40"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => setRollbackBulkConfirmOpen(false)}
              disabled={rollbackBulkBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-warning-fg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              onClick={confirmRollbackSelected}
              disabled={rollbackBulkBusy}
            >
              {rollbackBulkBusy ? 'Rolling back…' : 'Yes, Rollback'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-muted">
          <div className="font-semibold text-fg">Rollback selected orders to Pending?</div>
          <div className="mt-1">
            This will move {selectedCount.toLocaleString()} order(s) from <span className="font-semibold text-fg">Approved</span> to{' '}
            <span className="font-semibold text-fg">Pending</span>.
          </div>
        </div>
      </DraggableModal>

      {/* Order activity — audit trail: who did what and when */}
      <RamOrderAuditModal
        open={!!auditOrder}
        order={auditOrder}
        endpoint="/api/admin/ram/orders/audit"
        onClose={() => setAuditOrder(null)}
      />
    </div>
  )
}

export default function RamApprovedPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamApprovedContent />
    </ProtectedRoute>
  )
}
