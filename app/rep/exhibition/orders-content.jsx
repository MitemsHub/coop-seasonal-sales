'use client'

// app/rep/exhibition/orders-content.jsx
// Shared content for the rep exhibition order views (Pending, Approved,
// Delivered, Cancelled). Reps approve and cancel; delivery is the vendor's
// job; cancelled orders can be restored back to Pending.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, History, Inbox, Package, PackageCheck, RefreshCw, RotateCcw, Search, Store, Truck, XCircle, Zap } from 'lucide-react'
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

// Group the per-order "failed" entries returned by the rep action routes into
// human labels with counts, so the skipped-count tooltip can explain exactly
// why each order didn't process. Out-of-scope ids arrive as { reason } only
// (never their status), so the labels never expose another branch's state.
function summarizeFailed(failed = []) {
  const counts = new Map()
  const labelFor = (f) => {
    if (f.reason === 'Not in your branch') return 'Not in your branch'
    if (f.reason === 'Closed exhibition cycle') return 'Closed exhibition cycle'
    if (f.reason === 'Insufficient stock to restore') return 'Insufficient stock to restore'
    if (f.reason) return f.reason
    if (f.status) return `Already ${f.status}`
    return 'Order not found'
  }
  for (const f of failed) {
    const label = labelFor(f)
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }))
}

export default function RepExhibitionOrdersContent({ status = 'Pending' }) {
  const [orders, setOrders] = useState([])
  const [totalCount, setTotalCount] = useState(0)
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
  const [stats, setStats] = useState(null)
  const [vendorBreakdown, setVendorBreakdown] = useState(null)
  const [auditOrder, setAuditOrder] = useState(null) // { id, order_id, created_at, member_id }
  const [auditEvents, setAuditEvents] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [auditExportBusy, setAuditExportBusy] = useState(null) // 'excel' | 'pdf' | null
  const [sheetOrder, setSheetOrder] = useState(null) // order row for the print sheet
  const fetchCtl = useRef(null)

  const safeJson = useCallback(async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }, [])

  const fetchOrders = useCallback(
    async (opts = {}) => {
      setLoading(true)
      // runAction passes keepMsg so the success/skipped toast it just set
      // isn't wiped by the list refetch in the same render batch.
      if (!opts.keepMsg) setMsg(null)
      try {
        if (fetchCtl.current) fetchCtl.current.abort()
        const ctl = new AbortController()
        fetchCtl.current = ctl
        const nextPage = Number(opts.page ?? page)
        const nextPageSize = Number(opts.pageSize ?? pageSize)
        const nextTerm = typeof opts.term === 'string' ? opts.term : term
        const nextPayment = typeof opts.payment === 'string' ? opts.payment : payment
        const qs = new URLSearchParams({
          status,
          limit: String(Math.max(1, nextPageSize)),
          offset: String(Math.max(0, (nextPage - 1) * nextPageSize)),
          ...(nextTerm ? { q: nextTerm } : {}),
          ...(nextPayment ? { payment: nextPayment } : {}),
        })
        const res = await fetch(`/api/rep/exhibition/orders/list?${qs}`, { cache: 'no-store', signal: ctl.signal })
        const json = await safeJson(res, '/api/rep/exhibition/orders/list')
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
    [status, page, pageSize, term, payment, safeJson]
  )

  // Branch summary strip — best-effort, refreshes with the orders list.
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/rep/exhibition/stats', { cache: 'no-store' })
      const json = await safeJson(res, 'stats')
      if (res.ok && json?.ok) setStats(json)
    } catch {
      // The strip is best-effort — never block the page on it.
    }
  }, [safeJson])

  // Per-vendor handover breakdown — which vendors still owe goods on approved
  // orders. Only meaningful on the Approved view, so it skips other statuses.
  const fetchVendorBreakdown = useCallback(async () => {
    if (status !== 'Approved') return
    try {
      const res = await fetch('/api/rep/exhibition/vendors/breakdown', { cache: 'no-store' })
      const json = await safeJson(res, 'vendor breakdown')
      if (res.ok && json?.ok) setVendorBreakdown(json)
    } catch {
      // The panel is best-effort — never block the page on it.
    }
  }, [status, safeJson])

  const refreshAll = useCallback(() => {
    fetchOrders()
    fetchStats()
    fetchVendorBreakdown()
  }, [fetchOrders, fetchStats, fetchVendorBreakdown])

  // Audit trail for one order — who approved/cancelled/restored/delivered it.
  const openAudit = useCallback(async (o) => {
    setAuditOrder(o)
    setAuditEvents([])
    setAuditError('')
    setAuditLoading(true)
    try {
      const res = await fetch(`/api/rep/exhibition/orders/audit?order_id=${o.id}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/rep/exhibition/orders/audit')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load activity')
      setAuditEvents(json.events || [])
    } catch (e) {
      setAuditError(e?.message || 'Failed to load activity')
    } finally {
      setAuditLoading(false)
    }
  }, [safeJson])

  useEffect(() => {
    fetchOrders({ page: 1 })
    fetchStats()
    fetchVendorBreakdown()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Audit-trail exports — staff can print or share an order's history.
  const auditExportRows = () =>
    auditItems.map((ev) => ({
      action: ev.action,
      actor: ev.action === 'Order placed' ? `By ${ev.actorLabel}` : ev.actorLabel,
      note: ev.note || '',
      when: ev.created_at ? new Date(ev.created_at).toLocaleString('en-GB') : '',
    }))

  const exportAuditExcel = async () => {
    if (!auditItems.length) return
    setAuditExportBusy('excel')
    try {
      const rows = auditExportRows()
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Activity')
      ws.addRow([`Order Activity · ${auditOrder?.order_id || ''}`])
      ws.addRow([`Member ${auditOrder?.member_id || ''} · Exported ${new Date().toLocaleString()}`])
      ws.addRow(['Event', 'Actor', 'Note', 'When'])
      for (const r of rows) ws.addRow([r.action, r.actor, r.note, r.when])
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rep_exhibition_activity_${auditOrder?.order_id || 'order'}_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Excel export failed: ${e.message}`)
    } finally {
      setAuditExportBusy(null)
    }
  }

  const exportAuditPDF = async () => {
    if (!auditItems.length) return
    setAuditExportBusy('pdf')
    try {
      const rows = auditExportRows()
      const doc = await createManifestDoc({
        title: `Order Activity · ${auditOrder?.order_id || ''}`,
        meta: `Member ${auditOrder?.member_id || ''} · Exported ${new Date().toLocaleString()}`,
      })
      await addManifestTable(doc, {
        head: ['Event', 'Actor', 'Note', 'When'],
        body: rows.map((r) => [
          sanitizePdfText(r.action),
          sanitizePdfText(r.actor),
          sanitizePdfText(r.note),
          sanitizePdfText(r.when),
        ]),
        startY: 30,
        variant: 'ram',
      })
      doc.save(`rep_exhibition_activity_${auditOrder?.order_id || 'order'}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      alert(`PDF export failed: ${e.message}`)
    } finally {
      setAuditExportBusy(null)
    }
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

  const runAction = async (type, ids, reason) => {
    if (!ids.length) return
    setBulkBusy(true)
    setMsg(null)
    try {
      const path =
        type === 'approve'
          ? '/api/rep/exhibition/orders/approve'
          : type === 'cancel'
            ? '/api/rep/exhibition/orders/cancel'
            : '/api/rep/exhibition/orders/restore'
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(type === 'cancel' ? { ids, reason: reason || 'Cancelled by rep' } : { ids }),
      })
      const json = await safeJson(res, path)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Action failed')
      const done = (json.approved || json.cancelled || json.restored || [])
      const failed = json.failed || []
      setOrders((prev) => (prev || []).filter((o) => !done.includes(o.id)))
      setSelected(new Set())
      setModal(null)
      setCancelReason('')
      setMsg({
        type: 'success',
        text: `${done.length} order(s) ${type === 'approve' ? 'approved' : type === 'cancel' ? 'cancelled' : 'restored'}`,
        skipped: failed.length,
        reasons: summarizeFailed(failed),
      })
      fetchOrders({ page: safePage, keepMsg: true })
      fetchStats()
      fetchVendorBreakdown()
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Action failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  // ── Exports ─────────────────────────────────────────────────────

  // Exports always reflect the current exhibition period: they're scoped to
  // the branch's active cycle (the same one the summary strip reports), so a
  // closed or previous season never leaks into the download.
  const exportCycle = stats?.cycle || null
  const exportCycleLabel = exportCycle?.name || exportCycle?.code || ''
  const cycleSlug = String(exportCycleLabel || '')
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
        ...(exportCycle?.id ? { cycle_id: String(exportCycle.id) } : {}),
        ...(term ? { q: term } : {}),
        ...(payment ? { payment } : {}),
      })
      const res = await fetch(`/api/rep/exhibition/orders/list?${qs}`, { cache: 'no-store' })
      const json = await safeJson(res, '/api/rep/exhibition/orders/list (export)')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders for export')
      const chunk = json.orders || []
      // Belt and braces: keep only the active cycle's rows even if the query
      // ever ran without a cycle filter.
      const scoped = exportCycle?.id ? chunk.filter((o) => Number(o.cycle_id) === Number(exportCycle.id)) : chunk
      all.push(...scoped)
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
      ws.addRow([`Coop Exhibition · ${status} Orders (Rep)`])
      ws.addRow([`Cycle: ${exportCycleLabel || 'Current'} | Payment: ${payment || 'All'} | Search: ${term || 'All'}`])
      const headers = Object.keys(flat[0] || { id: '' })
      ws.addRow(headers)
      for (const r of flat) ws.addRow(headers.map((h) => r[h]))
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rep_exhibition_${status.toLowerCase()}_${cycleSlug || 'all'}_${new Date().toISOString().split('T')[0]}.xlsx`
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
      const doc = await createManifestDoc({
        title: `Coop Exhibition · ${status} Orders`,
        meta: `Cycle: ${sanitize(exportCycleLabel || 'Current')} | Payment: ${sanitize(payment || 'All')} | Search: ${sanitize(term || 'All')}`,
      })
      const head = [['Order', 'Date', 'Member', 'Payment', 'Qty', 'Total', 'Status', 'Vendors']]
      const body = rows.map((o) => [
        sanitize(o.order_id || String(o.id)),
        o.created_at ? new Date(o.created_at).toLocaleString() : '',
        sanitize(o.member_id),
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
      body.push(['TOTAL', '', '', '', String(totals.qty.toLocaleString()), `NGN ${totals.amount.toLocaleString()}`, '', ''])
      await addManifestTable(doc, {
        head,
        body,
        startY: 30,
        variant: 'ram',
        columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
        options: {
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index === totalsRowIndex) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [243, 244, 246]
            }
          },
        },
      })
      doc.save(`rep_exhibition_${status.toLowerCase()}_orders_${cycleSlug || 'all'}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Export failed' })
    } finally {
      setExportBusy('')
    }
  }

  const canCancel = status === 'Pending' || status === 'Approved'
  const canApprove = status === 'Pending'
  const canRestore = status === 'Cancelled'

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition · {status}</h1>
            {stats?.cycle?.name && (
              <span
                title={stats.cycle.code ? `Cycle ${stats.cycle.code}` : 'Active exhibition cycle'}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/5 px-2.5 py-1 text-chips font-semibold text-brand"
              >
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                {stats.cycle.name}
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            {status === 'Pending'
              ? 'Approve or cancel orders placed by members at your branch.'
              : status === 'Approved'
                ? 'Approved orders waiting for vendors to hand over the goods.'
                : status === 'Delivered'
                  ? 'Orders the vendors have delivered to members.'
                  : 'Cancelled orders. Restore any that were cancelled by mistake.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton format="excel" onClick={exportExcel} disabled={!orders.length} busy={exportBusy === 'excel'} />
          <ExportButton format="pdf" onClick={exportPDF} disabled={!orders.length} busy={exportBusy === 'pdf'} />
        </div>
      </div>

      {/* Branch summary strip */}
      {stats ? (
        <>
          {/* Today's pending queue — count + value created today, plus deliveries
              this season, only on the actionable Pending view where reps clear
              the queue. */}
          {status === 'Pending' && (
            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand">
                <Zap className="h-3.5 w-3.5" strokeWidth={2.2} />
                Today's pending
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtext sm:justify-end">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-fg">
                    {(stats.todayPending?.count || 0).toLocaleString()} order{(stats.todayPending?.count || 0) === 1 ? '' : 's'}
                  </span>
                  <span className="text-line-strong">·</span>
                  <span className="font-semibold text-fg">{naira(stats.todayPending?.total || 0)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-brand" strokeWidth={2.2} />
                  Delivered this cycle
                  <span className="font-semibold text-fg">{(stats.deliveredCycle?.count || 0).toLocaleString()}</span>
                  <span className="text-line-strong">·</span>
                  <span className="font-semibold text-fg">{naira(stats.deliveredCycle?.total || 0)}</span>
                </span>
              </span>
            </div>
          )}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            { key: 'Pending', icon: Clock, delta: `${stats.todayPending?.count || 0} new today` },
            { key: 'Approved', icon: CheckCircle2, delta: 'awaiting vendor handover' },
            { key: 'Delivered', icon: Truck, delta: 'handed to members' },
            { key: 'Cancelled', icon: XCircle, delta: 'can be restored' },
          ].map(({ key, icon: Icon, delta }) => {
            const st = stats.statuses?.[key] || { count: 0, total: 0 }
            const active = key === status
            return (
              <div
                key={key}
                className={[
                  'rounded-xl border bg-surface p-3 transition-colors duration-200 ease-sakani',
                  active ? 'border-brand/50 ring-1 ring-brand/25' : 'border-line-subtle',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                    {key}
                  </span>
                  {active && <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Viewing</span>}
                </div>
                <p className="mt-1.5 text-[clamp(1.125rem,1.125rem+0.22vw,1.375rem)] font-semibold leading-tight tracking-tight text-fg">
                  {st.count.toLocaleString()}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-subtext">{naira(st.total)}</p>
                <p className="mt-1 truncate text-[10px] text-muted">{delta}</p>
              </div>
            )
          })}
          </div>
        </>
      ) : null}

      {/* Vendor handover — who still owes goods on approved orders. Only the
          Approved view carries handover responsibility, so the panel lives
          there (Pending orders haven't been approved yet). */}
      {status === 'Approved' && vendorBreakdown && (
        <div className="mb-4 rounded-xl border border-line-subtle bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10">
                <Store className="h-4 w-4 text-brand" strokeWidth={2.2} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-fg">Vendor handover</h2>
                <p className="text-xs text-muted">
                  Who still owes goods on approved orders
                  {vendorBreakdown.cycle?.name ? ` · ${vendorBreakdown.cycle.name}` : ''}
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

          {/* Cycle totals — items and naira still owed across all vendors */}
          {vendorBreakdown.totals && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-subtle/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-muted">
                Across {vendorBreakdown.vendors?.length || 0} vendor{vendorBreakdown.vendors?.length === 1 ? '' : 's'} this cycle
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <div>
                  <span className="text-[11px] text-muted">Items still owed</span>
                  <p className="text-sm font-bold tabular-nums text-fg">
                    {Number(vendorBreakdown.totals.qty_outstanding || 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-muted">Naira still owed</span>
                  <p className="text-sm font-bold tabular-nums text-fg">
                    {naira(vendorBreakdown.totals.amount_outstanding)}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-muted">Delivered</span>
                  <p className="text-sm font-bold tabular-nums text-fg">
                    {Number(vendorBreakdown.totals.qty_delivered || 0).toLocaleString()} items ·{' '}
                    {naira(vendorBreakdown.totals.amount_delivered)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {vendorBreakdown.vendors?.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
          ) : (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line bg-subtle/60 px-4 py-6 text-center">
              <PackageCheck className="h-5 w-5 text-brand" strokeWidth={2} />
              <p className="text-sm font-medium text-fg">Nothing awaiting handover</p>
              <p className="max-w-sm text-xs text-muted">
                Approved orders with vendor lines will appear here once members order and you approve them.
              </p>
            </div>
          )}
        </div>
      )}

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
            {msg.type !== 'error' && msg.skipped > 0 && msg.reasons?.length > 0 && (
              <span className="group relative inline-flex cursor-help items-center gap-1">
                <span aria-hidden="true">·</span>
                <b>{msg.skipped} skipped</b>
                <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-xs text-fg shadow-lg group-hover:block">
                  <span className="mb-1 block font-semibold text-subtext">Why skipped:</span>
                  {msg.reasons.map((r) => (
                    <span key={r.label} className="flex items-center gap-2 py-0.5">
                      <span className="font-semibold text-fg">{r.count}×</span>
                      <span className="text-muted">{r.label}</span>
                    </span>
                  ))}
                </span>
              </span>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

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

      {/* Table */}
      <div className="ui-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold text-fg">{status} Orders</div>
            <button
              type="button"
              onClick={refreshAll}
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
                  <td className="p-10 text-center" colSpan={8}>
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
                        <Inbox className="h-6 w-6 text-subtext" />
                      </div>
                      <p className="text-sm font-medium text-fg">No {status} exhibition orders</p>
                      <p className="text-xs text-muted">Orders at your branch will appear here.</p>
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
                                {v.vendor_name}: {v.qty}
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
                            if (v === 'cancel') setModal({ type: 'cancel', ids: [o.id] })
                            if (v === 'restore') setModal({ type: 'restore', ids: [o.id] })
                            if (v === 'activity') openAudit(o)
                            if (v === 'sheet') setSheetOrder(o)
                          }}
                        >
                          <option value="" disabled>Actions</option>
                          {canApprove && <option value="approve">Approve</option>}
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
              Cancel <b className="text-fg">{modal?.ids?.length || 0}</b> order(s)? Cancelled orders are excluded from vendor payouts.
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
            {modal?.type === 'restore' ? 'Restore ' : 'Approve '}
            <b className="text-fg">{modal?.ids?.length || 0}</b> order(s)
            {modal?.type === 'restore' ? ' back to Pending' : ', and vendors will then hand over the goods'}?
          </div>
        )}
      </DraggableModal>

      {/* Order activity — audit trail: who did what and when */}
      <DraggableModal
        open={!!auditOrder}
        onClose={() => setAuditOrder(null)}
        widthClass="max-w-lg w-full mx-4"
        title={auditOrder ? `Activity · ${auditOrder.order_id}` : 'Activity'}
        footer={
          !auditLoading && !auditError && auditItems.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton
                format="excel"
                onClick={() => exportAuditExcel().catch(() => {})}
                disabled={auditExportBusy !== null}
                busy={auditExportBusy === 'excel'}
              />
              <ExportButton
                format="pdf"
                onClick={() => exportAuditPDF().catch(() => {})}
                disabled={auditExportBusy !== null}
                busy={auditExportBusy === 'pdf'}
              />
            </div>
          ) : undefined
        }
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
