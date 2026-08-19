// app/admin/posted/page.jsx
'use client'

import { useEffect, useState, useRef } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DraggableModal from '../../../components/DraggableModal'
import ExportButton from '../../../components/ui/ExportButton'
import PrintOrderSheet from '../../../components/PrintOrderSheet'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../../lib/pdfExport'
import { announceRepFoodStats } from '../../../lib/repFoodStatsSync'
import { CheckSquare, ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw, Truck, Zap } from 'lucide-react'

function PostedAdminPageContent() {
  const [orders, setOrders] = useState([])
  const [msg, setMsg] = useState(null)
  const [term, setTerm] = useState('')
  const [payment, setPayment] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [cursorStack, setCursorStack] = useState([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [summary, setSummary] = useState(null)
  const [deliveringOrder, setDeliveringOrder] = useState(null) // Track which order is being delivered
  const [deliveringBulk, setDeliveringBulk] = useState(false) // Track bulk delivery
  const [rollingBack, setRollingBack] = useState(false)
  const [showModal, setShowModal] = useState(null)
  const [modalInput, setModalInput] = useState('')
  const [viewing, setViewing] = useState(null)
  const [sheetOrder, setSheetOrder] = useState(null) // order row for the print sheet

  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  const fetchOrders = async (cursorOverride) => {
    setLoading(true); setMsg(null)
    try {
      const cursor = cursorOverride !== undefined ? cursorOverride : cursorStack[pageIndex] || null
      const qs = new URLSearchParams({ status:'Posted', limit: String(pageSize) })
      if (term) qs.set('term', term)
      if (payment) qs.set('payment', payment)
      if (cursor) qs.set('cursor', String(cursor))
      const res = await fetch(`/api/admin/food/orders/list?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/food/orders/list')
      if (!json.ok) throw new Error(json.error || 'Failed')
      setOrders(json.orders || [])
      setNextCursor(json.nextCursor || null)
      setSummary(json.summary || null)
      setSelected(new Set())
    } catch (e) {
      setMsg({ type:'error', text:e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders(null) }, [])

  const resetPagination = () => {
    setCursorStack([null])
    setPageIndex(0)
    setNextCursor(null)
  }

  const handleSearch = () => {
    resetPagination()
    fetchOrders(null)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === orders.length) {
      // If all are selected, deselect all
      setSelected(new Set())
    } else {
      // Otherwise, select all
      setSelected(new Set(orders.map(o => o.order_id)))
    }
  }

  const clearSelected = () => {
    setSelected(new Set())
  }

  const money = (n) => `₦${Number(n || 0).toLocaleString()}`
  const orderQty = (o) => (o?.order_lines || []).reduce((s, l) => s + Number(l?.qty || 0), 0)

  const deliverOne = async (order_id) => {
    setShowModal({ 
      type: 'deliver', 
      orderId: order_id, 
      title: 'Deliver Order', 
      message: `Mark order ${order_id} as delivered?`,
      placeholder: 'Delivered by (name or rep)'
    })
    setModalInput('rep')
  }

  const rollbackOne = async (order_id) => {
    setShowModal({
      type: 'rollback',
      orderId: order_id,
      title: 'Rollback Order',
      message: `Rollback order ${order_id} back to Pending?`,
      placeholder: 'Optional reason for rollback',
      toStatus: 'Pending',
    })
    setModalInput('')
  }

  const rollbackSelected = async () => {
    if (selected.size === 0) return
    setShowModal({
      type: 'rollbackMultiple',
      selectedIds: Array.from(selected),
      title: 'Rollback Selected Orders',
      message: `Rollback ${selected.size} selected order(s) back to Pending?`,
      placeholder: 'Optional reason for rollback',
      toStatus: 'Pending',
    })
    setModalInput('')
  }

  const handleRollbackSubmit = async () => {
    const ids = showModal?.type === 'rollbackMultiple' ? showModal?.selectedIds : [showModal?.orderId]
    const orderIds = (ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    if (!orderIds.length) return
    setRollingBack(true)
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch('/api/admin/food/orders/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ orderIds, toStatus: 'Pending', adminId: 'admin@coop', note: modalInput || '' }),
        signal: ctl.signal,
      })
      const json = await safeJson(res, '/api/admin/food/orders/rollback')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Rollback failed')
      const okCount = Number(json?.rolledBack?.length || 0)
      const failCount = Number(json?.failed?.length || 0)
      setMsg({
        type: 'success',
        text: failCount ? `Rolled back ${okCount} order(s), ${failCount} failed` : `Rolled back ${okCount} order(s)`,
      })
      fetchOrders()
      clearSelected()
      setModalInput('')
      setShowModal(null)
      announceRepFoodStats()
    } catch (e) {
      if (e.name === 'AbortError') {
        setMsg({ type: 'error', text: 'Rollback timed out after 8s. Please check network and try again.' })
      } else {
        setMsg({ type: 'error', text: e?.message || 'Rollback failed' })
      }
    } finally {
      setRollingBack(false)
    }
  }

  const handleDeliverSubmit = async () => {
    const deliveredBy = modalInput.trim() || 'rep'
    
    try {
      if (showModal.type === 'deliverMultiple') {
        setDeliveringBulk(true)
        // Handle multiple deliveries
        const { selectedIds } = showModal
        for (const id of selectedIds) {
          const ctl = new AbortController()
          const timer = setTimeout(() => ctl.abort(), 8000)
          const res = await fetch('/api/admin/food/orders/deliver', {
            method:'POST',
            headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
            body: JSON.stringify({ orderId:id, adminId:'admin@coop', deliveredBy }),
            signal: ctl.signal
          })
          const json = await safeJson(res, '/api/admin/food/orders/deliver')
          if (!json.ok) throw new Error(json.error || 'Deliver failed')
          try { clearTimeout(timer) } catch {}
        }
        setMsg({ type:'success', text:`Delivered ${selectedIds.length} order(s)` })
        fetchOrders()
        clearSelected()
        announceRepFoodStats()
      } else {
        setDeliveringOrder(showModal.orderId)
        // Handle single delivery
        const { orderId } = showModal
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 8000)
        const res = await fetch('/api/admin/food/orders/deliver', {
          method:'POST',
          headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify({ orderId, adminId:'admin@coop', deliveredBy }),
          signal: ctl.signal
        })
        const json = await safeJson(res, '/api/admin/food/orders/deliver')
        if (!json.ok) throw new Error(json.error || 'Deliver failed')
        setMsg({ type:'success', text:`Order ${orderId} marked Delivered` })
        setOrders(orders.filter(o => o.order_id !== orderId))
        clearSelected()
        announceRepFoodStats()
      }
      setShowModal(null)
      setModalInput('')
    } catch (e) {
      if (e.name === 'AbortError') {
        setMsg({ type:'error', text:'Delivery request timed out after 8s. Please check network and try again.' })
      } else {
        setMsg({ type:'error', text:e.message })
      }
    } finally {
      setDeliveringOrder(null)
      setDeliveringBulk(false)
      // Ensure modal closes even on error
      setShowModal(null)
    }
  }

  const deliverSelected = async () => {
    if (selected.size === 0) return
    setShowModal({ 
      type: 'deliverMultiple', 
      selectedIds: Array.from(selected),
      title: 'Deliver Selected Orders', 
      message: `Mark ${selected.size} selected order(s) as delivered?`,
      placeholder: 'Delivered by (name or rep)'
    })
    setModalInput('rep')
  }

  const fetchAllForExport = async () => {
    const all = []
    let cursor = null
    let guard = 0
    while (guard < 200) {
      guard += 1
      const qs = new URLSearchParams({ status: 'Posted', limit: '1000' })
      if (term) qs.set('term', term)
      if (payment) qs.set('payment', payment)
      if (cursor) qs.set('cursor', String(cursor))
      const res = await fetch(`/api/admin/food/orders/list?${qs.toString()}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/food/orders/list (export)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders for export')
      const chunk = json.orders || []
      all.push(...chunk)
      if (!json.nextCursor) break
      cursor = json.nextCursor
    }
    return all
  }

  const exportExcel = async () => {
    const srcOrders = await fetchAllForExport().catch(() => [])
    const rows = srcOrders.flatMap((o) => (o.order_lines || []).map((l) => ({
      order_id: o.order_id,
      posted_at: o.posted_at,
      member_id: o.member_id,
      member_name: o.member_name_snapshot,
      member_branch: o.member_branch?.name || '',
      delivery_branch: o.delivery?.name || '',
      department: o.departments?.name || '',
      payment: o.payment_option,
      sku: l.items?.sku,
      item: l.items?.name,
      qty: l.qty,
      unit_price: l.unit_price,
      amount: l.amount,
    })))
    if (!rows.length) { alert('No rows to export') ; return }

    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Posted')

    const headers = Object.keys(rows[0])
    ws.addRow(['Food Distribution · Posted Orders (Admin)'])
    ws.addRow([`Search: ${term || 'All'} | Payment: ${payment || 'All'}`])
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `admin_food_posted_${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = async () => {
    const all = await fetchAllForExport().catch(() => [])
    if (!all.length) {
      alert('No rows to export')
      return
    }
    const sanitize = sanitizePdfText
    const doc = await createManifestDoc({
      title: 'Posted Orders Manifest (Admin)',
      meta: `Search: ${term || 'All'}  |  Payment: ${payment || 'All'}`,
    })

    const headers = ['Order', 'Member', 'Dept', 'Pay', 'SKU', 'Item', 'Qty', 'Unit Price', 'Amount']
    const rows = all.flatMap((o) =>
      (o.order_lines || []).map((l) => [
        sanitize(o.order_id),
        sanitize(o.member_name_snapshot || ''),
        sanitize(o.departments?.name || ''),
        sanitize(o.payment_option || ''),
        sanitize(l.items?.sku || ''),
        sanitize(l.items?.name || ''),
        String(l.qty || 0),
        `NGN ${Number(l.unit_price || 0).toLocaleString()}`,
        `NGN ${Number(l.amount || 0).toLocaleString()}`,
      ])
    )

    await addManifestTable(doc, {
      head: headers,
      body: rows,
      startY: 30,
      columnStyles: {
        0: { cellWidth: 14 }, // Order
        1: { cellWidth: 40 }, // Member
        2: { cellWidth: 28 }, // Dept
        3: { cellWidth: 16 }, // Pay
        4: { cellWidth: 20 }, // SKU
        5: { cellWidth: 58 }, // Item
        6: { cellWidth: 12, halign: 'right' }, // Qty
        7: { cellWidth: 24, halign: 'right' }, // Unit Price
        8: { cellWidth: 26, halign: 'right' }, // Amount
      },
    })

    doc.save(`admin_posted_manifest_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const downloadReceipt = (orderId, memberId) => {
    window.open(`/shop/success/${orderId}?mid=${memberId}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · Posted</h1>
        <p className="text-sm text-muted">Deliver or rollback orders that have been posted.</p>
      </div>

      {/* At-a-glance strip — today's pending queue plus delivered-this-cycle
          progress, mirroring the rep pages. Admin-wide and independent of the
          page's status filter. */}
      {summary && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand">
            <Zap className="h-3.5 w-3.5" strokeWidth={2.2} />
            Today's pending
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtext sm:justify-end">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-fg">
                {(summary.todayPending?.count || 0).toLocaleString()} order{(summary.todayPending?.count || 0) === 1 ? '' : 's'}
              </span>
              <span className="text-line-strong">·</span>
              <span className="font-semibold text-fg">{money(summary.todayPending?.total || 0)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-brand" strokeWidth={2.2} />
              Delivered this cycle
              <span className="font-semibold text-fg">{(summary.deliveredCycle?.count || 0).toLocaleString()}</span>
              <span className="text-line-strong">·</span>
              <span className="font-semibold text-fg">{money(summary.deliveredCycle?.total || 0)}</span>
            </span>
          </span>
        </div>
      )}

      {!!msg && (
        <div
          role="alert"
          className={`mb-4 rounded-xl border p-4 text-sm ${
            msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="ui-card p-4 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
          <div className="flex gap-2 flex-1 min-w-[220px]">
            <input
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              placeholder="Search (Order / Member / Branch)"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={handleKeyPress}
            />
            <button
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
              onClick={handleSearch}
              disabled={loading}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              Search
            </button>
          </div>

          <select className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30" value={payment} onChange={(e) => setPayment(e.target.value)} disabled={loading}>
            <option value="">All payments</option>
            <option value="Savings">Savings</option>
            <option value="Loan">Loan</option>
            <option value="Cash">Cash</option>
          </select>

          <ExportButton
            format="excel"
            onClick={() => exportExcel().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
            disabled={loading}
          />

          <ExportButton
            format="pdf"
            onClick={() => exportPDF().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
            disabled={loading}
          />
        </div>

      </div>

      <div className="ui-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold text-fg">Posted Orders</div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
              onClick={() => fetchOrders(null)}
              disabled={loading}
            >
              <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={selectAll}
              disabled={loading || !orders.length}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selected.size === orders.length && orders.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani disabled:opacity-50 ${
                selected.size === 0 || deliveringBulk ? 'bg-muted' : 'bg-brand hover:bg-brand-hover'
              }`}
              disabled={selected.size === 0 || deliveringBulk}
              onClick={deliverSelected}
            >
              <Truck className="h-3.5 w-3.5" />
              {deliveringBulk ? 'Delivering…' : `Deliver Selected (${selected.size})`}
            </button>
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani disabled:opacity-50 ${
                selected.size === 0 || rollingBack ? 'bg-muted' : 'bg-warning-fg hover:brightness-110'
              }`}
              disabled={selected.size === 0 || rollingBack}
              onClick={rollbackSelected}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {rollingBack ? 'Rolling back…' : `Rollback Selected (${selected.size})`}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value) || 50
                setPageSize(next)
                resetPagination()
                fetchOrders(null)
              }}
              disabled={loading}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                if (pageIndex <= 0) return
                const nextIndex = pageIndex - 1
                const prevCursor = cursorStack[nextIndex] || null
                setPageIndex(nextIndex)
                setSelected(new Set())
                fetchOrders(prevCursor)
              }}
              disabled={pageIndex <= 0 || loading}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <div className="text-sm text-muted">Page <span className="font-medium text-fg">{pageIndex + 1}</span></div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                if (!nextCursor) return
                const nextIndex = pageIndex + 1
                const nextStack = cursorStack.slice(0, pageIndex + 1).concat([nextCursor])
                setCursorStack(nextStack)
                setPageIndex(nextIndex)
                setSelected(new Set())
                fetchOrders(nextCursor)
              }}
              disabled={!nextCursor || loading}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selected.size === orders.length}
                    onChange={selectAll}
                    disabled={loading || !orders.length}
                    className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                  />
                </th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Order</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Member</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Delivery</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Payment</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Qty</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Total + Int</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-line">
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
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                        <Inbox className="h-6 w-6 text-subtext" />
                      </div>
                      <p className="text-sm font-medium text-fg">No Posted orders</p>
                      <p className="text-xs text-muted">Posted orders awaiting delivery will appear here.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.order_id} className="border-b border-line transition-colors duration-150 ease-sakani hover:bg-subtle">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.order_id)}
                        onChange={() => toggleSelect(o.order_id)}
                        className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-fg">#{o.order_id}</div>
                      <div className="text-xs text-subtext">{new Date(o.posted_at || o.created_at).toLocaleString()}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-fg">{o.member_id}</div>
                      <div className="text-muted">{o.member_name_snapshot}</div>
                    </td>
                    <td className="p-3">
                      <div className="text-fg">{o.delivery?.name || '-'}</div>
                      <div className="text-xs text-subtext">{o.departments?.name || '-'}</div>
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg">
                        {o.payment_option}
                      </span>
                    </td>
                    <td className="p-3 text-right">{orderQty(o)}</td>
                    <td className="p-3 text-right font-medium text-fg">{money(o.total_amount)}</td>
                    <td className="p-3 text-right">
                      <select
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
                        defaultValue=""
                        onChange={(e) => {
                          const v = e.target.value
                          e.target.value = ''
                          if (v === 'view') setViewing(o)
                          if (v === 'deliver') deliverOne(o.order_id)
                          if (v === 'rollback') rollbackOne(o.order_id)
                          if (v === 'receipt') downloadReceipt(o.order_id, o.member_id)
                          if (v === 'sheet') setSheetOrder(o)
                        }}
                        disabled={deliveringOrder === o.order_id || loading}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="view">View items</option>
                        <option value="sheet">Print sheet</option>
                        <option value="deliver">Deliver</option>
                        <option value="rollback">Rollback</option>
                        <option value="receipt">Receipt</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Order #${viewing.order_id} items` : 'Order items'}
        widthClass="max-w-4xl w-full mx-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full border border-line text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="border border-line p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">SKU</th>
                <th className="border border-line p-2 text-left text-xs font-semibold uppercase tracking-wide text-subtext">Item</th>
                <th className="border border-line p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Qty</th>
                <th className="border border-line p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Unit Price</th>
                <th className="border border-line p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(viewing?.order_lines || []).map((l) => (
                <tr key={l.id} className="transition-colors duration-150 ease-sakani hover:bg-subtle">
                  <td className="border border-line p-2">{l.items?.sku}</td>
                  <td className="break-words border border-line p-2">{l.items?.name}</td>
                  <td className="border border-line p-2 text-right">{l.qty}</td>
                  <td className="border border-line p-2 text-right">{money(l.unit_price)}</td>
                  <td className="border border-line p-2 text-right">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DraggableModal>

      <DraggableModal
        open={!!showModal}
        onClose={() => {
          setShowModal(null)
          setModalInput('')
        }}
        title={showModal?.title || 'Confirm'}
        overlayClassName="bg-black/40"
        widthClass="max-w-md w-full mx-4"
        footer={
          <div className="flex gap-2 justify-end">
            <button
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
              onClick={() => {
                setShowModal(null)
                setModalInput('')
              }}
              disabled={deliveringBulk || deliveringOrder != null || rollingBack}
            >
              Cancel
            </button>
            <button
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani ${
                showModal?.type?.startsWith('rollback') ? 'bg-warning-fg hover:brightness-110' : 'bg-brand hover:bg-brand-hover'
              } disabled:opacity-50`}
              onClick={showModal?.type?.startsWith('rollback') ? handleRollbackSubmit : handleDeliverSubmit}
              disabled={deliveringBulk || deliveringOrder != null || rollingBack}
            >
              {showModal?.type?.startsWith('rollback') ? (rollingBack ? 'Rolling back…' : 'Rollback') : deliveringBulk || deliveringOrder != null ? 'Delivering…' : 'Deliver'}
            </button>
          </div>
        }
      >
        <p className="mb-4 text-sm text-muted">{showModal?.message}</p>
        <input
          type="text"
          value={modalInput}
          onChange={(e) => setModalInput(e.target.value)}
          placeholder={showModal?.placeholder || ''}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          autoFocus
        />
      </DraggableModal>

      {/* Print-optimized order sheet — hand this to the packer/delivery team */}
      <PrintOrderSheet
        open={!!sheetOrder}
        onClose={() => setSheetOrder(null)}
        module="food"
        order={sheetOrder}
      />
    </div>
  )
}

export default function PostedAdminPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <PostedAdminPageContent />
    </ProtectedRoute>
  )
}
