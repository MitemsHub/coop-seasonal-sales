'use client'

// app/vendor/deliveries/page.jsx
// The vendor's delivery checklist, table-form like the admin food/ram order
// pages: every approved order from the stand is a row (member name + ID up
// front), the items live in a collapsible panel per order, and the list is
// paginated + searchable so large seasons stay navigable. Lines can be marked
// delivered one at a time, per order, or in bulk via Select all. An order is
// only considered delivered once every line across all vendors is delivered.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, ChevronRight as ChevronExpand, ClipboardCheck, Package, PackageCheck, Search } from 'lucide-react'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import ExportButton from '../../components/ui/ExportButton'
import { createManifestDoc, addManifestTable, sanitizePdfText } from '../../lib/pdfExport'

const fmtNaira = (n) => `NGN ${Number(n || 0).toLocaleString()}`

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

const SCOPES = [
  { key: 'pending', label: 'Approved' },
  { key: 'done', label: 'Delivered' },
]

export default function VendorDeliveriesPage() {
  const [orders, setOrders] = useState(null) // null = loading
  const [total, setTotal] = useState(0)
  const [scope, setScope] = useState('pending') // 'pending' | 'done'
  const [term, setTerm] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [expanded, setExpanded] = useState(new Set()) // order_ids shown expanded
  const [selected, setSelected] = useState(new Set()) // 'order_id:lineId' keys
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busy, setBusy] = useState('') // 'order_id:lineId' while a line is being marked
  const [done, setDone] = useState('') // just-completed key (check-in animation)
  const [msg, setMsg] = useState('')
  const [note, setNote] = useState('')
  const [exportBusy, setExportBusy] = useState('') // '' | 'excel' | 'pdf'
  const [vendorName, setVendorName] = useState('')

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        scope,
        limit: String(pageSize),
        offset: String(Math.max(0, (page - 1) * pageSize)),
        ...(term ? { q: term } : {}),
      })
      const res = await fetch(`/api/vendor/exhibition/orders?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) {
        setOrders(json.orders || [])
        setTotal(Number(json.total ?? 0))
        setMsg('')
      } else {
        setMsg(json.error || 'Failed to load checklist')
      }
    } catch {
      setMsg('Failed to load checklist')
    }
  }, [scope, page, pageSize, term])

  useEffect(() => {
    load()
    // The report header names the stand — pull it from the session once.
    if (!vendorName) {
      fetch('/api/vendor/session', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.ok && j?.vendor?.name) setVendorName(j.vendor.name)
        })
        .catch(() => null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // Reset page + selection when the scope or search changes.
  const switchScope = (key) => {
    if (key === scope) return
    setScope(key)
    setPage(1)
    setSelected(new Set())
    setExpanded(new Set())
    setNote('')
  }

  const doSearch = () => {
    setTerm(searchInput.trim())
    setPage(1)
    setSelected(new Set())
  }

  const pageCount = Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize)))
  const safePage = Math.min(Math.max(1, page), pageCount)

  const toggleExpand = (orderId) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(orderId) ? next.delete(orderId) : next.add(orderId)
      return next
    })
  }

  // Outstanding line keys on the current page (what Select all covers).
  const pageOutstandingKeys = useMemo(
    () =>
      (orders || []).flatMap((o) =>
        o.lines.filter((l) => !l.delivered).map((l) => `${o.order_id}:${l.id}`)
      ),
    [orders]
  )
  const allSelected = pageOutstandingKeys.length > 0 && pageOutstandingKeys.every((k) => selected.has(k))
  const selectedCount = selected.size
  const outstandingOnPage = pageOutstandingKeys.length
  // Some (but not all) of the page's outstanding items are selected — the
  // global checkbox shows an indeterminate (mixed) state.
  const someSelected = selectedCount > 0 && selectedCount < outstandingOnPage

  const toggleLine = (key) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleOrder = (o) => {
    const keys = o.lines.filter((l) => !l.delivered).map((l) => `${o.order_id}:${l.id}`)
    if (!keys.length) return
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = keys.every((k) => next.has(k))
      keys.forEach((k) => (allIn ? next.delete(k) : next.add(k)))
      return next
    })
  }

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(pageOutstandingKeys))
  }

  // Bulk hand over: the vendor API takes one order at a time, so group the
  // selected line ids by order and call it once per order.
  const handOverLines = async (lineKeys) => {
    if (!lineKeys.size || bulkBusy) return
    setBulkBusy(true)
    setNote('')
    setMsg('')
    try {
      const byOrder = new Map()
      for (const key of lineKeys) {
        const sep = key.indexOf(':')
        const orderId = key.slice(0, sep)
        const lineId = Number(key.slice(sep + 1))
        if (!byOrder.has(orderId)) byOrder.set(orderId, [])
        byOrder.get(orderId).push(lineId)
      }
      let doneCount = 0
      let failed = 0
      for (const [orderId, lineIds] of byOrder) {
        const res = await fetch('/api/vendor/exhibition/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, lineIds }),
        })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.ok) doneCount += lineIds.length
        else failed += lineIds.length
      }
      setSelected(new Set())
      if (doneCount > 0) {
        setNote(`${doneCount} item${doneCount === 1 ? '' : 's'} marked as delivered${failed ? ` · ${failed} could not be updated` : ''}`)
      } else if (failed > 0) {
        setMsg('Could not mark the selected items as delivered. Try again.')
      }
      load()
    } catch (e) {
      setMsg(e.message || 'Failed to mark delivered')
    } finally {
      setBulkBusy(false)
    }
  }

  const handOverSelected = () => handOverLines(selected)

  const handOverOrder = (o) => {
    const keys = new Set(o.lines.filter((l) => !l.delivered).map((l) => `${o.order_id}:${l.id}`))
    return handOverLines(keys)
  }

  const handOverLine = async (o, line) => {
    const key = `${o.order_id}:${line.id}`
    setBusy(key)
    setMsg('')
    try {
      const res = await fetch('/api/vendor/exhibition/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: o.order_id, lineIds: [line.id] }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to update')
      setDone(key)
      setTimeout(() => setDone(''), 900)
      load()
    } catch (e) {
      setMsg(e.message || 'Failed to mark delivered')
    } finally {
      setBusy('')
    }
  }

  // ── Exports ─────────────────────────────────────────────────────
  // The report covers ALL approved orders from the stand (both scopes), not
  // just the current page — fetch every page of the scope-less list.
  const fetchAllForExport = async () => {
    const all = []
    let offset = 0
    const batch = 500
    while (true) {
      const qs = new URLSearchParams({ scope: 'all', limit: String(batch), offset: String(offset) })
      const res = await fetch(`/api/vendor/exhibition/orders?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to load orders')
      const chunk = json.orders || []
      all.push(...chunk)
      if (chunk.length < batch) break
      offset += batch
      if (offset > 10000) break
    }
    return all
  }

  const reportRows = (data) =>
    (data || []).flatMap((o) =>
      o.lines.map((l) => ({
        order: o.order_id,
        member: o.member_name || o.member_id || '',
        payment: o.payment_option || '',
        product: l.product_name || '',
        sku: l.sku || '',
        qty: Number(l.qty || 0),
        amount: Number(l.amount || 0),
        status: l.delivered ? 'Delivered' : 'Approved',
        when: l.delivered_at ? new Date(l.delivered_at).toLocaleString('en-GB') : '',
      }))
    )

  const reportTotals = (rows) =>
    rows.reduce(
      (acc, r) => {
        acc.qty += r.qty
        acc.amount += r.amount
        if (r.status === 'Delivered') {
          acc.doneQty += r.qty
          acc.doneAmount += r.amount
        }
        return acc
      },
      { qty: 0, amount: 0, doneQty: 0, doneAmount: 0 }
    )

  const exportExcel = async () => {
    setExportBusy('excel')
    try {
      const rows = reportRows(await fetchAllForExport())
      if (!rows.length) return
      const totals = reportTotals(rows)
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Deliveries')
      ws.addRow([`Vendor Deliveries Report${vendorName ? ` · ${vendorName}` : ''}`])
      ws.addRow([`Exported ${new Date().toLocaleString()}`])
      ws.addRow([])
      const headers = ['Order', 'Member', 'Payment', 'Product', 'SKU', 'Qty', 'Amount', 'Status', 'Delivered']
      ws.addRow(headers)
      for (const r of rows) {
        ws.addRow([r.order, r.member, r.payment, r.product, r.sku, r.qty, r.amount, r.status, r.when])
      }
      ws.addRow([])
      ws.addRow(['TOTALS', '', '', '', '', totals.qty, totals.amount, '', ''])
      ws.addRow(['DELIVERED', '', '', '', '', totals.doneQty, totals.doneAmount, '', ''])
      ws.addRow(['Outstanding', '', '', '', '', totals.qty - totals.doneQty, totals.amount - totals.doneAmount, '', ''])
      ws.getRow(1).font = { bold: true, size: 13 }
      ws.getRow(4).font = { bold: true }
      ws.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E5E1' } }
      ws.getRow(rows.length + 6).font = { bold: true }
      ws.columns = [{ width: 14 }, { width: 22 }, { width: 12 }, { width: 28 }, { width: 14 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 22 }]
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vendor_deliveries_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Excel export failed: ${e.message}`)
    } finally {
      setExportBusy('')
    }
  }

  const exportPDF = async () => {
    setExportBusy('pdf')
    try {
      const rows = reportRows(await fetchAllForExport())
      if (!rows.length) return
      const totals = reportTotals(rows)
      const sanitize = sanitizePdfText
      const doc = await createManifestDoc({
        title: `Vendor Deliveries Report${vendorName ? ` · ${sanitize(vendorName)}` : ''}`,
        meta: 'Approved orders from your stand · items and handover status',
      })
      const head = [['Order', 'Member', 'Payment', 'Product', 'SKU', 'Qty', 'Amount', 'Status', 'Delivered']]
      const body = rows.map((r) => [
        sanitize(r.order),
        sanitize(r.member),
        sanitize(r.payment),
        sanitize(r.product),
        sanitize(r.sku),
        String(r.qty),
        fmtNaira(r.amount),
        sanitize(r.status),
        sanitize(r.when),
      ])
      const totalsRowIndex = body.length
      body.push(['TOTAL', '', '', '', '', String(totals.qty.toLocaleString()), fmtNaira(totals.amount), '', ''])
      body.push(['DELIVERED', '', '', '', '', String(totals.doneQty.toLocaleString()), fmtNaira(totals.doneAmount), '', ''])
      await addManifestTable(doc, {
        head,
        body,
        startY: 30,
        variant: 'ram',
        columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' } },
        options: {
          didParseCell: (data) => {
            if (data.section === 'body' && (data.row.index === totalsRowIndex || data.row.index === totalsRowIndex + 1)) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [243, 244, 246]
            }
          },
        },
      })
      // doc.save() uses jspdf's bundled FileSaver, which dispatches a synthetic
      // click on a detached anchor — silently ignored by some webviews. Use the
      // same direct-anchor download the Excel export uses, which always lands.
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vendor_deliveries_${new Date().toISOString().split('T')[0]}.pdf`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      alert(`PDF export failed: ${e.message}`)
    } finally {
      setExportBusy('')
    }
  }

  const rowProgress = (o) => {
    if (!o.total_lines) return 0
    return Math.round((o.done_count / o.total_lines) * 100)
  }

  const renderLines = (o) => (
    <div className="divide-y divide-line">
      {o.lines.map((l) => {
        const key = `${o.order_id}:${l.id}`
        const isBusy = busy === key
        const isDone = done === key
        const handed = l.delivered || isDone
        return (
          <div key={l.id} className={`flex flex-col gap-2 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-3 ${handed ? 'opacity-60' : ''}`}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {!l.delivered && (
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleLine(key)}
                  disabled={bulkBusy}
                  className="h-4 w-4 shrink-0 rounded border-line text-brand focus:ring-brand"
                  aria-label={`Select ${l.product_name}`}
                />
              )}
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                  handed ? 'border-success bg-success text-on-accent' : 'border-line bg-subtle text-transparent'
                }`}
              >
                {handed ? <CheckCircle2 className="h-4 w-4" strokeWidth={2.4} /> : <Package className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0">
                <p className={`truncate text-sm ${handed ? 'text-muted line-through' : 'text-fg'}`}>{l.product_name}</p>
                <p className="text-chips text-muted">
                  {l.sku} · {l.unit}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 pl-9 sm:pl-0">
              <p className="text-sm text-muted">×{l.qty}</p>
              <p className="w-24 text-right text-sm font-medium text-fg">{fmtNaira(l.amount)}</p>
              {handed ? (
                <span className="w-28 text-right text-chips font-medium text-success-fg">
                  {l.delivered ? (l.delivered_at ? `Delivered ${new Date(l.delivered_at).toLocaleDateString()}` : 'Delivered') : 'Just delivered'}
                </span>
              ) : (
                <Button
                  variant="success"
                  size="sm"
                  leftIcon={PackageCheck}
                  onClick={() => handOverLine(o, l)}
                  loading={isBusy}
                >
                  Deliver
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )

  const renderRow = (o) => {
    const isExpanded = expanded.has(o.order_id)
    const outstanding = o.lines.filter((l) => !l.delivered)
    const orderSelected = outstanding.length > 0 && outstanding.every((l) => selected.has(`${o.order_id}:${l.id}`))
    // Some (but not all) of this order's outstanding lines are selected — the
    // row checkbox shows an indeterminate (mixed) state.
    const orderPartial = outstanding.length > 0 && !orderSelected && outstanding.some((l) => selected.has(`${o.order_id}:${l.id}`))
    const pct = rowProgress(o)
    return (
      <Fragment key={o.order_id}>
        <tr className="border-b border-line transition-colors duration-150 ease-sakani hover:bg-subtle">
          <td className="p-3 pl-4">
            {outstanding.length > 0 ? (
              <input
                type="checkbox"
                ref={(el) => {
                  if (el) el.indeterminate = orderPartial
                }}
                checked={orderSelected}
                onChange={() => toggleOrder(o)}
                disabled={bulkBusy}
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                aria-label={`Select all items on ${o.order_id}`}
                aria-checked={orderPartial ? 'mixed' : undefined}
              />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={2.2} aria-hidden="true" />
            )}
          </td>
          <td className="p-3">
            <button
              type="button"
              onClick={() => toggleExpand(o.order_id)}
              className="flex items-center gap-1.5 rounded text-left font-medium text-fg transition-colors hover:text-brand"
              aria-expanded={isExpanded}
            >
              <ChevronExpand
                className={['h-4 w-4 shrink-0 text-muted transition-transform duration-200 ease-sakani', isExpanded ? 'rotate-90' : ''].join(' ')}
                strokeWidth={2.2}
              />
              {o.order_id}
            </button>
            <div className="text-chips text-muted">{fmtDate(o.created_at)}</div>
          </td>
          <td className="p-3">
            <div className="font-medium text-fg">{o.member_name || 'Member'}</div>
            <div className="text-chips text-muted">{o.member_id}</div>
          </td>
          <td className="p-3">
            <Badge tone="neutral" variant="subtle">
              {o.payment_option || '—'}
            </Badge>
          </td>
          <td className="p-3 text-right">{o.total_lines}</td>
          <td className="p-3">
            <div className="mb-1 flex items-center justify-between gap-2 text-chips">
              <span className="text-muted">
                {o.done_count} of {o.total_lines}
              </span>
              <span className={o.all_delivered ? 'font-semibold text-success-fg' : 'font-semibold text-fg'}>{pct}%</span>
            </div>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
              <div
                className={['h-full rounded-full transition-all duration-300 ease-sakani', o.all_delivered ? 'bg-success' : 'bg-brand'].join(' ')}
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>
          </td>
          <td className="p-3 text-right font-medium text-fg">{fmtNaira(o.my_amount)}</td>
          <td className="p-3 text-right">
            {o.all_delivered ? (
              <span className="inline-flex items-center gap-1.5 text-chips font-medium text-success-fg">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
                Delivered
              </span>
            ) : (
              <Button variant="success" size="sm" leftIcon={PackageCheck} onClick={() => handOverOrder(o)} disabled={bulkBusy}>
                Deliver
              </Button>
            )}
          </td>
        </tr>
        {isExpanded && (
          <tr className="border-b border-line bg-subtle/40">
            <td colSpan={8} className="p-0">
              {renderLines(o)}
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-h1 font-bold tracking-tight text-fg">Deliveries checklist</h1>
          <p className="mt-1 text-sm text-muted">            Approved orders from your stand. Expand an order to see its items, tick them off as you deliver them — or Select all
            and deliver in one action. The order completes when every vendor&apos;s items are delivered.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ExportButton format="excel" onClick={exportExcel} disabled={!orders?.length && !total} busy={exportBusy === 'excel'} busyText="Building…" />
          <ExportButton format="pdf" onClick={exportPDF} disabled={!orders?.length && !total} busy={exportBusy === 'pdf'} busyText="Building…" />
        </div>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}
      {!!note && <div className="mb-4 rounded-xl border border-success-border bg-success-bg px-4 py-3 text-sm text-success-fg">{note}</div>}

      {/* Scope tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => switchScope(s.key)}
            className={[
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150',
              scope === s.key ? 'border-brand bg-brand text-on-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </div>

      {!orders ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={scope === 'done' ? 'No delivered orders yet' : 'No approved orders yet'}
          description={
            scope === 'done'
              ? 'Orders where all of your items are already delivered will appear here.'
              : 'Approved orders with items from your stand will appear here as a checklist.'
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          {/* Toolbar: search + bulk actions */}
          <div className="flex flex-col gap-3 border-b border-line bg-subtle p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                placeholder="Search order ID or member…"
                className="w-full max-w-[320px] min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={doSearch}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover"
              >
                <Search className="h-4 w-4" />
                Search
              </button>
              {!!term && (
                <button
                  type="button"
                  onClick={() => {
                    setTerm('')
                    setSearchInput('')
                    setPage(1)
                  }}
                  className="text-chips font-medium text-muted underline-offset-2 hover:text-fg hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            {scope === 'pending' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-chips font-medium text-muted">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={bulkBusy || !outstandingOnPage}
                    className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                    aria-label="Select all outstanding items on this page"
                    aria-checked={someSelected ? 'mixed' : undefined}
                  />
                  Select all
                </label>
                <Button
                  variant="brand"
                  size="sm"
                  leftIcon={PackageCheck}
                  onClick={handOverSelected}
                  disabled={!selectedCount || bulkBusy}
                  loading={bulkBusy}
                >
                  {bulkBusy ? 'Delivering…' : `Deliver selected (${selectedCount})`}
                </Button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left">
                  <th className="p-3 pl-4 text-xs font-semibold uppercase tracking-wide text-subtext">Sel</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Order</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Member</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Payment</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Items</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Progress</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Amount</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(renderRow)}
              </tbody>
            </table>
          </div>

          {/* Footer: count + pagination */}
          <div className="flex flex-col gap-3 border-t border-line bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-chips text-muted">
              {total.toLocaleString()} order{total === 1 ? '' : 's'} {term ? `matching “${term}”` : ''}
              {scope === 'pending' && outstandingOnPage > 0 ? ` · ${outstandingOnPage} item${outstandingOnPage === 1 ? '' : 's'} outstanding on this page` : ''}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg focus:border-brand focus:outline-none"
                aria-label="Rows per page"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  const next = Math.max(1, safePage - 1)
                  setPage(next)
                }}
                disabled={safePage <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <div className="text-sm text-muted">
                Page <span className="font-medium text-fg">{safePage}</span> / {pageCount}
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = Math.min(pageCount, safePage + 1)
                  setPage(next)
                }}
                disabled={safePage >= pageCount}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
