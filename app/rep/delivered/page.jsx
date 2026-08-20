'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import ProtectedRoute from '../../components/ProtectedRoute'
import DraggableModal from '../../components/DraggableModal'
import ExportButton from '../../components/ui/ExportButton'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../lib/pdfExport'


const Spinner = ({ className = 'h-4 w-4 text-on-accent' }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
)

function RepDeliveredContent() {
  const { user } = useAuth()

  const [orders, setOrders] = useState([])
  const [departments, setDepartments] = useState([])
  const [dept, setDept] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [didLoadOnce, setDidLoadOnce] = useState(false)
  const [pageSize] = useState(50)
  const [cursorStack, setCursorStack] = useState([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)

  const [excelLoading, setExcelLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)

  const [viewOpen, setViewOpen] = useState(false)
  const [viewOrder, setViewOrder] = useState(null)

  const fetchCtl = useRef(null)

  useEffect(() => {
    if (user?.type !== 'rep' || !user?.authenticated) return
    ;(async () => {
      try {
        const res = await fetch('/api/departments/list', { cache: 'no-store' })
        const j = await res.json()
        if (j?.ok) setDepartments(j.departments || [])
      } catch {}
    })()
  }, [user])

  // Pre-select department from login prefs (set at login time)
  useEffect(() => {
    if (user?.type === 'rep' && user?.department && !dept) {
      setDept(user.department)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const resetPagination = () => {
    setCursorStack([null])
    setPageIndex(0)
    setNextCursor(null)
  }

  const fetchOrders = async (cursorOverride) => {
    if (fetchCtl.current) fetchCtl.current.abort()
    const ctl = new AbortController()
    fetchCtl.current = ctl
    setLoading(true)
    setMsg(null)
    try {
      const cursor = cursorOverride !== undefined ? cursorOverride : cursorStack[pageIndex] || null
      const qs = new URLSearchParams({ status: 'Delivered', limit: String(pageSize) })
      if (dept) qs.set('dept', dept)
      if (cursor) { qs.set('cursor', String(cursor)); qs.set('dir', 'next') }
      const res = await fetch(`/api/rep/orders/list?${qs.toString()}`, { cache: 'no-store', signal: ctl.signal })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setOrders(json.orders || [])
      setNextCursor(json.nextCursor || null)
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
    } finally {
      setLoading(false)
      setDidLoadOnce(true)
    }
  }

  useEffect(() => {
    if (user?.type !== 'rep' || !user?.authenticated) return
    fetchOrders(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept, user])

  useEffect(() => {
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
  }, [])

  const filteredOrders = useMemo(() => {
    const s = String(search || '').trim().toLowerCase()
    if (!s) return orders || []
    return (orders || []).filter((o) => {
      const hay = `${o.order_id} ${o.member_id} ${o.member_name_snapshot || ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [orders, search])

  const collectAllOrdersForExport = async () => {
    const base = new URLSearchParams({ status: 'Delivered', limit: '200' })
    if (dept) base.set('dept', dept)
    let cursor = null
    let all = []
    for (let page = 0; page < 100; page++) {
      const qs = new URLSearchParams(base)
      if (cursor) {
        qs.set('cursor', cursor)
        qs.set('dir', 'next')
      }
      const res = await fetch(`/api/rep/orders/list?${qs.toString()}`, { cache: 'no-store', headers: { Accept: 'application/json' } })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Failed to collect orders')
      all = all.concat(j.orders || [])
      if (!j.nextCursor) break
      cursor = j.nextCursor
    }
    return all
  }

  const exportExcel = async () => {
    if (excelLoading) return
    setExcelLoading(true)
    setMsg(null)
    try {
      const source = await collectAllOrdersForExport()
      const s = String(search || '').trim().toLowerCase()
      const filtered = !s
        ? source
        : source.filter((o) => `${o.order_id} ${o.member_id} ${o.member_name_snapshot || ''}`.toLowerCase().includes(s))

      const rows = filtered.flatMap((o) =>
        (o.order_lines || []).map((l) => ({
          ID: o.member_id,
          Order: o.order_id,
          PostedAt: o.posted_at,
          Member: o.member_name_snapshot,
          MemberBranch: o.member_branch?.name || '',
          Delivery: o.delivery?.name || '',
          Department: o.departments?.name || '',
          Payment: o.payment_option,
          Item: l.items?.name || '',
          Qty: Number(l.qty || 0),
          UnitPrice: Number(l.unit_price || 0),
          Amount: Number(l.amount || 0),
        }))
      )
      if (!rows.length) throw new Error('No rows to export')

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Delivered')
      ws.addRow(['Food Distribution · Delivered Orders'])
      ws.addRow([`Generated: ${new Date().toLocaleString()}`])
      ws.addRow([dept ? `Department: ${dept}` : 'Department: All'])
      ws.addRow([])

      const headers = Object.keys(rows[0])
      ws.addRow(headers)
      for (const r of rows) ws.addRow(headers.map((h) => r[h]))

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rep_delivered_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Export failed' })
    } finally {
      setExcelLoading(false)
    }
  }

  const exportPDF = async () => {
    if (pdfLoading) return
    setPdfLoading(true)
    setMsg(null)
    try {
      const source = await collectAllOrdersForExport()
      const s = String(search || '').trim().toLowerCase()
      const filtered = !s
        ? source
        : source.filter((o) => `${o.order_id} ${o.member_id} ${o.member_name_snapshot || ''}`.toLowerCase().includes(s))

      if (!filtered.length) throw new Error('No rows to export')
      const headers = ['ID', 'Order', 'Member', 'Dept', 'Pay', 'Item', 'Qty', 'Unit Price', 'Amount']
      const sanitize = sanitizePdfText
      const doc = await createManifestDoc({
        title: 'Delivered Orders Manifest',
        meta: `Department: ${dept || 'All'}`,
      })
      const body = filtered.flatMap((o) =>
        (o.order_lines || []).map((l) => [
          sanitize(o.member_id),
          sanitize(o.order_id),
          sanitize(o.member_name_snapshot),
          sanitize(o.departments?.name),
          sanitize(o.payment_option),
          sanitize(l.items?.name),
          String(l.qty || 0),
          `NGN ${Number(l.unit_price || 0).toLocaleString()}`,
          `NGN ${Number(l.amount || 0).toLocaleString()}`,
        ])
      )

      await addManifestTable(doc, {
        head: headers,
        body,
        startY: 30,
        columnStyles: {
          0: { cellWidth: 18 }, // ID
          1: { cellWidth: 14 }, // Order
          2: { cellWidth: 52 }, // Member
          3: { cellWidth: 28 }, // Dept
          4: { cellWidth: 16 }, // Pay
          5: { cellWidth: 72 }, // Item
          6: { cellWidth: 12, halign: 'right' }, // Qty
          7: { cellWidth: 24, halign: 'right' }, // Unit Price
          8: { cellWidth: 26, halign: 'right' }, // Amount
        },
      })

      doc.save(`rep_delivered_${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Export failed' })
    } finally {
      setPdfLoading(false)
    }
  }

  const openView = (o) => {
    setViewOrder(o)
    setViewOpen(true)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · Delivered</h1>
          <div className="text-xs text-muted">Current Branch: {user?.branchCode || '—'}</div>
        </div>
      </div>

      <div className="ui-card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full sm:w-56 shrink-0"
            value={dept}
            onChange={(e) => {
              const v = e.target.value
              setDidLoadOnce(false)
              setLoading(true)
              setDept(v)
              resetPagination()
              setOrders([])
            }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 flex-1 min-w-[240px] sm:max-w-[560px]">
            <input
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              placeholder="Search (Order / Member)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchInput.trim())
              }}
            />
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50 whitespace-nowrap"
              onClick={() => setSearch(searchInput.trim())}
              disabled={loading}
            >
              Search
            </button>
          </div>

          <ExportButton
            format="excel"
            onClick={() => exportExcel().catch(() => null)}
            disabled={excelLoading}
            busy={excelLoading}
            busyText="Preparing…"
          />
          <ExportButton
            format="pdf"
            onClick={() => exportPDF().catch(() => null)}
            disabled={pdfLoading}
            busy={pdfLoading}
            busyText="Preparing…"
          />
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
            onClick={() => fetchOrders(undefined).catch(() => null)}
            disabled={loading}
          >
            {loading && <Spinner className="h-4 w-4 text-on-accent" />}
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
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

      <div className="ui-card overflow-hidden">
        <div className="p-4 border-b border-line bg-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm font-semibold">Delivered Orders</div>
          <div className="flex items-center gap-2 text-xs font-normal text-subtext">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                if (pageIndex <= 0) return
                const prevIndex = pageIndex - 1
                setPageIndex(prevIndex)
                fetchOrders(cursorStack[prevIndex] || null).catch(() => null)
              }}
              disabled={loading || pageIndex <= 0}
            >
              Prev
            </button>
            <div>Page {pageIndex + 1}</div>
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                if (!nextCursor) return
                const nextIndex = pageIndex + 1
                setCursorStack((prev) => {
                  const next = [...(prev || [])]
                  if (next.length <= nextIndex) next.push(nextCursor)
                  return next
                })
                setPageIndex(nextIndex)
                fetchOrders(nextCursor).catch(() => null)
              }}
              disabled={loading || !nextCursor}
            >
              Next
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle border-b border-line">
              <tr>
                <th className="px-3 py-3 text-left font-semibold text-fg">Order</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Member</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Department</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Payment</th>
                <th className="px-3 py-3 text-right font-semibold text-fg">Total + Int</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Date</th>
                <th className="px-3 py-3 text-right font-semibold text-fg">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {!didLoadOnce || (loading && filteredOrders.length === 0) ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`sk_${i}`}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={`sk_${i}_${j}`} className="px-3 py-3">
                        <div className="h-4 w-full sakani-skeleton rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
                    No Delivered orders.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => (
                  <tr key={o.order_id} className="hover:bg-subtle">
                    <td className="px-3 py-3 font-medium text-fg">#{o.order_id}</td>
                    <td className="px-3 py-3">
                      <div className="text-fg">{o.member_name_snapshot}</div>
                      <div className="text-xs text-muted">{o.member_id}</div>
                    </td>
                    <td className="px-3 py-3">{o.departments?.name || '-'}</td>
                    <td className="px-3 py-3">{o.payment_option}</td>
                    <td className="px-3 py-3 text-right font-semibold">₦{Number(o.total_amount || 0).toLocaleString()}</td>
                    <td className="px-3 py-3">{new Date(o.posted_at || o.created_at).toLocaleString()}</td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover"
                        onClick={() => openView(o)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title={viewOrder ? `Order #${viewOrder.order_id}` : 'Order'}
        widthClass="w-[94vw] max-w-4xl mx-4"
      >
        {!viewOrder ? (
          <div className="text-sm text-muted">No order selected.</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              <div>
                <span className="text-muted">Member:</span> <span className="font-medium">{viewOrder.member_name_snapshot}</span>{' '}
                <span className="text-muted">({viewOrder.member_id})</span>
              </div>
              <div className="text-muted">
                {viewOrder.member_branch?.name ? `Member Branch: ${viewOrder.member_branch.name} • ` : ''}
                {viewOrder.delivery?.name ? `Delivery: ${viewOrder.delivery.name} • ` : ''}
                {viewOrder.departments?.name ? `Department: ${viewOrder.departments.name}` : 'Department: -'}
              </div>
              <div className="text-muted">
                Payment: <span className="font-medium">{viewOrder.payment_option}</span> • Total:{' '}
                <span className="font-semibold">₦{Number(viewOrder.total_amount || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="ui-card overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-xs sm:text-sm min-w-[560px]">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr>
                      <th className="px-3 py-2 text-left w-40 hidden md:table-cell">SKU</th>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right w-20">Qty</th>
                      <th className="px-3 py-2 text-right w-28">Unit Price</th>
                      <th className="px-3 py-2 text-right w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(viewOrder.order_lines || []).length ? (
                      (viewOrder.order_lines || []).map((l) => (
                        <tr key={l.id}>
                          <td className="px-3 py-2 font-mono text-xs break-all hidden md:table-cell">{l.items?.sku || ''}</td>
                          <td className="px-3 py-2 whitespace-normal break-words min-w-[220px]">{l.items?.name || ''}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{Number(l.qty || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">₦{Number(l.unit_price || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">₦{Number(l.amount || 0).toLocaleString()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-3 py-3 text-muted" colSpan={5}>
                          No items found for this order.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DraggableModal>
    </div>
  )
}

export default function RepDeliveredPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepDeliveredContent />
    </ProtectedRoute>
  )
}

