'use client'

// app/components/PrintOrderSheet.jsx
// Print-optimized order sheet for staff (rep/admin): a clean, printable sheet
// per order — member + order meta, line items (grouped by vendor for
// exhibition), totals, and a signature block for the market handover. This is
// the artifact staff print and hand to a vendor so the vendor knows exactly
// which approved lines to prepare. Mirrors the OrderReceiptModal structure
// (stacked screen header, reveal-only print CSS) so it can't clip on mobile.
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Printer, ShoppingBasket, Store, X } from 'lucide-react'
import useFocusTrap from '../hooks/useFocusTrap'
import Button from './ui/Button'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`
// ASCII-only currency for the PDF so the glyph never scrambles in viewers.
const currencyPDF = (v) => `NGN ${Number(v || 0).toLocaleString()}`

const MODULE_META = {
  food: { icon: ShoppingBasket, title: 'Seasonal Sales · Food Distribution' },
  exhibition: { icon: Store, title: 'Seasonal Sales · Coop Exhibition' },
}

// Normalize an order row from either module into a common shape so the sheet
// (and the PDF) never depend on which surface opened it.
function normalizeLines(order, module) {
  if (!order) return { lines: [], perVendor: [] }
  if (module === 'exhibition') {
    const lines = (order.lines || []).map((l) => ({
      key: l.id ?? `${l.product_name}-${l.qty}`,
      vendorId: l.vendor_id,
      vendorName: l.vendor_name || 'Vendor',
      name: l.product_name || '—',
      unit: l.unit || '',
      qty: Number(l.qty || 0),
      amount: Number(l.amount || 0),
      delivered: Boolean(l.delivered),
    }))
    const by = new Map()
    for (const l of lines) {
      const cur = by.get(l.vendorId) || {
        vendorId: l.vendorId,
        vendorName: l.vendorName,
        lines: [],
        qty: 0,
        amount: 0,
      }
      cur.lines.push(l)
      cur.qty += l.qty
      cur.amount += l.amount
      by.set(l.vendorId, cur)
    }
    return { lines, perVendor: [...by.values()] }
  }
  // Food
  const lines = (order.order_lines || []).map((l, idx) => ({
    key: l.id ?? idx,
    vendorId: null,
    vendorName: '',
    name: l.items?.name || l.product_name || '—',
    unit: '',
    qty: Number(l.qty || 0),
    amount: Number(l.amount || 0),
    delivered: false,
  }))
  return { lines, perVendor: [] }
}

export default function PrintOrderSheet({ open, onClose, module = 'exhibition', order, branchLabel = '' }) {
  const panelRef = useRef(null)
  const [downloading, setDownloading] = useState(false)

  useFocusTrap({ open, panelRef, breakpoint: null, lockScroll: true, onClose })

  const meta = MODULE_META[module] || MODULE_META.exhibition
  const ModuleIcon = meta.icon
  const { lines, perVendor } = normalizeLines(order, module)

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

  const memberName = order?.member_name_snapshot || ''
  const memberId = order?.member_id || ''
  const status = order?.status || '—'
  const payment = order?.payment_option || '—'
  const orderRef = order?.order_id || (order?.id ? `#${order.id}` : '—')

  const branchName =
    branchLabel ||
    order?.branch_name ||
    order?.branches?.name ||
    order?.delivery?.name ||
    order?.member_branch?.name ||
    '—'
  const cycleLabel = order?.cycle_name || order?.cycle_code || ''
  const deptLabel = order?.departments?.name || '—'

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0)

  const downloadPDF = async () => {
    if (!order) return
    setDownloading(true)
    try {
      const { jsPDF } = await import('jspdf')
      const autoTableMod = await import('jspdf-autotable')
      const autoTable = autoTableMod?.default ?? autoTableMod
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const marginX = 12

      // Header band
      doc.setFillColor(21, 128, 61)
      doc.rect(marginX, 10, pageWidth - marginX * 2, 18, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(13)
      doc.text('CBN Coop · Order Sheet', marginX + 6, 17)
      doc.setFontSize(9)
      doc.text(module === 'exhibition' ? 'Coop Exhibition' : 'Food Distribution', marginX + 6, 23)
      doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - marginX, 23, { align: 'right' })

      // Order meta table
      const metaRows = [
        ['Order ID', String(orderRef), 'Status', String(status)],
        ['Date', new Date(order.created_at || Date.now()).toLocaleString(), 'Payment', String(payment)],
        ['Member', `${memberName || '—'} (${memberId || '—'})`, 'Branch', String(branchName)],
      ]
      if (module === 'exhibition' && cycleLabel) metaRows.push(['Cycle', String(cycleLabel), '', ''])
      if (module === 'food') metaRows.push(['Department', String(deptLabel), '', ''])

      autoTable(doc, {
        head: [['Order Details', '', '', '']],
        body: metaRows,
        startY: 34,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 74 }, 2: { cellWidth: 24 }, 3: { cellWidth: 74 } },
        margin: { left: marginX, right: marginX },
      })

      // Line items — grouped by vendor for exhibition
      if (module === 'exhibition') {
        let startY = (doc.lastAutoTable?.finalY || 0) + 8
        for (const v of perVendor) {
          const head = [[`VENDOR: ${v.vendorName}`, '', '', '']]
          const body = v.lines.map((l) => [
            String(l.name || '').slice(0, 40),
            String(l.unit || ''),
            String(l.qty),
            currencyPDF(l.amount),
          ])
          const sub = [['Subtotal', '', String(v.qty), currencyPDF(v.amount)]]
          const firstLineStart = startY
          autoTable(doc, {
            head,
            body: [...body, ...sub],
            startY: firstLineStart,
            rowPageBreak: 'avoid',
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
            headStyles: { fillColor: [21, 128, 61], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: {
              0: { cellWidth: 120 },
              1: { cellWidth: 34 },
              2: { cellWidth: 20, halign: 'right' },
              3: { cellWidth: 28, halign: 'right' },
            },
            didParseCell: (data) => {
              if (data.section === 'body' && data.row.index === body.length) {
                data.cell.styles.fontStyle = 'bold'
                data.cell.styles.fillColor = [240, 253, 244]
              }
            },
            margin: { left: marginX, right: marginX },
          })
          startY = (doc.lastAutoTable?.finalY || 0) + 6
        }
      } else {
        const head = [['Item', 'Qty', 'Unit Price', 'Amount']]
        const body = lines.map((l) => [
          String(l.name || '').slice(0, 60),
          String(l.qty),
          currencyPDF(Number(order?.order_lines?.[lines.indexOf(l)]?.unit_price || 0)),
          currencyPDF(l.amount),
        ])
        autoTable(doc, {
          head,
          body,
          startY: (doc.lastAutoTable?.finalY || 0) + 8,
          rowPageBreak: 'avoid',
          theme: 'grid',
          styles: { fontSize: 9, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
          headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 130 },
            1: { cellWidth: 20, halign: 'right' },
            2: { cellWidth: 28, halign: 'right' },
            3: { cellWidth: 28, halign: 'right' },
          },
          margin: { left: marginX, right: marginX },
        })
      }

      // Totals row
      autoTable(doc, {
        head: [],
        body: [['TOTAL', '', String(totalQty), currencyPDF(totalAmount)]],
        startY: (doc.lastAutoTable?.finalY || 0) + 2,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [0, 0, 0], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 34 }, 2: { cellWidth: 20, halign: 'right' }, 3: { cellWidth: 28, halign: 'right' } },
        margin: { left: marginX, right: marginX },
      })

      // Signature block for the market handover
      autoTable(doc, {
        head: [],
        body: [
          ['Prepared by: ______________________', 'Signature: _______________', 'Date: ___________'],
          ['Received by: ______________________', 'Signature: _______________', 'Date: ___________'],
        ],
        startY: (doc.lastAutoTable?.finalY || 0) + 10,
        rowPageBreak: 'avoid',
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 1, textColor: [0, 0, 0] },
        columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 56 }, 2: { cellWidth: 46 } },
        margin: { left: marginX, right: marginX },
      })

      doc.save(`OrderSheet_${String(orderRef).replace(/[^a-z0-9]+/gi, '-')}.pdf`)
    } catch (e) {
      alert(`PDF error: ${e?.message || 'Failed to generate PDF'}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="oPS-root fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Overlay */}
          <div className="oPS-overlay absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${module === 'exhibition' ? 'Exhibition' : 'Food'} order sheet`}
            tabIndex={-1}
            className="oPS-panel relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
          >
            {/* Screen-only header row — stacks on mobile so Print/Download never clip */}
            <div className="oPS-printHide flex flex-col gap-3 border-b border-line-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <ModuleIcon className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-fg">Order sheet</h2>
                  <p className="truncate text-xs text-muted">
                    {meta.title} · {orderRef}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" leftIcon={Printer} onClick={() => window.print()}>
                  Print sheet
                </Button>
                <Button size="sm" leftIcon={FileText} onClick={downloadPDF} disabled={downloading}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </Button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable sheet area */}
            <div className="oPS-body min-h-0 flex-1 overflow-y-auto bg-canvas/50 p-4 sm:p-5">
              {!order ? (
                <p className="py-10 text-center text-sm text-muted">No order data for this sheet.</p>
              ) : (
                <div className="receipt-sheet overflow-hidden rounded-2xl border border-line bg-white text-fg shadow-lg shadow-black/5">
                  {/* Sheet header */}
                  <div className="border-b border-line bg-gradient-to-r from-brand to-brand-active px-5 py-4 sm:px-6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25">
                          <ModuleIcon className="h-5 w-5" strokeWidth={2} />
                        </div>
                        <div>
                          <p className="text-sm font-bold tracking-wide text-white">CBN COOP</p>
                          <p className="text-chips text-white/80">{meta.title}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-chips font-semibold uppercase tracking-wider text-white/80">Order sheet</p>
                        <p className="text-sm font-bold tabular-nums text-white">{orderRef}</p>
                      </div>
                    </div>
                  </div>

                  {/* Meta grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-sm sm:grid-cols-3 sm:px-6">
                    <div>
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Date</p>
                      <p className="font-medium text-fg">{formatDate(order.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Status</p>
                      <p className="font-medium text-fg">{status}</p>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Payment</p>
                      <p className="font-medium text-fg">{payment}</p>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Member</p>
                      <p className="font-medium text-fg">
                        {memberName && memberName !== memberId ? (
                          <>
                            {memberName}
                            {memberId ? <span className="text-muted"> · {memberId}</span> : null}
                          </>
                        ) : (
                          memberId || '—'
                        )}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">
                        {module === 'food' ? 'Delivery branch' : 'Branch'}
                      </p>
                      <p className="font-medium text-fg">{branchName}</p>
                    </div>
                    {module === 'exhibition' && cycleLabel && (
                      <div className="col-span-2 sm:col-span-3">
                        <p className="text-chips font-medium uppercase tracking-wider text-muted">Cycle</p>
                        <p className="font-medium text-fg">{cycleLabel}</p>
                      </div>
                    )}
                    {module === 'food' && (
                      <div className="col-span-2 sm:col-span-3">
                        <p className="text-chips font-medium uppercase tracking-wider text-muted">Department</p>
                        <p className="font-medium text-fg">{deptLabel}</p>
                      </div>
                    )}
                  </div>

                  {/* Lines — exhibition groups by vendor */}
                  {module === 'exhibition' ? (
                    <div className="border-b border-line">
                      {perVendor.map((v, vi) => (
                        <div key={v.vendorId ?? vi} className={vi > 0 ? 'border-t border-line/70' : ''}>
                          <div className="flex items-center justify-between gap-3 bg-brand/5 px-5 py-2 sm:px-6">
                            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand">
                              <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                              {v.vendorName || 'Vendor'}
                            </p>
                            <p className="text-chips text-muted">
                              {v.qty.toLocaleString()} item{v.qty === 1 ? '' : 's'}
                            </p>
                          </div>
                          <table className="receipt-table w-full text-sm">
                            <thead>
                              <tr className="border-b border-line bg-subtle/60">
                                <th className="px-5 py-2 text-left text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Item</th>
                                <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Qty</th>
                                <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Unit</th>
                                <th className="px-5 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {v.lines.map((l) => (
                                <tr key={l.key} className="border-b border-line/70 last:border-0">
                                  <td className="px-5 py-2.5 font-medium text-fg sm:px-6">{l.name}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-fg">{l.qty}</td>
                                  <td className="px-3 py-2.5 text-right text-muted">{l.unit || '-'}</td>
                                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-fg sm:px-6">{naira(l.amount)}</td>
                                </tr>
                              ))}
                              <tr className="bg-brand-subtle/40">
                                <td className="px-5 py-2 text-right text-chips font-semibold uppercase tracking-wider text-brand sm:px-6">Vendor subtotal</td>
                                <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">{v.qty}</td>
                                <td className="px-3 py-2" />
                                <td className="px-5 py-2 text-right font-bold tabular-nums text-brand sm:px-6">{naira(v.amount)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-x-auto border-b border-line">
                      <table className="receipt-table w-full text-sm">
                        <thead>
                          <tr className="border-b border-line bg-subtle/60">
                            <th className="px-5 py-2 text-left text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Item</th>
                            <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Qty</th>
                            <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Unit Price</th>
                            <th className="px-5 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l, idx) => (
                            <tr key={l.key} className="border-b border-line/70 last:border-0">
                              <td className="px-5 py-2.5 font-medium text-fg sm:px-6">{l.name}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-fg">{l.qty}</td>
                              <td className="px-3 py-2.5 text-right text-muted">
                                {naira(order?.order_lines?.[idx]?.unit_price || 0)}
                              </td>
                              <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-fg sm:px-6">{naira(l.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Totals */}
                  <div className="flex flex-col gap-1 border-b-2 border-line bg-subtle/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-xs font-medium text-muted">
                      {lines.length} line{lines.length === 1 ? '' : 's'}
                      {module === 'exhibition' && perVendor.length > 0
                        ? ` · ${perVendor.length} vendor${perVendor.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                    <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-8">
                      <span className="text-sm font-medium text-muted">Total quantity</span>
                      <span className="font-semibold tabular-nums text-fg">{totalQty.toLocaleString()}</span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-fg">Total</span>
                      <span className="text-lg font-bold tabular-nums text-brand">{naira(totalAmount)}</span>
                    </div>
                  </div>

                  {/* Signature block — the market handover artifact */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-8 px-5 py-6 sm:px-6">
                    <div>
                      <p className="text-chips font-semibold uppercase tracking-wider text-muted">Prepared by</p>
                      <p className="mt-1 text-sm text-fg">{module === 'exhibition' ? 'Rep / Admin' : 'Rep / Admin'}</p>
                      <div className="mt-6 border-t border-dashed border-line-strong pt-1 text-chips text-muted">Signature / date</div>
                    </div>
                    <div>
                      <p className="text-chips font-semibold uppercase tracking-wider text-muted">Received by</p>
                      <p className="mt-1 text-sm text-fg">{module === 'exhibition' ? 'Vendor' : 'Delivery rep / member'}</p>
                      <div className="mt-6 border-t border-dashed border-line-strong pt-1 text-chips text-muted">Signature / date</div>
                    </div>
                  </div>

                  <div className="border-t border-line px-5 py-4 text-center sm:px-6">
                    <p className="text-chips text-muted">CBN Coop Seasonal Sales — keep this sheet with the goods until handover.</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Print rules: hide the whole page, then reveal only this modal's
              sheet — the classic print-one-element pattern. */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .oPS-root, .oPS-root * { visibility: visible; }
              .oPS-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                padding: 0 !important;
                overflow: visible !important;
                display: block !important;
              }
              .oPS-overlay { display: none !important; }
              .oPS-printHide { display: none !important; }
              .oPS-panel {
                max-height: none !important;
                overflow: visible !important;
                border: none !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                background: #fff !important;
                width: 100% !important;
                max-width: none !important;
                margin: 0 !important;
              }
              .oPS-body {
                overflow: visible !important;
                padding: 0 !important;
                background: #fff !important;
              }
              html, body { background: #fff !important; }
              .receipt-sheet {
                box-shadow: none !important;
                border: 1px solid #000 !important;
                border-radius: 0 !important;
              }
              .receipt-sheet, .receipt-sheet * { color: #000 !important; }
              .receipt-table th, .receipt-table td { border-color: #000 !important; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
