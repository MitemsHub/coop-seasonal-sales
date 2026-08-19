'use client'

// app/components/OrderReceiptModal.jsx
// Print-friendly receipt viewer for the member /orders hub. Mirrors the
// receipt-sheet markup + Print / Download PDF actions of the three success
// pages (shop, ram, exhibition) so any order — regardless of status — can be
// printed or saved as PDF straight from the order list.
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Beef, FileText, Printer, ShoppingBasket, Store, X } from 'lucide-react'
import Image from 'next/image'
import useFocusTrap from '../hooks/useFocusTrap'
import Button from './ui/Button'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`
// ASCII-only currency for the PDF so the glyph never scrambles in viewers.
const currencyPDF = (v) => `NGN ${Number(v || 0).toLocaleString()}`

const MODULE_META = {
  food: { icon: ShoppingBasket, title: 'Seasonal Sales · Food Distribution' },
  ram: { icon: Beef, title: 'Seasonal Sales · Ram Sales' },
  exhibition: { icon: Store, title: 'Seasonal Sales · Exhibition' },
}

export default function OrderReceiptModal({
  open,
  onClose,
  module = 'food',
  order,
  memberId = '',
  memberName = '',
  ramLocation = null,
}) {
  const panelRef = useRef(null)
  const [downloading, setDownloading] = useState(false)

  useFocusTrap({ open, panelRef, breakpoint: null, lockScroll: true, onClose })

  const meta = MODULE_META[module] || MODULE_META.food
  const ModuleIcon = meta.icon

  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

  const downloadPDF = async () => {
    if (!order) return
    setDownloading(true)
    try {
      const { jsPDF } = await import('jspdf')

      if (module === 'ram') {
        const autoTableMod = await import('jspdf-autotable')
        const autoTable = autoTableMod?.default ?? autoTableMod
        const doc = new jsPDF()
        const pageWidth = doc.internal.pageSize.getWidth()
        const marginX = 12
        const headerY = 10
        const headerH = 18

        doc.setFillColor(21, 128, 61)
        doc.rect(marginX, headerY, pageWidth - marginX * 2, headerH, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(14)
        doc.text('CBN Coop · Ram Sales Receipt', marginX + 6, headerY + 12)

        doc.setTextColor(0, 0, 0)
        doc.setFontSize(9)
        doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - marginX, headerY + 12, { align: 'right' })

        autoTable(doc, {
          head: [['Order Details', '', '', '']],
          body: [
            ['Order ID', `#${order.id}`, 'Status', String(order.status || '—')],
            ['Date', new Date(order.created_at).toLocaleString(), 'Payment', String(order.payment_option || '—')],
            ['Member', `${memberName || '—'} (${memberId || order.member_id || ''})`, 'Quantity', String(Number(order.qty || 0).toLocaleString())],
            ['Unit Price', currencyPDF(order.unit_price), 'Total', currencyPDF(order.total_amount)],
          ],
          startY: headerY + headerH + 6,
          rowPageBreak: 'avoid',
          theme: 'grid',
          styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
          headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 66 }, 2: { cellWidth: 26 }, 3: { cellWidth: 66 } },
          margin: { left: marginX, right: marginX },
        })

        autoTable(doc, {
          head: [['Amount Breakdown', '', '']],
          body: [
            ['Principal', currencyPDF(order.principal_amount), ''],
            ['Interest', currencyPDF(order.interest_amount), ''],
            ['Total', currencyPDF(order.total_amount), ''],
          ],
          startY: (doc.lastAutoTable?.finalY || 0) + 6,
          rowPageBreak: 'avoid',
          theme: 'grid',
          styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
          headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 40 }, 1: { halign: 'right', cellWidth: 60 }, 2: { cellWidth: 84 } },
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index === 2) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [240, 253, 244]
            }
          },
          margin: { left: marginX, right: marginX },
        })

        const vendorRows = [
          ['Delivery Location', String(ramLocation?.delivery_location || ramLocation?.name || '—')],
          ['Vendor Name', String(ramLocation?.name || '—')],
          ['Vendor Phone No', String(ramLocation?.phone || '—')],
        ]
        if (ramLocation?.address) vendorRows.push(['Vendor Address', String(ramLocation.address)])

        autoTable(doc, {
          head: [['Vendor Details', '']],
          body: vendorRows,
          startY: (doc.lastAutoTable?.finalY || 0) + 6,
          rowPageBreak: 'avoid',
          theme: 'grid',
          styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
          headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 166 } },
          margin: { left: marginX, right: marginX },
        })

        doc.save(`RamOrder_${order.id}.pdf`)
        return
      }

      const doc = new jsPDF()
      if (module === 'exhibition') {
        doc.setFontSize(16)
        doc.text('CBN Coop Seasonal Sales - Exhibition Receipt', 10, 12)
        doc.setFontSize(10)
        doc.text(`Order ID: ${order.order_id}`, 10, 20)
        doc.text(`Status: ${order.status}`, 120, 20)
        doc.text(`Date: ${new Date(order.created_at).toLocaleString()}`, 10, 26)
        doc.text(`Member: ${order.member_name_snapshot || memberId} (${memberId})`, 10, 34)
        doc.text(`Branch: ${order.branch?.name || '-'}`, 10, 40)
        doc.text(`Payment: ${order.payment_option}`, 10, 46)

        let y = 52
        doc.setFontSize(11)
        doc.text('Items', 10, y); y += 6
        doc.setFontSize(10)
        doc.text('Item', 10, y)
        doc.text('Vendor', 62, y)
        doc.text('Qty', 115, y)
        doc.text('Unit', 135, y)
        doc.text('Amount', 165, y)
        y += 5
        doc.line(10, y, 200, y); y += 4

        ;(order.lines || []).forEach((l) => {
          doc.text(String(l.product_name || '').slice(0, 30), 10, y)
          doc.text(String(l.vendor_name || '-').slice(0, 22), 62, y)
          doc.text(String(l.qty), 120, y, { align: 'right' })
          doc.text(String(l.unit || ''), 135, y)
          doc.text(currencyPDF(l.amount), 165, y)
          y += 6
          if (y > 270) { doc.addPage(); y = 20 }
        })

        y += 4
        doc.line(120, y, 200, y); y += 6
        doc.setFontSize(12)
        doc.text(`Total: ${currencyPDF(order.total_amount)}`, 165, y, { align: 'right' })
        doc.save(`Exhibition_Receipt_${order.order_id}.pdf`)
        return
      }

      // Food
      const principal = Number(
        order?.principal_amount ?? (order?.order_lines || []).reduce((s, l) => s + Number(l.amount || 0), 0)
      )
      const interest = order?.payment_option === 'Loan' ? Number(order?.loan_interest_amount || 0) : 0
      const ratePct = Number(order?.loan_interest_rate_pct ?? 13)
      const totalWithInterest = order?.payment_option === 'Loan' ? principal + interest : Number(order?.total_amount || 0)

      doc.setFontSize(16)
      doc.text('CBN Coop Seasonal Sales - Order Receipt', 10, 12)
      doc.setFontSize(10)
      doc.text(`Order ID: ${order.order_id}`, 10, 20)
      doc.text(`Status: ${order.status}`, 60, 20)
      doc.text(`Date: ${new Date(order.created_at).toLocaleString()}`, 10, 26)

      doc.text(`Member: ${order.member_name_snapshot || memberName || memberId} (${memberId || order.member_id || ''})`, 10, 34)
      doc.text(`Member Branch: ${order.member_branch?.name || order.branches?.name || '-'}`, 10, 40)
      doc.text(`Delivery: ${order.delivery?.name || '-'}`, 10, 46)
      doc.text(`Rep Phone: ${order.delivery?.rep_phone || '-'}`, 10, 52)
      doc.text(`Department: ${order.departments?.name || '-'}`, 10, 58)
      doc.text(`Payment: ${order.payment_option}`, 10, 64)

      let y = 70
      doc.setFontSize(11)
      doc.text('Items', 10, y); y += 6
      doc.setFontSize(10)
      doc.text('Item', 10, y)
      doc.text('Qty', 120, y)
      doc.text('Unit', 140, y)
      doc.text('Amount', 165, y)
      y += 5
      doc.line(10, y, 200, y); y += 4

      ;(order.order_lines || []).forEach((l) => {
        doc.text(l.items?.name || '', 10, y)
        doc.text(String(l.qty), 125, y, { align: 'right' })
        doc.text(currencyPDF(l.unit_price), 140, y)
        doc.text(currencyPDF(l.amount), 165, y)
        y += 6
        if (y > 270) { doc.addPage(); y = 20 }
      })

      y += 4
      doc.line(120, y, 200, y); y += 6
      doc.setFontSize(12)
      if (order.payment_option === 'Loan') {
        doc.text(`Principal: ${currencyPDF(principal)}`, 165, y, { align: 'right' })
        y += 6
        doc.text(`Interest (${ratePct}%): ${currencyPDF(interest)}`, 165, y, { align: 'right' })
        y += 6
        doc.text(`Total (incl. Interest): ${currencyPDF(totalWithInterest)}`, 165, y, { align: 'right' })
      } else {
        doc.text(`Total: ${currencyPDF(order.total_amount)}`, 165, y, { align: 'right' })
      }
      doc.save(`Order_${order.order_id}.pdf`)
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
          className="oRM-root fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Overlay */}
          <div className="oRM-overlay absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Order ${module} receipt`}
            tabIndex={-1}
            className="oRM-panel relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
          >
            {/* Screen-only header row — stacks on mobile so Print/Download
                never clip; wraps the button group if a label still overflows. */}
            <div className="oRM-printHide flex flex-col gap-3 border-b border-line-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <ModuleIcon className="h-4 w-4" strokeWidth={2} />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-fg">Order receipt</h2>
                  <p className="text-xs text-muted">
                    {meta.title}
                    {order?.order_id || order?.id ? ` · ${order.order_id || order.id}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" leftIcon={Printer} onClick={() => window.print()}>
                  Print receipt
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

            {/* Scrollable receipt area */}
            <div className="oRM-body min-h-0 flex-1 overflow-y-auto bg-canvas/50 p-4 sm:p-5">
              {!order ? (
                <p className="py-10 text-center text-sm text-muted">No receipt data for this order.</p>
              ) : (
                <div className="receipt-sheet overflow-hidden rounded-2xl border border-line bg-white text-fg shadow-lg shadow-black/5">
                  {/* Receipt header */}
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
                        <p className="text-chips font-semibold uppercase tracking-wider text-white/80">Receipt</p>
                        <p className="text-sm font-bold tabular-nums text-white">{order.order_id || `#${order.id}`}</p>
                      </div>
                    </div>
                  </div>

                  {/* Receipt meta */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-sm sm:grid-cols-3 sm:px-6">
                    <div>
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Date</p>
                      <p className="font-medium text-fg">{formatDate(order.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Status</p>
                      <p className="font-medium text-fg">{order.status}</p>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Payment</p>
                      <p className="font-medium text-fg">{order.payment_option}</p>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-chips font-medium uppercase tracking-wider text-muted">Member</p>
                      <p className="font-medium text-fg">
                        {(() => {
                          const name =
                            module === 'ram'
                              ? memberName || ''
                              : order.member_name_snapshot || memberName || ''
                          const id = memberId || order.member_id || ''
                          const branch =
                            module !== 'ram'
                              ? order.member_branch?.name || order.branches?.name || order.branch?.name || ''
                              : ''
                          return (
                            <>
                              {name && name !== id ? (
                                <>
                                  {name}
                                  {id ? <span className="text-muted"> · {id}</span> : null}
                                </>
                              ) : (
                                id
                              )}
                              {branch ? <span className="text-muted"> · {branch}</span> : null}
                            </>
                          )
                        })()}
                      </p>
                    </div>
                    {module === 'food' && (
                      <>
                        <div className="col-span-2 sm:col-span-3">
                          <p className="text-chips font-medium uppercase tracking-wider text-muted">Delivery</p>
                          <p className="font-medium text-fg">
                            {order.delivery?.name || '-'}
                            {order.delivery?.rep_phone ? <span className="text-muted"> · Rep: {order.delivery.rep_phone}</span> : null}
                          </p>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <p className="text-chips font-medium uppercase tracking-wider text-muted">Department</p>
                          <p className="font-medium text-fg">{order.departments?.name || order.department || '-'}</p>
                        </div>
                      </>
                    )}
                  </div>

                  {module === 'ram' ? (
                    <>
                      {/* Ram order details */}
                      <div className="border-b border-line px-5 py-4 sm:px-6">
                        <div className="mb-3 text-chips font-semibold uppercase tracking-wider text-muted">Order details</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                          <div>
                            <p className="text-chips font-medium uppercase tracking-wider text-muted">Quantity</p>
                            <p className="font-medium tabular-nums text-fg">{Number(order.qty || 0).toLocaleString()} ram(s)</p>
                          </div>
                          <div>
                            <p className="text-chips font-medium uppercase tracking-wider text-muted">Unit price</p>
                            <p className="font-medium tabular-nums text-fg">{naira(order.unit_price)}</p>
                          </div>
                          <div>
                            <p className="text-chips font-medium uppercase tracking-wider text-muted">Principal</p>
                            <p className="font-medium tabular-nums text-fg">{naira(order.principal_amount)}</p>
                          </div>
                          <div>
                            <p className="text-chips font-medium uppercase tracking-wider text-muted">Interest</p>
                            <p className="font-medium tabular-nums text-fg">{naira(order.interest_amount)}</p>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <p className="text-chips font-medium uppercase tracking-wider text-muted">Total</p>
                            <p className="font-semibold tabular-nums text-fg">{naira(order.total_amount)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Ram vendor */}
                      <div className="border-b border-line px-5 py-4 sm:px-6">
                        <div className="mb-3 text-chips font-semibold uppercase tracking-wider text-muted">Vendor details</div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted">Delivery location</span>
                            <span className="font-medium text-right text-fg">{ramLocation?.delivery_location || ramLocation?.name || '—'}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted">Vendor name</span>
                            <span className="font-medium text-right text-fg">{ramLocation?.name || '—'}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted">Vendor phone</span>
                            <span className="font-medium text-right text-fg">{ramLocation?.phone || '—'}</span>
                          </div>
                          {ramLocation?.address && (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted">Vendor address</span>
                              <span className="font-medium text-right text-fg">{ramLocation.address}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Food / exhibition lines */
                    <div className="overflow-x-auto">
                      <table className="receipt-table w-full text-sm">
                        <thead>
                          <tr className="border-b border-line bg-subtle/60">
                            <th className="px-5 py-2 text-left text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Item</th>
                            {module === 'exhibition' && (
                              <th className="px-3 py-2 text-left text-chips font-semibold uppercase tracking-wider text-muted">Vendor</th>
                            )}
                            <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Qty</th>
                            <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Unit</th>
                            <th className="px-5 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {module === 'exhibition'
                            ? (order.lines || []).map((l) => (
                                <tr key={l.id} className="border-b border-line/70 last:border-0">
                                  <td className="px-5 py-2.5 font-medium text-fg sm:px-6">
                                    <span className="flex items-center gap-2.5">
                                      <span className="relative hidden h-8 w-8 shrink-0 overflow-hidden rounded-md bg-subtle sm:block">
                                        <Image
                                          src={l.image_url || '/images/items/placeholder.svg'}
                                          alt=""
                                          fill
                                          sizes="32px"
                                          className="object-cover"
                                          onError={(e) => {
                                            e.currentTarget.src = '/images/items/placeholder.svg'
                                          }}
                                        />
                                      </span>
                                      {l.product_name}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-muted">{l.vendor_name || '-'}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-fg">{l.qty}</td>
                                  <td className="px-3 py-2.5 text-right text-muted">{l.unit || '-'}</td>
                                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-fg sm:px-6">{naira(l.amount)}</td>
                                </tr>
                              ))
                            : (order.order_lines || []).map((l, idx) => (
                                <tr key={idx} className="border-b border-line/70 last:border-0">
                                  <td className="px-5 py-2.5 font-medium text-fg sm:px-6">{l.items?.name}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-fg">{l.qty}</td>
                                  <td className="px-3 py-2.5 text-right text-muted">{naira(l.unit_price)}</td>
                                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-fg sm:px-6">{naira(l.amount)}</td>
                                </tr>
                              ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Receipt total */}
                  <div className="border-t-2 border-line bg-subtle/40 px-5 py-4 sm:px-6">
                    {module === 'food' && order.payment_option === 'Loan' ? (
                      <div className="space-y-1 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-muted">Principal</p>
                          <p className="tabular-nums text-fg">{naira(order.principal_amount)}</p>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-muted">Interest ({order.loan_interest_rate_pct}%)</p>
                          <p className="tabular-nums text-fg">{naira(order.loan_interest_amount)}</p>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2">
                          <p className="text-sm font-semibold uppercase tracking-wide text-fg">Total (incl. interest)</p>
                          <p className="text-lg font-bold tabular-nums text-brand">{naira(order.total_amount)}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold uppercase tracking-wide text-fg">Total</p>
                        <p className="text-lg font-bold tabular-nums text-brand">{naira(order.total_amount)}</p>
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-4 text-center sm:px-6">
                    <p className="text-chips text-muted">Thank you for shopping with CBN Coop — every order keeps the Coop strong.</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Print rules: hide the whole page, then reveal only this modal's
              receipt sheet — the classic print-one-element pattern. */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .oRM-root, .oRM-root * { visibility: visible; }
              .oRM-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                padding: 0 !important;
                overflow: visible !important;
                display: block !important;
              }
              .oRM-overlay { display: none !important; }
              .oRM-printHide { display: none !important; }
              .oRM-panel {
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
              .oRM-body {
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
              .receipt-sheet img { display: none !important; }
              .receipt-table th, .receipt-table td { border-color: #000 !important; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
