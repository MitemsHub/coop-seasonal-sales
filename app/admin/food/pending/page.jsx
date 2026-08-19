// app/admin/pending/page.jsx
'use client'
import { useEffect, useMemo, useState, useRef } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import DraggableModal from '../../../components/DraggableModal'
import ExportButton from '../../../components/ui/ExportButton'
import PrintOrderSheet from '../../../components/PrintOrderSheet'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../../lib/pdfExport'
import { announceRepFoodStats } from '../../../lib/repFoodStatsSync'
import { CheckSquare, ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw, Send, Truck, XCircle, Zap } from 'lucide-react'

export function FoodOrdersAdminPageContent({ status = 'Pending' }) {
  const [orders, setOrders] = useState([])
  const [branches, setBranches] = useState([])
  const [term, setTerm] = useState('')
  const [payment, setPayment] = useState('')
  const [deliveryBranch, setDeliveryBranch] = useState('')
  const [memberCategory, setMemberCategory] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [cursorStack, setCursorStack] = useState([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [summary, setSummary] = useState(null)
  const [postingOrder, setPostingOrder] = useState(null) // Track which order is being posted
  const [postingBulk, setPostingBulk] = useState(false) // Track bulk posting
  const [savingEdit, setSavingEdit] = useState(false) // Track edit saving
  const [selected, setSelected] = useState(new Set())
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(null)
  const [modalInput, setModalInput] = useState('')
  const [cancellingOrder, setCancellingOrder] = useState(false)
  const [restoringOrders, setRestoringOrders] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [sheetOrder, setSheetOrder] = useState(null) // order row for the print sheet
  const fetchCtl = useRef(null)
  // Draggable modal now handled by reusable component

  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  useEffect(() => {
    const loadBranches = async () => {
      try {
        const res = await fetch('/api/branches/list', { cache: 'no-store' })
        const json = await safeJson(res, '/api/branches/list')
        if (json?.ok) setBranches(Array.isArray(json.branches) ? json.branches : [])
      } catch {
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  const normalizeMemberCategory = (raw) => {
    const s = String(raw || '').trim().toLowerCase()
    if (!s) return ''
    if (s === 'a' || s.includes('active')) return 'A'
    if (s === 'r' || s.includes('retire')) return 'R'
    if (s === 'p' || s.includes('pension')) return 'P'
    if (s === 'e' || s.includes('staff')) return 'E'
    return ''
  }

  const fetchOrders = async (cursorOverride, overrides = null) => {
    setLoading(true); setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const effTerm = overrides && typeof overrides.term === 'string' ? overrides.term : term
      const effPayment = overrides && typeof overrides.payment === 'string' ? overrides.payment : payment
      const effDeliveryBranch = overrides && typeof overrides.deliveryBranch === 'string' ? overrides.deliveryBranch : deliveryBranch
      const effMemberCategory = overrides && typeof overrides.memberCategory === 'string' ? overrides.memberCategory : memberCategory
      const cursor = cursorOverride !== undefined ? cursorOverride : cursorStack[pageIndex] || null
      const qs = new URLSearchParams({
        status,
        limit: String(pageSize),
        ...(effTerm ? { term: effTerm } : {}),
        ...(effPayment ? { payment: effPayment } : {}),
      })
      if (status === 'Cancelled') {
        if (effDeliveryBranch) qs.set('branch', String(effDeliveryBranch).trim().toUpperCase())
        const cat = normalizeMemberCategory(effMemberCategory)
        if (cat) qs.set('member_category', cat)
      }
      if (cursor) qs.set('cursor', String(cursor))
      const res = await fetch(`/api/admin/food/orders/list?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/admin/food/orders/list')
      if (!json.ok) throw new Error(json.error || 'Failed to load')
      setOrders(json.orders || [])
      setNextCursor(json.nextCursor || null)
      setSummary(json.summary || null)
      setSelected(new Set())
    } catch (e) {
      if (e.name === 'AbortError') {
        // Ignore aborted fetches triggered by navigation or refresh
      } else {
        setMsg({ type:'error', text:e.message })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders(null) }, []) // first load

  const resetPagination = () => {
    setCursorStack([null])
    setPageIndex(0)
    setNextCursor(null)
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

  const handleSearch = () => {
    resetPagination()
    fetchOrders(null)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const money = (n) => `₦${Number(n || 0).toLocaleString()}`
  const orderQty = (o) => (o?.order_lines || []).reduce((s, l) => s + Number(l?.qty || 0), 0)

  const fetchAllForExport = async () => {
    if (status !== 'Pending') return []
    const all = []
    let cursor = null
    let guard = 0
    while (guard < 200) {
      guard += 1
      const qs = new URLSearchParams({
        status,
        limit: '1000',
        ...(term ? { term } : {}),
        ...(payment ? { payment } : {}),
      })
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

  // Actions with prompts
  const doPost = async (order_id) => {
    if (status !== 'Pending') return
    setShowModal({ type: 'post', orderId: order_id, title: 'Post Order', placeholder: 'Optional note for posting (leave blank if none)' })
    setModalInput('')
  }

  const handlePostSubmit = async () => {
    const { orderId } = showModal
    setPostingOrder(orderId)
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch('/api/admin/food/orders/post', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ orderId, adminId:'admin@coop', adminNote: modalInput || '' }),
        signal: ctl.signal
      })
      const json = await safeJson(res, '/api/admin/food/orders/post')
      if (!json.ok) throw new Error(json.error || 'Post failed')
      setMsg({ type:'success', text:`Order ${orderId} posted` })
      fetchOrders(); setSelected(new Set())
      setModalInput('')
      announceRepFoodStats()
    } catch (e) {
      if (e.name === 'AbortError') {
        setMsg({ type:'error', text:'Post timed out after 8s. Please check network and try again.' })
      } else {
        setMsg({ type:'error', text:e.message })
      }
    } finally {
      try { clearTimeout(timer) } catch {}
      setPostingOrder(null)
      setShowModal(null)
    }
  }

  const postSelected = async () => {
    if (status !== 'Pending') return
    if (selected.size === 0) return
    setShowModal({ type: 'bulk-post', orderIds: Array.from(selected), title: 'Bulk Post Orders', placeholder: 'Optional note for posting these orders' })
    setModalInput('')
  }

  const handleBulkPostSubmit = async () => {
    const { orderIds } = showModal
    setPostingBulk(true)
    try {
      // Use optimized bulk post API
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch('/api/admin/food/orders/post-bulk', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ orderIds, adminId:'admin@coop' }),
        signal: ctl.signal
      })
      const json = await safeJson(res, '/api/admin/food/orders/post-bulk')
      if (!json.ok) throw new Error(json.error || 'Bulk post failed')

      // Handle admin notes for successfully posted orders
      if (modalInput && Array.isArray(json.posted) && json.posted.length > 0) {
        // Update admin notes in parallel for better performance
        const notePromises = json.posted.map(id =>
          fetch('/api/admin/food/orders/post', {
            method:'POST',
            headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
            body: JSON.stringify({ orderId:id, adminId:'admin@coop', adminNote: modalInput })
          })
        )
        await Promise.all(notePromises)
      }

      // Show detailed results
      let message = `Posted ${json.posted?.length || 0} order(s)`
      if (json.failed?.length > 0) {
        const reasons = json.failed.slice(0, 5).map(f => `#${f.order_id}: ${f.error}`).join('; ')
        message += `, ${json.failed.length} failed: ${reasons}`
      }

      setMsg({ type:'success', text: message })
      fetchOrders(); setSelected(new Set())
      setModalInput('')
      announceRepFoodStats()
    } catch (e) {
      if (e.name === 'AbortError') {
        setMsg({ type:'error', text:'Bulk post timed out after 8s. Please check network and try again.' })
      } else {
        setMsg({ type:'error', text:e.message })
      }
    } finally {
      try { clearTimeout(timer) } catch {}
      setPostingBulk(false)
      setShowModal(null)
    }
  }

  const openCancelModal = async (orderIds) => {
    const ids = (Array.isArray(orderIds) ? orderIds : []).filter((n) => Number.isFinite(Number(n)) && Number(n) > 0).map((n) => Number(n))
    if (!ids.length) return
    setShowModal({ 
      type: 'cancel', 
      orderIds: ids,
      title: ids.length > 1 ? 'Cancel Orders' : 'Cancel Order', 
      message: ids.length > 1
        ? `Cancel ${ids.length} order(s)? Cancelled orders will be excluded from reports and exports.`
        : `Cancel order ${ids[0]}? Cancelled orders will be excluded from reports and exports.`,
      placeholder: 'Optional reason for cancellation'
    })
    setModalInput('')
  }

  const doCancel = async (order_id) => {
    if (status !== 'Pending') return
    openCancelModal([order_id])
  }

  const cancelSelected = async () => {
    if (status !== 'Pending') return
    if (selected.size === 0) return
    openCancelModal(Array.from(selected))
  }

  const handleCancelSubmit = async () => {
    const ids = Array.isArray(showModal?.orderIds) ? showModal.orderIds : []
    if (!ids.length) return
    setCancellingOrder(true)
    try {
      const res = await fetch('/api/admin/food/orders/cancel', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ orderIds: ids, reason: modalInput || 'Cancelled by admin' })
      })
      const json = await safeJson(res, '/api/admin/food/orders/cancel')
      if (!json.ok) throw new Error(json.error || 'Cancel failed')
      const cancelled = Array.isArray(json.cancelled) ? json.cancelled : []
      setMsg({ type:'success', text: `Cancelled ${cancelled.length} order(s)` })
      fetchOrders(); setSelected(new Set())
      setShowModal(null)
      setModalInput('')
      announceRepFoodStats()
    } catch (e) {
      setMsg({ type:'error', text:e.message })
    } finally {
      setCancellingOrder(false)
    }
  }

  const openRestoreModal = async (orderIds) => {
    const ids = (Array.isArray(orderIds) ? orderIds : []).filter((n) => Number.isFinite(Number(n)) && Number(n) > 0).map((n) => Number(n))
    if (!ids.length) return
    setShowModal({
      type: 'restore',
      orderIds: ids,
      title: ids.length > 1 ? 'Restore Orders' : 'Restore Order',
      message: ids.length > 1
        ? `Restore ${ids.length} order(s) back to Pending?`
        : `Restore order ${ids[0]} back to Pending?`,
      placeholder: 'Optional note (not saved)'
    })
    setModalInput('')
  }

  const doRestore = async (order_id) => {
    if (status !== 'Cancelled') return
    openRestoreModal([order_id])
  }

  const restoreSelected = async () => {
    if (status !== 'Cancelled') return
    if (selected.size === 0) return
    openRestoreModal(Array.from(selected))
  }

  const handleRestoreSubmit = async () => {
    const ids = Array.isArray(showModal?.orderIds) ? showModal.orderIds : []
    if (!ids.length) return
    setRestoringOrders(true)
    try {
      const res = await fetch('/api/admin/food/orders/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids }),
      })
      const json = await safeJson(res, '/api/admin/food/orders/restore')
      if (!json.ok) throw new Error(json.error || 'Restore failed')
      const restored = Array.isArray(json.restored) ? json.restored : []
      setMsg({ type: 'success', text: `Restored ${restored.length} order(s)` })
      fetchOrders()
      setSelected(new Set())
      setShowModal(null)
      setModalInput('')
      announceRepFoodStats()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setRestoringOrders(false)
    }
  }

  // Edit modal logic (unchanged)
  const startEdit = (o) => {
    if (status !== 'Pending') return
    const lines = (o.order_lines || []).map(l => ({
      sku: l.items?.sku,
      name: l.items?.name,
      qty: l.qty,
      price: Number(l.unit_price)
    }))
    setEditing({ order_id: o.order_id, lines })
  }
  const setEditQty = (idx, val) => {
    setEditing(prev => {
      const next = { ...prev }
      const n = Math.max(0, Math.min(9999, Number(val) || 0))
      next.lines = next.lines.slice()
      next.lines[idx] = { ...next.lines[idx], qty: n }
      return next
    })
  }
  const editedTotal = useMemo(() => editing?.lines?.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0) || 0, [editing])
  const saveEdit = async () => {
    setSavingEdit(true)
    try {
      const payload = editing.lines.filter(l => Number(l.qty) > 0).map(l => ({ sku: l.sku, qty: Number(l.qty) }))
      if (!payload.length) throw new Error('At least one line qty > 0 required')
      const res = await fetch('/api/admin/food/orders/update-lines', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ orderId: editing.order_id, lines: payload })
      })
      const json = await safeJson(res, '/api/admin/food/orders/update-lines')
      if (!json.ok) throw new Error(json.error || 'Update failed')
      setMsg({ type:'success', text:`Order ${editing.order_id} updated` })
      setEditing(null)
      fetchOrders()
    } catch (e) {
      setMsg({ type:'error', text:e.message })
    } finally {
      setSavingEdit(false)
    }
  }

  const exportExcel = async () => {
    const srcOrders = await fetchAllForExport().catch(() => [])
    const rows = srcOrders.flatMap((o) => (o.order_lines || []).map((l) => ({
      order_id: o.order_id,
      created_at: o.created_at,
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
    const ws = wb.addWorksheet('Pending')

    const headers = Object.keys(rows[0])
    ws.addRow(['Food Distribution · Pending Orders (Admin)'])
    ws.addRow([`Search: ${term || 'All'} | Payment: ${payment || 'All'}`])
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `admin_food_pending_${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Export PDF manifest including Unit Price and Amount
  const exportPDF = async () => {
    const srcOrders = await fetchAllForExport().catch(() => [])
    if (!srcOrders.length) {
      alert('No rows to export')
      return
    }
    const sanitize = sanitizePdfText
    const doc = await createManifestDoc({
      title: 'Pending Orders Manifest (Admin)',
      meta: `Search: ${term || 'All'}  |  Payment: ${payment || 'All'}`,
    })

    const headers = ['Order', 'Member', 'Dept', 'Pay', 'SKU', 'Item', 'Qty', 'Unit Price', 'Amount']
    const rows = srcOrders.flatMap((o) =>
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

    doc.save(`admin_pending_manifest_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · {status}</h1>
        <p className="text-sm text-muted">Browse, filter, post and manage {status.toLowerCase()} orders.</p>
      </div>

      {/* At-a-glance strip — today's pending queue plus delivered-this-cycle
          progress, mirroring the rep pages. Admin-wide and independent of the
          page's status filter. Only on the actionable Pending view (the
          component is shared with the Cancelled page). */}
      {status === 'Pending' && summary && (
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
        <div className="flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[420px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Search (Order / Member / Branch)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={handleKeyPress}
              />
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
                onClick={handleSearch}
                disabled={loading}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
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
                  resetPagination()
                  fetchOrders(null, { payment: next })
                }}
                disabled={loading}
              >
                <option value="">All payments</option>
                <option value="Savings">Savings</option>
                <option value="Loan">Loan</option>
                <option value="Cash">Cash</option>
              </select>

              {status === 'Cancelled' && (
                <>
                  <select
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                    value={deliveryBranch}
                    onChange={(e) => {
                      const next = e.target.value
                      setDeliveryBranch(next)
                      resetPagination()
                      fetchOrders(null, { deliveryBranch: next })
                    }}
                    disabled={loading}
                  >
                    <option value="">All delivery branches</option>
                    {(branches || []).map((b) => (
                      <option key={b.code} value={String(b.code || '').toUpperCase()}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                    placeholder="Member category (e.g. Pensioner)"
                    value={memberCategory}
                    onChange={(e) => {
                      const next = e.target.value
                      setMemberCategory(next)
                      resetPagination()
                      fetchOrders(null, { memberCategory: next })
                    }}
                    disabled={loading}
                  />
                </>
              )}

              {status === 'Pending' && (
                <>
                  <ExportButton
                    format="excel"
                    onClick={() => exportExcel().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
                    disabled={loading || !orders.length}
                  />

                  <ExportButton
                    format="pdf"
                    onClick={() => exportPDF().catch((e) => setMsg({ type: 'error', text: e?.message || 'Export failed' }))}
                    disabled={loading || !orders.length}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 text-sm text-muted">
          Total: <span className="font-medium text-fg">{money(orders.reduce((s, o) => s + Number(o.total_amount || 0), 0))}</span>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold text-fg">{status} Orders</div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
              onClick={() => fetchOrders(null)}
              disabled={loading}
            >
              <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} />
              <span>{loading ? 'Loading…' : 'Refresh'}</span>
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
            {status === 'Pending' && (
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-success-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
                disabled={selected.size === 0 || postingBulk}
                onClick={postSelected}
              >
                <Send className="h-3.5 w-3.5" />
                {postingBulk ? 'Posting…' : `Post Selected (${selected.size})`}
              </button>
            )}
            {status === 'Pending' ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
                disabled={selected.size === 0 || cancellingOrder}
                onClick={cancelSelected}
              >
                <XCircle className="h-3.5 w-3.5" />
                {cancellingOrder ? 'Cancelling…' : `Cancel Selected (${selected.size})`}
              </button>
            ) : (
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                disabled={selected.size === 0 || restoringOrders}
                onClick={restoreSelected}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {restoringOrders ? 'Restoring…' : `Restore Selected (${selected.size})`}
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
                      <p className="text-sm font-medium text-fg">No {status} orders</p>
                      <p className="text-xs text-muted">When members place orders, they will appear here.</p>
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
                      <div className="text-xs text-subtext">{new Date(o.created_at).toLocaleString()}</div>
                      {status === 'Cancelled' ? (
                        <>
                          <div className="text-xs text-subtext">
                            Cancelled: {o.cancelled_at ? new Date(o.cancelled_at).toLocaleString() : '—'}
                          </div>
                          <div className="text-xs text-subtext break-words">
                            Reason: {String(o.cancelled_reason || '').trim() || '—'}
                          </div>
                        </>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-fg">{o.member_id}</div>
                      <div className="text-muted">{o.member_name_snapshot}</div>
                      <div className="text-xs text-subtext">{o.member_branch?.name || '-'}</div>
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
                          if (v === 'edit') startEdit(o)
                          if (v === 'post') doPost(o.order_id)
                          if (v === 'cancel') doCancel(o.order_id)
                          if (v === 'restore') doRestore(o.order_id)
                          if (v === 'sheet') setSheetOrder(o)
                        }}
                        disabled={loading}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="view">View items</option>
                        <option value="sheet">Print sheet</option>
                        {status === 'Pending' ? (
                          <>
                            <option value="edit">Edit</option>
                            <option value="post">Post</option>
                            <option value="cancel">Cancel</option>
                          </>
                        ) : (
                          <option value="restore">Restore</option>
                        )}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal (consistent draggable style) */}
      {editing && (
        <DraggableModal
          open={!!editing}
          title={`Edit Order #${editing.order_id}`}
          onClose={() => setEditing(null)}
          overlayClassName="bg-black/40"
          widthClass="max-w-2xl w-full mx-4"
          footer={(
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
              >
                Cancel
              </button>
              <button
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani ${
                  savingEdit ? 'cursor-not-allowed bg-muted' : 'bg-brand hover:bg-brand-hover'
                }`}
                onClick={saveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <div className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-on-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </div>
                ) : 'Save'}
              </button>
            </div>
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm border mb-3">
              <thead className="bg-subtle">
                <tr>
                  <th className="border border-line p-1 text-left text-xs font-semibold uppercase tracking-wide text-subtext sm:p-2">SKU</th>
                  <th className="border border-line p-1 text-left text-xs font-semibold uppercase tracking-wide text-subtext sm:p-2">Item</th>
                  <th className="border border-line p-1 text-right text-xs font-semibold uppercase tracking-wide text-subtext sm:p-2">Qty</th>
                  <th className="border border-line p-1 text-right text-xs font-semibold uppercase tracking-wide text-subtext sm:p-2">Unit Price</th>
                  <th className="border border-line p-1 text-right text-xs font-semibold uppercase tracking-wide text-subtext sm:p-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {editing.lines.map((l, idx) => (
                  <tr key={l.sku}>
                    <td className="p-1 sm:p-2 border text-xs">{l.sku}</td>
                    <td className="p-1 sm:p-2 border text-xs break-words">{l.name}</td>
                    <td className="p-1 sm:p-2 border text-right">
                      <input type="number" min={0} value={l.qty} onChange={e=>setEditQty(idx, e.target.value)} className="w-16 rounded-md border border-line bg-surface px-1 py-1 text-right text-xs text-fg placeholder:text-subtext focus:border-brand focus:outline-none sm:w-20" />
                    </td>
                    <td className="p-1 sm:p-2 border text-right text-xs">₦{l.price.toLocaleString()}</td>
                    <td className="p-1 sm:p-2 border text-right text-xs">₦{(Number(l.qty) * l.price).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <div className="text-sm text-muted">New Total</div>
            <div className="text-[15px] font-semibold text-fg">₦{editedTotal.toLocaleString()}</div>
          </div>
        </DraggableModal>
      )}
      
      {/* Modal for input prompts */}
      {showModal && (
        <DraggableModal
          open={!!showModal}
          title={showModal.title}
          onClose={() => { setShowModal(null); setModalInput('') }}
          overlayClassName="bg-black/40"
          footer={(
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowModal(null); setModalInput('') }}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
              >
                Cancel
              </button>
              <button
                onClick={
                  showModal.type === 'post'
                    ? handlePostSubmit
                    : showModal.type === 'bulk-post'
                      ? handleBulkPostSubmit
                      : showModal.type === 'cancel'
                        ? handleCancelSubmit
                        : handleRestoreSubmit
                }
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani ${
                  showModal.type === 'cancel'
                    ? 'bg-danger-fg hover:brightness-110'
                    : 'bg-brand hover:bg-brand-hover'
                }`}
                disabled={
                  showModal.type === 'post'
                    ? postingOrder === showModal.orderId
                    : showModal.type === 'bulk-post'
                      ? postingBulk
                      : showModal.type === 'cancel'
                        ? cancellingOrder
                        : restoringOrders
                }
              >
                {showModal.type === 'post' ? (
                  postingOrder === showModal.orderId ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-on-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Posting...
                    </div>
                  ) : 'Post Order'
                ) : showModal.type === 'bulk-post' ? (
                  postingBulk ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-on-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Posting...
                    </div>
                  ) : 'Post Orders'
                ) : showModal.type === 'cancel' ? (
                  cancellingOrder ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-on-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Cancelling...
                    </div>
                  ) : 'Cancel'
                ) : (
                  restoringOrders ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-on-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Restoring...
                    </div>
                  ) : 'Restore'
                )}
              </button>
            </div>
          )}
        >
          <p className="mb-4 text-sm text-muted">
            {showModal.message ||
              (showModal.type === 'post'
                ? `Post order ${showModal.orderId}?`
                : showModal.type === 'bulk-post'
                  ? `Post ${showModal.orderIds?.length || 0} order(s)?`
                  : showModal.type === 'cancel'
                    ? `Cancel ${showModal.orderIds?.length || 0} order(s)?`
                    : `Restore ${showModal.orderIds?.length || 0} order(s)?`)}
          </p>
          <input
            type="text"
            value={modalInput}
            onChange={(e) => setModalInput(e.target.value)}
            placeholder={showModal.placeholder}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            autoFocus
          />
        </DraggableModal>
      )}
      <DraggableModal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Order #${viewing.order_id} items` : 'Order items'}
        widthClass="max-w-4xl w-full mx-4"
      >
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[560px] border border-line text-sm">
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
                  <td className="break-all border border-line p-2 font-mono text-xs">{l.items?.sku}</td>
                  <td className="break-words border border-line p-2 min-w-[220px]">{l.items?.name}</td>
                  <td className="border border-line p-2 text-right whitespace-nowrap">{l.qty}</td>
                  <td className="border border-line p-2 text-right whitespace-nowrap">{money(l.unit_price)}</td>
                  <td className="border border-line p-2 text-right whitespace-nowrap">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

export default function PendingAdminPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <FoodOrdersAdminPageContent status="Pending" />
    </ProtectedRoute>
  )
}
