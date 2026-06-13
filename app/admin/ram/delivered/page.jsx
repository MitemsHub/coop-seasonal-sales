'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { AnimatePresence, motion } from 'framer-motion'
import DraggableModal from '../../../components/DraggableModal'

function safeJsonFactory() {
  return async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }
}

const toastMotion = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function money(n) {
  return `₦${Number(n || 0).toLocaleString()}`
}

function RamDeliveredContent() {
  const [orders, setOrders] = useState([])
  const [term, setTerm] = useState('')
  const [deliveryLocationId, setDeliveryLocationId] = useState('')
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [didLoadOnce, setDidLoadOnce] = useState(false)
  const [rollbackBusyId, setRollbackBusyId] = useState(null)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [rollbackConfirmOrder, setRollbackConfirmOrder] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [rollbackBulkConfirmOpen, setRollbackBulkConfirmOpen] = useState(false)
  const [rollbackBulkBusy, setRollbackBulkBusy] = useState(false)
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
        status: 'Delivered',
        page: String(Math.max(1, nextPage)),
        page_size: String(Math.max(1, nextPageSize)),
        ...(nextTerm ? { term: nextTerm } : {}),
        ...(nextLocationId ? { delivery_location_id: nextLocationId } : {}),
      })
      const res = await fetch(`/api/admin/ram/orders/list?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/ram/orders/list')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      const nextOrders = json.orders || []
      if (seq !== fetchSeq.current) return
      setOrders(nextOrders)
      setTotalCount(Number(json?.meta?.total_count ?? nextOrders.length))
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
    setPage(1)
    fetchOrders({ page: 1, locationId: deliveryLocationId })
  }, [deliveryLocationId])

  const locationOptions = useMemo(() => {
    const options = (deliveryLocations || [])
      .filter((l) => l.is_active !== false)
      .map((l) => {
        const id = Number(l.id)
        const label = [String(l.delivery_location || '').trim(), String(l.name || '').trim()].filter(Boolean).join(' — ')
        return { id, label: label || `Location ${id}` }
      })
      .filter((l) => Number.isFinite(l.id) && l.id > 0)
      .sort((a, b) => a.label.localeCompare(b.label))
    return options
  }, [deliveryLocations])

  const selectedLocationLabel = useMemo(() => {
    const id = Number(deliveryLocationId)
    if (!Number.isFinite(id) || id <= 0) return ''
    return locationOptions.find((l) => Number(l.id) === id)?.label || ''
  }, [deliveryLocationId, locationOptions])

  const fetchAllForExport = async () => {
    const pageSizeForExport = 1000
    const all = []
    let nextPage = 1
    let total = 0
    while (true) {
      const qs = new URLSearchParams({
        status: 'Delivered',
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
    if (!list.length) return
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
    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Delivered')

    ws.addRow(['Ram Sales — Delivered Orders (Admin)'])
    ws.addRow([`Delivery Location: ${selectedLocationLabel || 'All'} | Search: ${term || 'All'}`])

    const headers = Object.keys(rows[0] || { id: '' })
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `admin_ram_delivered_${new Date().toISOString().split('T')[0]}.xlsx`
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
    const filters = [`Delivery: ${selectedLocationLabel || 'All'}`, `Search: ${term || 'All'}`].join('  |  ')

    doc.setFontSize(14)
    doc.text('Ram Sales — Delivered Orders', 12, 12)
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
      styles: { fontSize: 7 },
      headStyles: { fillColor: [75, 85, 99] },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalsRowIndex) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [243, 244, 246]
        }
      },
      margin: { left: 12, right: 12 },
    })

    doc.save(`admin_ram_delivered_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const rollbackToApproved = async (id) => {
    const orderId = Number(id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    if (rollbackBusyId) return
    setRollbackBusyId(orderId)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ram/orders/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: orderId, status: 'Approved' }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update-status')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Rollback failed')
      setOrders((prev) => (prev || []).filter((o) => o.id !== orderId))
      setMsg({ type: 'success', text: `Order #${orderId} rolled back to Approved` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Rollback failed' })
    } finally {
      setRollbackBusyId(null)
    }
  }

  const requestRollback = (order) => {
    const orderId = Number(order?.id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    if (rollbackBusyId) return
    setRollbackConfirmOrder(order || null)
    setRollbackConfirmOpen(true)
  }

  const confirmRollback = async () => {
    const orderId = Number(rollbackConfirmOrder?.id)
    setRollbackConfirmOpen(false)
    setRollbackConfirmOrder(null)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    await rollbackToApproved(orderId)
  }

  const requestRollbackSelected = () => {
    if (!selectedCount || rollbackBusyId || rollbackBulkBusy) return
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
        body: JSON.stringify({ ids, status: 'Approved' }),
      })
      const json = await safeJson(res, '/api/admin/ram/orders/update-status-bulk')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Rollback failed')
      setOrders((prev) => (prev || []).filter((o) => !ids.includes(Number(o.id))))
      setSelectedIds(new Set())
      setMsg({ type: 'success', text: `Rolled back ${ids.length} order(s) to Approved` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Rollback failed' })
    } finally {
      setRollbackBulkBusy(false)
    }
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil((totalCount || 0) / Math.max(1, pageSize))), [totalCount, pageSize])
  const safePage = Math.min(Math.max(1, page), pageCount)
  const pageRows = orders || []
  const selectedCount = selectedIds.size
  const allSelectedOnPage = pageRows.length > 0 && pageRows.every((o) => selectedIds.has(Number(o.id)))

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage)
      fetchOrders({ page: safePage })
    }
  }, [page, safePage])

  const toggleSelect = (id) => {
    const orderId = Number(id)
    if (!Number.isFinite(orderId) || orderId <= 0) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(orderId) ? next.delete(orderId) : next.add(orderId)
      return next
    })
  }

  const toggleSelectAll = () => {
    const ids = pageRows.map((o) => Number(o.id)).filter((n) => Number.isFinite(n) && n > 0)
    if (!ids.length) return
    const allSelected = ids.every((id) => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(ids))
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-base sm:text-lg md:text-xl font-semibold break-words">Admin — Ram Sales (Delivered)</h1>
          <div className="text-xs sm:text-sm text-gray-600">Delivered ram orders. You can rollback to Approved if needed.</div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {msg ? (
          <motion.div
            key={`${msg.type}-${msg.text}`}
            {...toastMotion}
            className={`mb-4 rounded-xl border p-3 text-sm ${
              msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'
            }`}
          >
            {msg.text}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[420px] border-2 border-gray-200 rounded-xl px-3 py-2 text-sm"
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
                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                Search
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
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
              <button
                type="button"
                onClick={exportExcel}
                disabled={!totalCount}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
              >
                Download Excel
              </button>
              <button
                type="button"
                onClick={exportPDF}
                disabled={!totalCount}
                className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                Download PDF
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-600">
            Orders: {Number(totalCount || 0).toLocaleString()} · Selected: {selectedCount.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">Delivered Orders</div>
            <button
              type="button"
              onClick={fetchOrders}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={!pageRows.length}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs sm:text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              {allSelectedOnPage ? 'Deselect All' : 'Select All'}
            </button>
            <button
              type="button"
              onClick={requestRollbackSelected}
              disabled={!selectedCount || rollbackBulkBusy}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              {rollbackBulkBusy && selectedCount ? 'Rolling back…' : `Rollback Selected (${selectedCount})`}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
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
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs sm:text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => {
                const next = Math.max(1, safePage - 1)
                setPage(next)
                fetchOrders({ page: next })
              }}
              disabled={safePage <= 1}
            >
              Prev
            </button>
            <div className="text-xs text-gray-500">
              Page {safePage} / {pageCount}
            </div>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs sm:text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => {
                const next = Math.min(pageCount, safePage + 1)
                setPage(next)
                fetchOrders({ page: next })
              }}
              disabled={safePage >= pageCount}
            >
              Next
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 text-left w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={!!pageRows.length && allSelectedOnPage}
                    onChange={toggleSelectAll}
                    disabled={loading || !pageRows.length}
                  />
                </th>
                <th className="p-2 text-left">Order</th>
                <th className="p-2 text-left">Member</th>
                <th className="p-2 text-left">Delivery</th>
                <th className="p-2 text-left">Payment</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(!didLoadOnce || loading) ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b last:border-b-0 animate-pulse">
                    <td className="p-2" colSpan={8}>
                      <div className="h-4 w-full rounded bg-gray-100" />
                    </td>
                  </tr>
                ))
              ) : !pageRows.length ? (
                <tr>
                  <td className="p-3 text-gray-600" colSpan={8}>
                    No delivered ram orders found
                  </td>
                </tr>
              ) : pageRows.map((o) => (
                <tr key={o.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="p-2 align-top">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedIds.has(Number(o.id))}
                      onChange={() => toggleSelect(o.id)}
                      disabled={loading}
                    />
                  </td>
                  <td className="p-2 align-top">
                    <div className="font-medium">#{o.id}</div>
                    <div className="text-gray-600">{o.created_at ? new Date(o.created_at).toLocaleString() : ''}</div>
                  </td>
                  <td className="p-2 align-top">
                    <div className="font-medium">{o.member_id}</div>
                    <div className="text-gray-600 break-words">{o.member?.full_name || '—'}</div>
                    <div className="text-gray-600">{o.member?.phone || '—'}</div>
                  </td>
                  <td className="p-2 align-top whitespace-pre-line">
                    <div>{o.delivery_location?.delivery_location || '—'}</div>
                    <div className="text-gray-600">{o.delivery_location?.name || ''}</div>
                    <div className="text-gray-600">{o.delivery_location?.phone || ''}</div>
                  </td>
                  <td className="p-2 align-top">{o.payment_option || ''}</td>
                  <td className="p-2 align-top text-right">{Number(o.qty || 0).toLocaleString()}</td>
                  <td className="p-2 align-top text-right">
                    <div className="font-medium">{money(o.total_amount)}</div>
                  </td>
                  <td className="p-2 align-top text-right">
                    <div className="flex justify-end">
                      <select
                        defaultValue=""
                        disabled={loading || rollbackBusyId === o.id}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm bg-white disabled:opacity-50"
                        onChange={(e) => {
                          const v = e.target.value
                          e.target.value = ''
                          if (v === 'rollback') requestRollback(o)
                        }}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="rollback">Rollback</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
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
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50"
              onClick={confirmRollback}
              disabled={!!rollbackBusyId}
            >
              {rollbackBusyId ? 'Rolling back…' : 'Yes, Rollback'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-gray-800">
          <div className="font-semibold text-gray-900">Are you sure you want to rollback this order?</div>
          <div className="mt-1 text-gray-700">
            This will move order #{rollbackConfirmOrder?.id ?? '—'} from <span className="font-semibold">Delivered</span> to{' '}
            <span className="font-semibold">Approved</span> records.
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-700">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <div className="text-gray-500">Member</div>
              <div className="font-semibold">{rollbackConfirmOrder?.member_id || '—'}</div>
              <div className="text-gray-600">{rollbackConfirmOrder?.member?.full_name || ''}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <div className="text-gray-500">Delivery Location</div>
              <div className="font-semibold">{rollbackConfirmOrder?.delivery_location?.delivery_location || '—'}</div>
              <div className="text-gray-600">{rollbackConfirmOrder?.delivery_location?.name || ''}</div>
              <div className="text-gray-600">{rollbackConfirmOrder?.delivery_location?.phone || ''}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-600">After rollback, you’ll find it under Admin → Ram Sales → Approved.</div>
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
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
              onClick={() => setRollbackBulkConfirmOpen(false)}
              disabled={rollbackBulkBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50"
              onClick={confirmRollbackSelected}
              disabled={rollbackBulkBusy}
            >
              {rollbackBulkBusy ? 'Rolling back…' : 'Yes, Rollback'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-gray-800">
          <div className="font-semibold text-gray-900">Rollback selected orders to Approved?</div>
          <div className="mt-1 text-gray-700">
            This will move {selectedCount.toLocaleString()} order(s) from <span className="font-semibold">Delivered</span> to{' '}
            <span className="font-semibold">Approved</span>.
          </div>
        </div>
      </DraggableModal>
    </div>
  )
}

export default function RamDeliveredPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamDeliveredContent />
    </ProtectedRoute>
  )
}
