'use client'

// app/admin/exhibition/orders-content.jsx
// Shared admin content for the four exhibition order views (Pending,
// Approved, Delivered, Cancelled). Approve happens here (admin = superuser);
// delivered is marked by vendors; cancelled orders can be restored.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronLeft, ChevronRight, History, Inbox, Package, PackageCheck, RefreshCw, RotateCcw, Search, Store, Truck, XCircle } from 'lucide-react'
import Badge from '../../components/ui/Badge'
import ExportButton from '../../components/ui/ExportButton'
import DraggableModal from '../../components/DraggableModal'
import PrintOrderSheet from '../../components/PrintOrderSheet'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../lib/pdfExport'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

const STATUS_TONE = { Pending: 'warning', Approved: 'info', Delivered: 'success', Cancelled: 'danger' }

const AUDIT_ICON = {
  'Order placed': { Icon: Package, iconCls: 'text-muted', tileCls: 'bg-subtle' },
  Approved: { Icon: CheckCircle2, iconCls: 'text-success', tileCls: 'bg-success-bg' },
  Cancelled: { Icon: XCircle, iconCls: 'text-danger', tileCls: 'bg-danger-bg' },
  Restored: { Icon: RotateCcw, iconCls: 'text-brand', tileCls: 'bg-brand-subtle' },
  Delivered: { Icon: Truck, iconCls: 'text-success', tileCls: 'bg-success-bg' },
}

const toastMotion = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function ExhibitionOrdersContent({ status = 'Pending' }) {
  const [orders, setOrders] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [cycles, setCycles] = useState([])
  const [cycleFilter, setCycleFilter] = useState('')
  const [payment, setPayment] = useState('')
  const [term, setTerm] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState('')
  const [modal, setModal] = useState(null) // { type: 'approve'|'cancel'|'restore', ids }
  const [cancelReason, setCancelReason] = useState('')
  const [vendorBreakdown, setVendorBreakdown] = useState(null)
  const [auditOrder, setAuditOrder] = useState(null) // { id, order_id, created_at, member_id }
  const [auditEvents, setAuditEvents] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [sheetOrder, setSheetOrder] = useState(null) // order row for the print sheet
  const fetchCtl = useRef(null)
  // Whether the default active-cycle scope has been applied (once on mount)
  // and the last cycle the admin picked — so an explicit "All cycles" or
  // other selection is never overridden by the default.
  const cycleDefaultedRef = useRef(false)
  const cycleFilterRef = useRef('')

  useEffect(() => {
    cycleFilterRef.current = cycleFilter
  }, [cycleFilter])

  const safeJson = useCallback(async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }, [])

  const fetchOrders = useCallback(
    async (opts = {}) => {
      setLoading(true)
      setMsg(null)
      try {
        if (fetchCtl.current) fetchCtl.current.abort()
        const ctl = new AbortController()
        fetchCtl.current = ctl
        const nextPage = Number(opts.page ?? page)
        const nextPageSize = Number(opts.pageSize ?? pageSize)
        const nextTerm = typeof opts.term === 'string' ? opts.term : term
        const nextPayment = typeof opts.payment === 'string' ? opts.payment : payment
        const nextCycle = typeof opts.cycle === 'string' ? opts.cycle : cycleFilter
        const qs = new URLSearchParams({
          status,
          limit: String(Math.max(1, nextPageSize)),
          offset: String(Math.max(0, (nextPage - 1) * nextPageSize)),
          ...(nextTerm ? { q: nextTerm } : {}),
          ...(nextPayment ? { payment: nextPayment } : {}),
          ...(nextCycle ? { cycle_id: nextCycle } : {}),
        })
        const res = await fetch(`/api/admin/exhibition/orders?${qs}`, { cache: 'no-store', signal: ctl.signal })
        const json = await safeJson(res, '/api/admin/exhibition/orders')
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
        const rows = json.orders || []
        setOrders(rows)
        setTotalCount(Number(json.total ?? rows.length))
        setSelected(new Set())
      } catch (e) {
        if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      } finally {
        setLoading(false)
      }
    },
    [status, page, pageSize, term, payment, cycleFilter, safeJson]
  )

  // Per-vendor handover breakdown across all branches — which vendors still
  // owe goods on approved orders. Only meaningful on the Approved view.
  const fetchVendorBreakdown = useCallback(async () => {
    if (status !== 'Approved') return
    try {
      const qs = cycleFilter ? `?cycle_id=${encodeURIComponent(cycleFilter)}` : ''
      const res = await fetch(`/api/admin/exhibition/vendors/breakdown${qs}`, { cache: 'no-store' })
      const json = await safeJson(res, 'vendor breakdown')
      if (res.ok && json?.ok) setVendorBreakdown(json)
    } catch {
      // The panel is best-effort — never block the page on it.
    }
  }, [status, cycleFilter, safeJson])

  const fetchCycles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/exhibition/cycles', { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/exhibition/cycles')
      if (json?.ok) {
        const list = json.cycles || []
        setCycles(list)
        // Default the view + exports to the most-recent ACTIVE cycle (the
        // current season), mirroring the rep-side scoping — unless the admin
        // already picked a cycle. The API returns cycles newest-first, so the
        // first active row is the current period.
        if (!cycleDefaultedRef.current && !cycleFilterRef.current) {
          const active = list.find((c) => c.status === 'active')
          if (active) {
            cycleDefaultedRef.current = true
            setCycleFilter(String(active.id))
            fetchOrders({ page: 1, cycle: String(active.id) })
            fetchVendorBreakdown()
          }
        }
      }
    } catch {
      setCycles([])
    }
  }, [safeJson, fetchOrders, fetchVendorBreakdown])

  useEffect(() => {
    fetchCycles()
    fetchOrders({ page: 1 })
    fetchVendorBreakdown()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  }, [page, safePage, fetchOrders])

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const ids = pagedOrders.map((o) => o.id)
    if (!ids.length) return
    const allSelected = ids.every((id) => selected.has(id))
    setSelected(allSelected ? new Set() : new Set(ids))
  }

  // ── Actions ─────────────────────────────────────────────────────

  // Audit trail for one order — who approved/cancelled/restored/delivered it.
  // Reuses the admin exhibition audit endpoint (same lens the admin Audit Log
  // page uses) so the Activity modal matches the rep portal's exactly.
  const openAudit = useCallback(async (o) => {
    setAuditOrder(o)
    setAuditEvents([])
    setAuditError('')
    setAuditLoading(true)
    try {
      const res = await fetch(`/api/admin/exhibition/audit?order_id=${o.id}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/exhibition/audit')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load activity')
      setAuditEvents(json.events || [])
    } catch (e) {
      setAuditError(e?.message || 'Failed to load activity')
    } finally {
      setAuditLoading(false)
    }
  }, [safeJson])

  // Timeline: the order's placement (synthesised from the row) + logged events.
  const auditItems = useMemo(() => {
    const items = []
    if (auditOrder?.created_at) {
      items.push({
        key: 'placed',
        action: 'Order placed',
        actorLabel: String(auditOrder.member_id || 'Member'),
        note: '',
        created_at: auditOrder.created_at,
      })
    }
    for (const ev of auditEvents) {
      items.push({
        key: ev.id ?? `${ev.action}-${ev.created_at}`,
        action: ev.action,
        actorLabel: String(ev.actor_label || 'Unknown'),
        note: String(ev.note || ''),
        created_at: ev.created_at,
      })
    }
    return items
  }, [auditOrder, auditEvents])

  const runAction = async (type, ids, reason) => {
    if (!ids.length) return
    setBulkBusy(true)
    setMsg(null)
    try {
      const path =
        type === 'approve'
          ? '/api/admin/exhibition/orders/approve'
          : type === 'cancel'
            ? '/api/admin/exhibition/orders/cancel'
            : type === 'deliver'
              ? '/api/admin/exhibition/orders/deliver'
              : '/api/admin/exhibition/orders/restore'
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(type === 'cancel' ? { ids, reason: reason || 'Cancelled by admin' } : { ids }),
      })
      const json = await safeJson(res, path)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Action failed')
      const done = (json.approved || json.cancelled || json.delivered || json.restored || [])
      const skipped = (json.failed || []).length
      setOrders((prev) => (prev || []).filter((o) => !done.includes(o.id)))
      setSelected(new Set())
      setModal(null)
      setCancelReason('')
      setMsg({
        type: 'success',
        text: `${done.length} order(s) ${type === 'approve' ? 'approved' : type === 'cancel' ? 'cancelled' : type === 'deliver' ? 'delivered' : 'restored'}${
          skipped ? ` · ${skipped} skipped` : ''
        }`,
      })
      fetchOrders({ page: safePage })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Action failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  // ── Exports ─────────────────────────────────────────────────────

  // The export reflects whatever period the filter shows (default: the active
  // cycle). Filenames carry a slug of the cycle so downloads are identifiable.
  const exportCycleName = cycleFilter
    ? cycles.find((c) => String(c.id) === String(cycleFilter))?.name || cycleFilter
    : ''
  const exportCycleSlug = String(exportCycleName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const fetchAllForExport = async () => {
    const all = []
    let offset = 0
    const batch = 500
    while (true) {
      const qs = new URLSearchParams({
        status,
        limit: String(batch),
        offset: String(offset),
        ...(term ? { q: term } : {}),
        ...(payment ? { payment } : {}),
        ...(cycleFilter ? { cycle_id: cycleFilter } : {}),
      })
      const res = await fetch(`/api/admin/exhibition/orders?${qs}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/admin/exhibition/orders (export)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders for export')
      const chunk = json.orders || []
      all.push(...chunk)
      if (chunk.length < batch) break
      offset += batch
      if (offset > 5000) break
    }
    return all
  }

  const exportExcel = async () => {
    setExportBusy('excel')
    try {
      const rows = await fetchAllForExport()
      if (!rows.length) return
      const flat = rows.map((o) => ({
        order_id: o.order_id,
        id: o.id,
        created_at: o.created_at,
        member_id: o.member_id,
        member_name: o.member_name_snapshot || '',
        branch: o.branch_name || '',
        cycle: o.cycle_name || o.cycle_code || '',
        payment: o.payment_option || '',
        total_qty: o.total_qty,
        total_amount: o.total_amount,
        status: o.status,
        vendors: o.per_vendor.map((v) => `${v.vendor_name} (${v.qty})`).join(', '),
      }))
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(status)
      ws.addRow([`Coop Exhibition · ${status} Orders (Admin)`])
      ws.addRow([`Cycle: ${cycleFilter ? cycles.find((c) => String(c.id) === String(cycleFilter))?.name || cycleFilter : 'All'} | Payment: ${payment || 'All'} | Search: ${term || 'All'}`])
      const headers = Object.keys(flat[0] || { id: '' })
      ws.addRow(headers)
      for (const r of flat) ws.addRow(headers.map((h) => r[h]))
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `admin_exhibition_${status.toLowerCase()}_${exportCycleSlug || 'all'}_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Export failed' })
    } finally {
      setExportBusy('')
    }
  }

  const exportPDF = async () => {
    setExportBusy('pdf')
    try {
      const rows = await fetchAllForExport()
      if (!rows.length) return
      const sanitize = sanitizePdfText
      const cycleLabel = cycleFilter ? cycles.find((c) => String(c.id) === String(cycleFilter))?.name || cycleFilter : 'All'
      const doc = await createManifestDoc({
        title: `Coop Exhibition · ${status} Orders`,
        meta: `Cycle: ${sanitize(cycleLabel)} | Payment: ${sanitize(payment || 'All')} | Search: ${sanitize(term || 'All')}`,
      })
      const head = [['Order', 'Date', 'Member', 'Branch', 'Payment', 'Qty', 'Total', 'Status', 'Vendors']]
      const body = rows.map((o) => [
        sanitize(o.order_id || String(o.id)),
        o.created_at ? new Date(o.created_at).toLocaleString() : '',
        sanitize(o.member_id),
        sanitize(o.branch_name || ''),
        sanitize(o.payment_option || ''),
        String(Number(o.total_qty || 0)),
        `NGN ${Number(o.total_amount || 0).toLocaleString()}`,
        sanitize(o.status || ''),
        sanitize((o.per_vendor || []).map((v) => `${v.vendor_name} (${v.qty})`).join(', ')),
      ])
      const totals = rows.reduce(
        (acc, o) => {
          acc.qty += Number(o.total_qty || 0)
          acc.amount += Number(o.total_amount || 0)
          return acc
        },
        { qty: 0, amount: 0 }
      )
      const totalsRowIndex = body.length
      body.push(['TOTAL', '', '', '', '', String(totals.qty.toLocaleString()), `NGN ${totals.amount.toLocaleString()}`, '', ''])
      await addManifestTable(doc, {
        head,
        body,
        startY: 30,
        variant: 'ram',
        columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' } },
        options: {
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index === totalsRowIndex) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [243, 244, 246]
            }
          },
        },
      })
      doc.save(`admin_exhibition_${status.toLowerCase()}_orders_${exportCycleSlug || 'all'}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Export failed' })
    } finally {
      setExportBusy('')
    }
  }

  const canCancel = status === 'Pending' || status === 'Approved'
  const canApprove = status === 'Pending'
  const canDeliver = status === 'Approved'
  const canRestore = status === 'Cancelled'

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition · {status}</h1>
          <p className="text-sm text-muted">Orders in the {status.toLowerCase()} stage of the exhibition flow.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton format="excel" onClick={exportExcel} disabled={!orders.length} busy={exportBusy === 'excel'} />
          <ExportButton format="pdf" onClick={exportPDF} disabled={!orders.length} busy={exportBusy === 'pdf'} />
        </div>
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

      {/* Vendor handover — who still owes goods on approved orders across all
          branches. Only the Approved view carries handover responsibility, so
          the panel lives there (Pending orders haven't been approved yet). */}
      {status === 'Approved' && vendorBreakdown && (
        <div className="mb-4 rounded-xl border border-line-subtle bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10">
                <Store className="h-4 w-4 text-brand" strokeWidth={2.2} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-fg">Vendor handover · all branches</h2>
                <p className="text-xs text-muted">
                  Who still owes goods on approved orders, aggregated across every branch
                  {cycleFilter && cycles.some((c) => String(c.id) === String(cycleFilter))
                    ? ` · ${cycles.find((c) => String(c.id) === String(cycleFilter))?.name || ''}`
                    : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchVendorBreakdown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {vendorBreakdown.vendors?.length ? (
            <>
              <div className="mb-2 text-xs text-muted">
                {vendorBreakdown.vendors.length} vendor{vendorBreakdown.vendors.length === 1 ? '' : 's'} awaiting handover — scroll for more
              </div>
              <div className="grid max-h-[30rem] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {vendorBreakdown.vendors.map((v) => {
                const total = Number(v.qty_delivered || 0) + Number(v.qty_outstanding || 0)
                const pct = total ? Math.round((Number(v.qty_delivered || 0) / total) * 100) : 0
                const done = Number(v.qty_outstanding || 0) === 0
                return (
                  <div
                    key={v.vendor_id}
                    className={[
                      'flex flex-col gap-2 rounded-lg border bg-surface p-3 transition-colors duration-200 ease-sakani',
                      done ? 'border-success-border/70 bg-success-bg/40' : 'border-brand/25 bg-brand/5',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-fg" title={v.vendor_name}>
                          {v.vendor_name || 'Vendor'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {v.branch_name ? `${v.branch_name} · ` : ''}
                          {Number(v.orders || 0)} order{Number(v.orders || 0) === 1 ? '' : 's'} ·{' '}
                          {total.toLocaleString()} item{total === 1 ? '' : 's'}
                        </p>
                      </div>
                      {done ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-semibold text-success-fg">
                          <PackageCheck className="h-3 w-3" strokeWidth={2.4} />
                          All delivered
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                          {Number(v.qty_outstanding || 0).toLocaleString()} outstanding
                        </span>
                      )}
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="text-muted">
                          {Number(v.qty_delivered || 0).toLocaleString()} of {total.toLocaleString()} delivered
                        </span>
                        <span className={done ? 'font-semibold text-success-fg' : 'font-semibold text-fg'}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div
                          className={['h-full rounded-full transition-all duration-300 ease-sakani', done ? 'bg-success' : 'bg-brand'].join(' ')}
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-line/70 pt-2">
                      <span className="text-[11px] text-muted">Still owing</span>
                      <span className={['text-sm font-semibold tabular-nums', done ? 'text-muted line-through' : 'text-fg'].join(' ')}>
                        {naira(v.amount_outstanding)}
                      </span>
                    </div>
                  </div>
                )
              })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line bg-subtle/60 px-4 py-6 text-center">
              <PackageCheck className="h-5 w-5 text-brand" strokeWidth={2} />
              <p className="text-sm font-medium text-fg">Nothing awaiting handover</p>
              <p className="max-w-sm text-xs text-muted">
                Approved orders with vendor lines will appear here once members order and they are approved.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="ui-card p-4 mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <input
                className="w-full max-w-[380px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Search order ID / member…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    fetchOrders({ page: 1, term: e.target.value })
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
                value={cycleFilter}
                onChange={(e) => {
                  const next = e.target.value
                  setCycleFilter(next)
                  setPage(1)
                  fetchOrders({ page: 1, cycle: next })
                  fetchVendorBreakdown()
                }}
              >
                <option value="">All cycles</option>
                {cycles.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name} ({c.code})</option>
                ))}
              </select>
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
            </div>
          </div>

        </div>
      </div>

      {/* Table */}
      <div className="ui-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold text-fg">{status} Orders</div>
            <button
              type="button"
              onClick={() => {
                fetchOrders()
                fetchVendorBreakdown()
              }}
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
              {allSelectedOnPage ? 'Deselect All' : 'Select All'}
            </button>
            {canApprove && (
              <button
                type="button"
                onClick={() => selectedCount && setModal({ type: 'approve', ids: Array.from(selected) })}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-success-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve ({selectedCount})
              </button>
            )}
            {canDeliver && (
              <button
                type="button"
                onClick={() => selectedCount && runAction('deliver', Array.from(selected))}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50"
              >
                <Truck className="h-3.5 w-3.5" />
                Deliver ({selectedCount})
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => selectedCount && setModal({ type: 'cancel', ids: Array.from(selected) })}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger-fg px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:brightness-110 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel ({selectedCount})
              </button>
            )}
            {canRestore && (
              <button
                type="button"
                onClick={() => selectedCount && setModal({ type: 'restore', ids: Array.from(selected) })}
                disabled={!selectedCount || bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore ({selectedCount})
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
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
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
              Next <ChevronRight className="h-3.5 w-3.5" />
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
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Branch</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Payment</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Qty</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Total</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Status</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
              </tr>
            </thead>
            <motion.tbody layout>
              {loading && (
                <>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-b border-line">
                      <td className="p-3"><div className="sakani-skeleton h-4 w-4 rounded" /></td>
                      <td className="p-3"><div className="sakani-skeleton h-4 w-24 rounded" /></td>
                      <td className="p-3"><div className="sakani-skeleton h-4 w-40 rounded" /></td>
                      <td className="p-3"><div className="sakani-skeleton h-4 w-32 rounded" /></td>
                      <td className="p-3"><div className="sakani-skeleton h-4 w-16 rounded" /></td>
                      <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-10 rounded" /></td>
                      <td className="p-3 text-right"><div className="sakani-skeleton ml-auto h-4 w-20 rounded" /></td>
                      <td className="p-3"><div className="sakani-skeleton h-4 w-20 rounded" /></td>
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
                      <p className="text-sm font-medium text-fg">No {status} exhibition orders</p>
                      <p className="text-xs text-muted">When members place exhibition orders, they will appear here.</p>
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
                          aria-label={`Select order ${o.order_id}`}
                        />
                      </td>
                      <td className="p-3 align-top">
                        <div className="font-medium text-fg">{o.order_id || `#${o.id}`}</div>
                        <div className="text-xs text-subtext">{fmtDate(o.created_at)}</div>
                        <div className="text-xs text-subtext">{o.cycle_name || o.cycle_code || ''}</div>
                        {status === 'Cancelled' && (
                          <div className="mt-1 max-w-[220px] text-xs text-subtext">
                            Reason: {String(o.cancelled_reason || '—').trim()}
                          </div>
                        )}
                      </td>
                      <td className="p-3 align-top">
                        <div className="font-medium text-fg">{o.member_id}</div>
                        <div className="text-muted break-words">{o.member_name_snapshot || '-'}</div>
                      </td>
                      <td className="p-3 align-top text-muted">{o.branch_name || `#${o.branch_id}`}</td>
                      <td className="p-3 align-top">
                        <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg">
                          {o.payment_option || '-'}
                        </span>
                      </td>
                      <td className="p-3 align-top text-right">{Number(o.total_qty || 0).toLocaleString()}</td>
                      <td className="p-3 align-top text-right font-medium text-fg">{naira(o.total_amount)}</td>
                      <td className="p-3 align-top">
                        <Badge tone={STATUS_TONE[o.status] || 'neutral'} variant="subtle">{o.status}</Badge>
                        {o.per_vendor?.length > 0 && (
                          <div className="mt-1 max-w-[160px] space-y-0.5">
                            {o.per_vendor.map((v) => (
                              <div key={v.vendor_id} className="truncate text-xs text-subtext" title={v.vendor_name}>
                                {v.vendor_name}: {v.qty} {v.all_delivered && status === 'Approved' ? '· delivered' : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 align-top text-right">
                        <select
                          defaultValue=""
                          disabled={bulkBusy}
                          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
                          onChange={(e) => {
                            const v = e.target.value
                            e.target.value = ''
                            if (!v) return
                            if (v === 'approve') setModal({ type: 'approve', ids: [o.id] })
                            if (v === 'deliver') runAction('deliver', [o.id])
                            if (v === 'cancel') setModal({ type: 'cancel', ids: [o.id] })
                            if (v === 'restore') setModal({ type: 'restore', ids: [o.id] })
                            if (v === 'activity') openAudit(o)
                            if (v === 'sheet') setSheetOrder(o)
                          }}
                        >
                          <option value="" disabled>Actions</option>
                          {canApprove && <option value="approve">Approve</option>}
                          {canDeliver && <option value="deliver">Deliver</option>}
                          {canCancel && <option value="cancel">Cancel</option>}
                          {canRestore && <option value="restore">Restore</option>}
                          <option value="activity">Activity</option>
                          <option value="sheet">Print sheet</option>
                        </select>
                      </td>
                    </motion.tr>
                  ))}
              </AnimatePresence>
            </motion.tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={!!modal}
        onClose={() => (bulkBusy ? null : setModal(null))}
        widthClass="max-w-lg w-full mx-4"
        title={
          modal?.type === 'approve'
            ? 'Approve orders'
            : modal?.type === 'cancel'
              ? 'Cancel orders'
              : 'Restore orders'
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle"
              onClick={() => setModal(null)}
              disabled={bulkBusy}
            >
              Close
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani disabled:opacity-50 ${
                modal?.type === 'cancel' ? 'bg-danger-fg hover:brightness-110' : 'bg-brand hover:bg-brand-hover'
              }`}
              onClick={() => runAction(modal?.type, modal?.ids || [], cancelReason)}
              disabled={bulkBusy}
            >
              {bulkBusy ? 'Working…' : modal?.type === 'cancel' ? 'Cancel orders' : modal?.type === 'restore' ? 'Restore orders' : 'Approve orders'}
            </button>
          </div>
        }
      >
        {modal?.type === 'cancel' ? (
          <div className="space-y-3">
            <div className="text-sm text-muted">
              Cancel <b className="text-fg">{modal?.ids?.length || 0}</b> order(s)? Cancelled orders are excluded from payouts.
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-subtext">Reason (optional)</div>
              <textarea
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation…"
                disabled={bulkBusy}
              />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">
            {modal?.type === 'restore'
              ? `Restore `
              : `Approve `}
            <b className="text-fg">{modal?.ids?.length || 0}</b> order(s){modal?.type === 'restore' ? ' back to Pending' : ', and vendors will then hand over the goods'}?
          </div>
        )}
      </DraggableModal>

      {/* Order activity — audit trail: who did what and when */}
      <DraggableModal
        open={!!auditOrder}
        onClose={() => setAuditOrder(null)}
        widthClass="max-w-lg w-full mx-4"
        title={auditOrder ? `Activity · ${auditOrder.order_id}` : 'Activity'}
      >
        <div className="space-y-3">
          {auditLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="sakani-skeleton h-8 w-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="sakani-skeleton h-3.5 w-2/3 rounded" />
                    <div className="sakani-skeleton h-3 w-1/3 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : auditError ? (
            <div className="rounded-lg border border-danger-border bg-danger-bg/60 p-3 text-xs font-medium text-danger-fg">
              {auditError}
            </div>
          ) : auditItems.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No activity recorded for this order yet.</p>
          ) : (
            <ol className="relative">
              {auditItems.map((ev, i) => {
                const { Icon, iconCls, tileCls } = AUDIT_ICON[ev.action] || { Icon: History, iconCls: 'text-muted', tileCls: 'bg-subtle' }
                const isLast = i === auditItems.length - 1
                return (
                  <li key={ev.key} className="relative flex gap-3 pb-5 last:pb-0">
                    {!isLast && (
                      <span aria-hidden="true" className="absolute left-4 top-9 bottom-0 w-px bg-line" />
                    )}
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tileCls}`}>
                      <Icon className={`h-4 w-4 ${iconCls}`} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <p className="text-sm font-medium text-fg">
                          {ev.action === 'Order placed' ? 'Order placed' : `${ev.action} by ${ev.actorLabel}`}
                        </p>
                        <time className="text-chips text-muted">{fmtDate(ev.created_at)}</time>
                      </div>
                      {ev.note ? (
                        <p className="mt-0.5 text-xs text-muted">
                          {ev.action === 'Cancelled' ? 'Reason: ' : ''}
                          {ev.note}
                        </p>
                      ) : (
                        ev.action === 'Order placed' && (
                          <p className="mt-0.5 text-xs text-muted">By {ev.actorLabel}</p>
                        )
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </DraggableModal>

      {/* Print-optimized order sheet — hand this to the vendor at the market */}
      <PrintOrderSheet
        open={!!sheetOrder}
        onClose={() => setSheetOrder(null)}
        module="exhibition"
        order={sheetOrder}
      />
    </div>
  )
}
