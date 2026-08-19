'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { AnimatePresence, motion } from 'framer-motion'
import DraggableModal from '../../../components/DraggableModal'
import RamOrderAuditModal from '../../../components/RamOrderAuditModal'
import ExportButton from '../../../components/ui/ExportButton'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../../lib/pdfExport'
import { CheckSquare, ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw, Search } from 'lucide-react'

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

    ws.addRow(['Ram Sales · Delivered Orders (Admin)'])
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
    const sanitize = sanitizePdfText
    const filters = [`Delivery: ${selectedLocationLabel || 'All'}`, `Search: ${term || 'All'}`].join('  |  ')
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

    await addManifestTable(doc, {
      head,
      body,
      startY: 30,
      variant: 'ram',
      columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
      options: {
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === totalsRowIndex) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fillColor = [243, 244, 246]
          }
        },
      },
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
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Ram Sales · Delivered</h1>
        <p className="text-sm text-muted">Delivered ram orders. You can rollback to Approved if needed.</p>
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
            <div className="mr-1 text-sm font-semibold text-fg">Delivered Orders</div>
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
              disabled={!pageRows.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {allSelectedOnPage ? 'Deselect All' : 'Select All'}
            </button>
            <button
              type="button"
              onClick={requestRollbackSelected}
              disabled={!selectedCount || rollbackBulkBusy}
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
                    className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                    checked={!!pageRows.length && allSelectedOnPage}
                    onChange={toggleSelectAll}
                    disabled={loading || !pageRows.length}
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
            <tbody>
              {(!didLoadOnce || loading) ? (
                Array.from({ length: 6 }).map((_, i) => (
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
                ))
              ) : !pageRows.length ? (
                <tr>
                  <td className="p-10 text-center" colSpan={8}>
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                        <Inbox className="h-6 w-6 text-subtext" />
                      </div>
                      <p className="text-sm font-medium text-fg">No delivered ram orders</p>
                      <p className="text-xs text-muted">Deliver approved orders and they will appear here.</p>
                    </div>
                  </td>
                </tr>
              ) : pageRows.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-b-0 transition-colors duration-150 ease-sakani hover:bg-subtle">
                  <td className="p-3 align-top">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                      checked={selectedIds.has(Number(o.id))}
                      onChange={() => toggleSelect(o.id)}
                      disabled={loading}
                      aria-label={`Select order ${o.id}`}
                    />
                  </td>
                  <td className="p-3 align-top">
                    <div className="font-medium text-fg">#{o.id}</div>
                    <div className="text-xs text-subtext">{o.created_at ? new Date(o.created_at).toLocaleString() : ''}</div>
                  </td>
                  <td className="p-3 align-top">
                    <div className="font-medium text-fg">{o.member_id}</div>
                    <div className="text-muted break-words">{o.member?.full_name || '—'}</div>
                    <div className="text-xs text-subtext">{o.member?.phone || '—'}</div>
                  </td>
                  <td className="p-3 align-top whitespace-pre-line">
                    <div className="font-medium text-fg">{o.delivery_location?.delivery_location || '—'}</div>
                    <div className="text-xs text-subtext">{o.delivery_location?.name || ''}</div>
                    <div className="text-xs text-subtext">{o.delivery_location?.phone || ''}</div>
                  </td>
                  <td className="p-3 align-top">
                    <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg">
                      {o.payment_option || ''}
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
                        disabled={loading || rollbackBusyId === o.id}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
                        onChange={(e) => {
                          const v = e.target.value
                          e.target.value = ''
                          if (v === 'rollback') requestRollback(o)
                          if (v === 'activity') setAuditOrder(o)
                        }}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="rollback">Rollback</option>
                        <option value="activity">Activity</option>
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
            This will move order #{rollbackConfirmOrder?.id ?? '—'} from <span className="font-semibold text-fg">Delivered</span> to{' '}
            <span className="font-semibold text-fg">Approved</span> records.
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
          <div className="mt-3 text-xs">After rollback, you’ll find it under Admin → Ram Sales → Approved.</div>
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
          <div className="font-semibold text-fg">Rollback selected orders to Approved?</div>
          <div className="mt-1">
            This will move {selectedCount.toLocaleString()} order(s) from <span className="font-semibold text-fg">Delivered</span> to{' '}
            <span className="font-semibold text-fg">Approved</span>.
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

export default function RamDeliveredPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RamDeliveredContent />
    </ProtectedRoute>
  )
}
