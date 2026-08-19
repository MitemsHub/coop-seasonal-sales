'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DraggableModal from '../../../components/DraggableModal'
import RamOrderAuditModal from '../../../components/RamOrderAuditModal'
import { AnimatePresence, motion } from 'framer-motion'
import ExportButton from '../../../components/ui/ExportButton'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../../lib/pdfExport'
import { CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw, Search, XCircle } from 'lucide-react'

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

export function RamOrdersAdminPageContent({ status = 'Pending' }) {
  const [orders, setOrders] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [locations, setLocations] = useState([])
  const [term, setTerm] = useState('')
  const [payment, setPayment] = useState('')
  const [memberGrade, setMemberGrade] = useState('')
  const [locationId, setLocationId] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showModal, setShowModal] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [editQty, setEditQty] = useState('')
  const [editLocationId, setEditLocationId] = useState('')
  const [editPaymentOption, setEditPaymentOption] = useState('')
  const [editUnitPrice, setEditUnitPrice] = useState('')
  const [editMemberId, setEditMemberId] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [auditOrder, setAuditOrder] = useState(null)
  const fetchCtl = useRef(null)
  const safeJson = useMemo(() => safeJsonFactory(), [])

  const fetchOrders = async (opts = {}) => {
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const nextPage = Number(opts.page || page || 1)
      const nextPageSize = Number(opts.pageSize || pageSize || 50)
      const nextTerm = typeof opts.term === 'string' ? opts.term : term
      const nextPayment = typeof opts.payment === 'string' ? opts.payment : payment
      const nextMemberGrade = typeof opts.memberGrade === 'string' ? opts.memberGrade : memberGrade
      const nextLocationId = typeof opts.locationId === 'string' ? opts.locationId : locationId
      const qs = new URLSearchParams({
        status,
        page: String(Math.max(1, nextPage)),
        page_size: String(Math.max(1, nextPageSize)),
        ...(nextTerm ? { term: nextTerm } : {}),
        ...(nextPayment ? { payment: nextPayment } : {}),
        ...(nextMemberGrade ? { member_grade: nextMemberGrade.trim() } : {}),
        ...(nextLocationId ? { delivery_location_id: String(nextLocationId) } : {}),
      })
      const res = await fetch(`/api/admin/ram/orders/list?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/ram/orders/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      const rows = json.orders || []
      setOrders(rows)
      setTotalCount(Number(json?.meta?.total_count ?? rows.length))
      setSelected(new Set())
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
    } finally {
      setLoading(false)
    }
  }

  const fetchAllForExport = async () => {
    if (status !== 'Pending') return []
    const pageSizeForExport = 1000
    const all = []
    let nextPage = 1
    let total = 0
    while (true) {
      const qs = new URLSearchParams({
        status: 'Pending',
        page: String(nextPage),
        page_size: String(pageSizeForExport),
        ...(term ? { term } : {}),
        ...(payment ? { payment } : {}),
        ...(memberGrade ? { member_grade: memberGrade.trim() } : {}),
        ...(locationId ? { delivery_location_id: String(locationId) } : {}),
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

  const fetchLocations = async () => {
    try {
      const res = await fetch('/api/admin/ram/delivery-locations', { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/ram/delivery-locations')
      if (json?.ok) setLocations(json.locations || [])
    } catch {
      setLocations([])
    }
  }

  useEffect(() => {
    fetchLocations()
    fetchOrders({ page: 1, pageSize })
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
  }, [])

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil((totalCount || 0) / Math.max(1, pageSize))), [totalCount, pageSize])
  const safePage = Math.min(Math.max(1, page), pageCount)
  const pagedOrders = orders || []
  const selectedCount = selected.size
  const allSelectedOnPage = pagedOrders.length > 0 && pagedOrders.every((o) => selected.has(o.id))

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage)
      fetchOrders({ page: safePage })
    }
  }, [page, safePage])

  useEffect(() => {
    setSelected(new Set())
  }, [pageSize, safePage])

  const selectAll = () => {
    const ids = (pagedOrders || []).map((o) => o.id)
    if (!ids.length) return
    const allSelected = ids.every((id) => selected.has(id))
    setSelected(allSelected ? new Set() : new Set(ids))
  }

  const exportExcel = async () => {
    const srcOrders = await fetchAllForExport()
    const rows = srcOrders.map((o) => ({
      id: o.id,
      created_at: o.created_at,
      member_id: o.member_id,
      member_name: o.member?.full_name || '',
      member_phone: o.member?.phone || '',
      member_category: o.member_category || '',
      member_grade: o.member_grade || '',
      payment: o.payment_option || '',
      delivery_location: o.delivery_location?.delivery_location || '',
      delivery_contact: o.delivery_location?.name || '',
      delivery_phone: o.delivery_location?.phone || '',
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
    const ws = wb.addWorksheet('Pending')

    const locationLabel = locationId
      ? filteredLocations.find((l) => String(l.id) === String(locationId))?.delivery_location || String(locationId)
      : 'All'
    ws.addRow(['Ram Sales · Pending Orders (Admin)'])
    ws.addRow([`Location: ${locationLabel} | Payment: ${payment || 'All'} | Grade: ${memberGrade ? memberGrade.trim() : 'All'} | Search: ${term || 'All'}`])

    const headers = Object.keys(rows[0] || { id: '' })
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `admin_ram_pending_${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = async () => {
    const srcOrders = await fetchAllForExport()
    if (!srcOrders.length) return
    const sanitize = sanitizePdfText
    const locationLabel = locationId
      ? filteredLocations.find((l) => String(l.id) === String(locationId))?.delivery_location || String(locationId)
      : 'All'
    const filters = [
      `Location: ${locationLabel}`,
      `Payment: ${payment || 'All'}`,
      `Grade: ${memberGrade ? memberGrade.trim() : 'All'}`,
      `Search: ${term || 'All'}`,
    ].join('  |  ')
    const doc = await createManifestDoc({
      title: 'Ram Sales · Pending Orders',
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
        'Delivery',
        'Signature',
      ],
    ]

    const body = srcOrders.map((o) => [
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

    const totals = srcOrders.reduce(
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

    doc.save(`ram_pending_orders_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const openBulkModal = (nextStatus) => {
    if (!selected.size) return
    const ids = Array.from(selected)
    setShowModal({ type: 'bulk', ids, nextStatus })
  }

  const openCancelModal = (ids) => {
    const list = Array.isArray(ids) ? ids : []
    const cleaned = list.filter((v) => Number.isFinite(Number(v)) && Number(v) > 0).map((v) => Number(v))
    if (!cleaned.length) return
    setShowModal({ type: 'cancel', ids: cleaned })
    setCancelReason('')
  }

  const openRestoreModal = (ids) => {
    const list = Array.isArray(ids) ? ids : []
    const cleaned = list.filter((v) => Number.isFinite(Number(v)) && Number(v) > 0).map((v) => Number(v))
    if (!cleaned.length) return
    setShowModal({ type: 'restore', ids: cleaned })
  }

  const openEditModal = (order) => {
    if (!order?.id) return
    setEditQty(String(order.qty || 1))
    setEditLocationId(String(order.delivery_location?.id || order.ram_delivery_location_id || ''))
    setEditPaymentOption(String(order.payment_option || ''))
    setEditUnitPrice(String(order.unit_price ?? ''))
    setEditMemberId(String(order.member_id || ''))
    setEditPhone(String(order.member?.phone || ''))
    setShowModal({ type: 'edit', id: order.id })
  }

  const submitBulk = async () => {
    const ids = showModal?.ids || []
    const nextStatus = showModal?.nextStatus
    if (!ids.length || !nextStatus) return
    setBulkBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/orders/update-status-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids, status: nextStatus }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update-status-bulk')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Bulk update failed')
      setMsg({ type: 'success', text: `Updated ${json.updated?.length || 0} order(s) to ${nextStatus}` })
      setShowModal(null)
      fetchOrders()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Bulk update failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  const submitCancel = async () => {
    const ids = showModal?.ids || []
    if (!ids.length) return
    setBulkBusy(true)
    setMsg(null)
    try {
      const reason = String(cancelReason || '').trim()
      const res = await fetch('/api/admin/ram/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids, reason: reason || 'Cancelled by admin' }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/cancel')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Cancel failed')
      const cancelled = Array.isArray(json.cancelled) ? json.cancelled : ids
      setOrders((prev) => (prev || []).filter((o) => !cancelled.includes(o.id)))
      setSelected(new Set())
      setShowModal(null)
      setCancelReason('')
      setMsg({ type: 'success', text: `Cancelled ${cancelled.length} order(s)` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Cancel failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  const submitRestore = async () => {
    const ids = showModal?.ids || []
    if (!ids.length) return
    setBulkBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/orders/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/restore')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Restore failed')
      const restored = Array.isArray(json.restored) ? json.restored : ids
      setOrders((prev) => (prev || []).filter((o) => !restored.includes(o.id)))
      setSelected(new Set())
      setShowModal(null)
      setMsg({ type: 'success', text: `Restored ${restored.length} order(s)` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Restore failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  const submitEdit = async () => {
    const id = showModal?.id
    const qty = Number(editQty)
    const deliveryLocationId = Number(editLocationId)
    const paymentOption = String(editPaymentOption || '').trim()
    const memberId = String(editMemberId || '').trim().toUpperCase()
    if (!Number.isFinite(id) || id <= 0) return
    if (!Number.isFinite(qty) || qty <= 0) return
    if (!Number.isFinite(deliveryLocationId) || deliveryLocationId <= 0) return
    if (!paymentOption) return
    if (!memberId) return

    setEditBusy(true)
    setMsg(null)
    try {
      const unitPriceNum = String(editUnitPrice || '').trim() ? Number(editUnitPrice) : null
      if (unitPriceNum != null && (!Number.isFinite(unitPriceNum) || unitPriceNum <= 0)) {
        throw new Error('Invalid unit price')
      }
      const phone = String(editPhone || '').trim()
      const res = await fetch('/api/admin/ram/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          id,
          member_id: memberId,
          payment_option: paymentOption,
          qty,
          delivery_location_id: deliveryLocationId,
          ...(unitPriceNum != null ? { unit_price: unitPriceNum } : {}),
          ...(phone ? { member_phone: phone } : {}),
        }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Update failed')
      const updated = json.order
      const loc = (locations || []).find((l) => String(l.id) === String(updated?.ram_delivery_location_id)) || null
      setOrders((prev) =>
        (prev || []).map((o) => {
          if (o.id !== id) return o
          return {
            ...o,
            ...updated,
            loan_interest: Number(updated?.interest_amount || 0),
            delivery_location: loc
              ? {
                  id: loc.id,
                  delivery_location: loc.delivery_location || '',
                  name: loc.name || '',
                  phone: loc.phone || '',
                  address: loc.address || '',
                  is_active: loc.is_active,
                }
              : o.delivery_location,
            member: json?.member
              ? json.member
              : phone
                ? { ...(o.member || {}), phone }
                : o.member,
          }
        })
      )
      setShowModal(null)
      setMsg({ type: 'success', text: `Order #${id} updated` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Update failed' })
    } finally {
      setEditBusy(false)
    }
  }

  const filteredLocations = useMemo(() => (locations || []).filter((l) => l.is_active !== false), [locations])

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · {status}</h1>
        <p className="text-sm text-muted">Browse, filter, approve and manage {status.toLowerCase()} ram orders.</p>
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
                value={payment}
                onChange={(e) => {
                  const next = e.target.value
                  setPayment(next)
                  setPage(1)
                  fetchOrders({ page: 1, payment: next })
                }}
              >
                <option value="">All payments</option>
                <option value="Cash">Cash</option>
                <option value="Savings">Savings</option>
                <option value="Loan">Loan</option>
              </select>
              <select
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={locationId}
                onChange={(e) => {
                  const next = e.target.value
                  setLocationId(next)
                  setPage(1)
                  fetchOrders({ page: 1, locationId: next })
                }}
              >
                <option value="">All delivery locations</option>
                {filteredLocations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.delivery_location}
                  </option>
                ))}
              </select>
              <input
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Member grade (e.g. Retiree)"
                value={memberGrade}
                onChange={(e) => {
                  const next = e.target.value
                  setMemberGrade(next)
                  setPage(1)
                  fetchOrders({ page: 1, memberGrade: next })
                }}
              />
              {status === 'Pending' && (
                <>
                  <ExportButton
                    format="excel"
                    onClick={() => exportExcel().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
                    disabled={!orders.length}
                  />
                  <ExportButton
                    format="pdf"
                    onClick={() => exportPDF().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
                    disabled={!orders.length}
                  />
                </>
              )}
            </div>
          </div>

          <div className="text-sm text-muted">
            Orders: <span className="font-medium text-fg">{Number(totalCount || 0).toLocaleString()}</span> · Selected: <span className="font-medium text-fg">{selectedCount.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold text-fg">{status} Orders</div>
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
              onClick={selectAll}
              disabled={!pagedOrders.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {allSelectedOnPage ? 'Deselect All' : 'Select All'}
            </button>
            {status === 'Pending' && (
              <button
                type="button"
                onClick={() => openBulkModal('Approved')}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-success-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve Selected ({selectedCount})
              </button>
            )}
            {status === 'Pending' ? (
              <button
                type="button"
                onClick={() => openCancelModal(Array.from(selected))}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel Selected ({selectedCount})
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openRestoreModal(Array.from(selected))}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore Selected ({selectedCount})
              </button>
            )}
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
                    checked={allSelectedOnPage}
                    onChange={selectAll}
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
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Unit</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Total</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
              </tr>
            </thead>
            <motion.tbody layout>
              {loading && (
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
                      <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-14 rounded" /></td>
                      <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-20 rounded" /></td>
                      <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-8 w-24 rounded" /></td>
                    </tr>
                  ))}
                </>
              )}

              {!loading && orders.length === 0 && (
                <tr>
                  <td className="p-10 text-center" colSpan={9}>
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                        <Inbox className="h-6 w-6 text-subtext" />
                      </div>
                      <p className="text-sm font-medium text-fg">No {status} ram orders</p>
                      <p className="text-xs text-muted">When members place ram orders, they will appear here.</p>
                    </div>
                  </td>
                </tr>
              )}

              <AnimatePresence initial={false}>
                {!loading &&
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
                          checked={selected.has(o.id)}
                          onChange={() => toggleSelect(o.id)}
                          className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                          aria-label={`Select order ${o.id}`}
                        />
                      </td>
                      <td className="p-3 align-top">
                        <div className="font-medium text-fg">#{o.id}</div>
                        <div className="text-xs text-subtext">{o.created_at ? new Date(o.created_at).toLocaleString() : ''}</div>
                        {status === 'Cancelled' ? (
                          <>
                            <div className="text-xs text-subtext">
                              Cancelled: {o.cancelled_at ? new Date(o.cancelled_at).toLocaleString() : '—'}
                            </div>
                            <div className="text-xs text-subtext break-words">Reason: {String(o.cancelled_reason || '').trim() || '—'}</div>
                          </>
                        ) : null}
                      </td>
                      <td className="p-3 align-top">
                        <div className="font-medium text-fg">{o.member_id}</div>
                        <div className="text-muted break-words">{o.member?.full_name || '-'}</div>
                        <div className="text-xs text-subtext">{o.member?.phone || ''}</div>
                        <div className="text-xs text-subtext">
                          {o.member_category || '-'}
                          {o.member_grade ? ` (${o.member_grade})` : ''}
                        </div>
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
                      <td className="p-3 align-top text-right">{money(o.unit_price)}</td>
                      <td className="p-3 align-top text-right">
                        <div className="font-medium text-fg">{money(o.total_amount)}</div>
                      </td>
                      <td className="p-3 align-top text-right">
                        <div className="flex justify-end">
                          <select
                            defaultValue=""
                            disabled={bulkBusy || editBusy}
                            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
                            onChange={(e) => {
                              const v = e.target.value
                              e.target.value = ''
                              if (!v) return
                              if (v === 'edit') openEditModal(o)
                              if (v === 'cancel') openCancelModal([o.id])
                              if (v === 'restore') openRestoreModal([o.id])
                              if (v === 'activity') setAuditOrder(o)
                            }}
                          >
                            <option value="" disabled>
                              Actions
                            </option>
                            {status === 'Pending' ? (
                              <>
                                <option value="edit">Edit</option>
                                <option value="cancel">Cancel</option>
                              </>
                            ) : (
                              <option value="restore">Restore</option>
                            )}
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
        open={!!showModal}
        onClose={() => (bulkBusy || editBusy ? null : setShowModal(null))}
        widthClass="max-w-4xl w-full mx-4"
        title={
          showModal?.type === 'edit'
            ? `Edit Order #${showModal?.id}`
            : showModal?.type === 'cancel'
              ? 'Cancel Orders'
              : showModal?.type === 'restore'
                ? 'Restore Orders'
              : 'Approve Selected Orders'
        }
        footer={
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
              onClick={() => setShowModal(null)}
              disabled={bulkBusy || editBusy}
            >
              Close
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani ${
                showModal?.type === 'edit'
                  ? 'bg-brand hover:bg-brand-hover'
                  : showModal?.type === 'cancel'
                    ? 'bg-danger-fg hover:brightness-110'
                    : showModal?.type === 'restore'
                      ? 'bg-brand hover:bg-brand-hover'
                      : 'bg-brand hover:bg-brand-hover'
              } disabled:opacity-50`}
              onClick={
                showModal?.type === 'edit'
                  ? submitEdit
                  : showModal?.type === 'cancel'
                    ? submitCancel
                    : showModal?.type === 'restore'
                      ? submitRestore
                      : submitBulk
              }
              disabled={bulkBusy || editBusy}
            >
              {bulkBusy || editBusy ? 'Working...' : showModal?.type === 'cancel' ? 'Cancel' : showModal?.type === 'restore' ? 'Restore' : 'Confirm'}
            </button>
          </div>
        }
      >
        {showModal?.type === 'edit' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div>
                <div className="text-xs font-medium text-subtext mb-1">Delivery Location</div>
                <select
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  value={editLocationId}
                  onChange={(e) => setEditLocationId(e.target.value)}
                  disabled={editBusy || bulkBusy}
                >
                  <option value="">Select...</option>
                  {filteredLocations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.delivery_location}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-subtext mb-1">Payment</div>
                <select
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  value={editPaymentOption}
                  onChange={(e) => setEditPaymentOption(e.target.value)}
                  disabled={editBusy || bulkBusy}
                >
                  <option value="">Select...</option>
                  <option value="Cash">Cash</option>
                  <option value="Savings">Savings</option>
                  <option value="Loan">Loan</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-subtext mb-1">Qty</div>
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  inputMode="numeric"
                  disabled={editBusy || bulkBusy}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-subtext mb-1">Unit Price</div>
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  value={editUnitPrice}
                  onChange={(e) => setEditUnitPrice(e.target.value)}
                  inputMode="numeric"
                  disabled={editBusy || bulkBusy}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-subtext mb-1">Member ID</div>
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  value={editMemberId}
                  onChange={(e) => setEditMemberId(e.target.value)}
                  disabled={editBusy || bulkBusy}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-subtext mb-1">Member Phone</div>
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  disabled={editBusy || bulkBusy}
                />
              </div>
            </div>
            <div className="text-xs text-muted">
              {editPaymentOption === 'Loan'
                ? (() => {
                    const o = (orders || []).find((x) => Number(x?.id) === Number(showModal?.id))
                    const r = Number(o?.loan_interest_rate_pct)
                    const pct = Number.isFinite(r) ? r : 6
                    return `Loan has a per-cycle max quantity limit and includes ${pct}% interest.`
                  })()
                : null}
            </div>
          </div>
        ) : showModal?.type === 'cancel' ? (
          <div className="space-y-3">
            <div className="text-sm text-muted">
              Cancel <b className="text-fg">{showModal?.ids?.length || 0}</b> order(s)? Cancelled orders will be excluded from reports and exports.
            </div>
            <div>
              <div className="text-xs font-medium text-subtext mb-1">Reason (optional)</div>
              <textarea
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation..."
                disabled={bulkBusy || editBusy}
              />
            </div>
          </div>
        ) : showModal?.type === 'restore' ? (
          <div className="text-sm text-muted">
            Restore <b className="text-fg">{showModal?.ids?.length || 0}</b> order(s) back to <b className="text-fg">Pending</b>?
          </div>
        ) : (
          <div className="text-sm text-muted">
            Update <b className="text-fg">{showModal?.ids?.length || 0}</b> order(s) to <b className="text-fg">{showModal?.nextStatus}</b>?
          </div>
        )}
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

export default function RamPendingPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamOrdersAdminPageContent status="Pending" />
    </ProtectedRoute>
  )
}
