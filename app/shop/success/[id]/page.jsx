// app/shop/success/[id]/page.jsx
// Order confirmation after a member submits a food order.
// Includes a print-friendly receipt layout + Print receipt / Download PDF
// actions, matching the exhibition success page's standard.
'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '../../../contexts/AuthContext'
import { CheckCircle2, FileText, Home, Printer, Receipt, ShoppingBasket } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'

function SuccessContent() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id
  const mid = (searchParams?.get('mid') || '').trim().toUpperCase()
  const { user } = useAuth()
  const fallbackMemberId = mid || (user?.id || '')

  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!mid) return
    if (!id) return
    router.replace(`/shop/success/${encodeURIComponent(id)}`)
  }, [id, mid, router])

  const currency = (n) => `₦${Number(n || 0).toLocaleString()}`
  // Use ASCII-only currency for PDF to avoid Unicode glyph issues
  const currencyPDF = (n) => `NGN ${Number(n || 0).toLocaleString()}`

  // Safe JSON helper
  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  const loadOrder = async () => {
    setError(null)
    try {
      // 1) Primary fetch by order id
      const res = await fetch(`/api/orders/${id}`, { cache: 'no-store' })
      if (res.ok) {
        const json = await safeJson(res, `/api/orders/${id}`)
        if (json.ok) { setOrder(json.order); return }
      }

      // 2) Fallback: latest order by member (if mid present)
      if (fallbackMemberId) {
        const qs = new URLSearchParams({ id: fallbackMemberId, limit: '1' }).toString()
        const r2 = await fetch(`/api/members/orders?${qs}`, { cache: 'no-store' })
        const j2 = await safeJson(r2, `/api/members/orders?${qs}`)
        if (j2.ok && Array.isArray(j2.orders) && j2.orders.length > 0) {
          setOrder(j2.orders[0]); return
        }
      }

      setError('Order not found')
    } catch (e) {
      setError(e.message || 'Failed to load order')
    }
  }

  useEffect(() => {
    if (id) loadOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fallbackMemberId])

  const principalAmount = Number(
    order?.principal_amount ?? (order?.order_lines || []).reduce((s, l) => s + Number(l.amount || 0), 0)
  )
  const interestAmount = order?.payment_option === 'Loan' ? Number(order?.loan_interest_amount || 0) : 0
  const ratePct = Number(order?.loan_interest_rate_pct ?? 13)
  const totalWithInterest = order?.payment_option === 'Loan' ? principalAmount + interestAmount : Number(order?.total_amount || 0)

  const downloadPDF = async () => {
    if (!order) return
    setDownloading(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF()

      doc.setFontSize(16)
      doc.text('CBN Coop Seasonal Sales - Order Receipt', 10, 12)
      doc.setFontSize(10)
      doc.text(`Order ID: ${order.order_id}`, 10, 20)
      doc.text(`Status: ${order.status}`, 60, 20)
      doc.text(`Date: ${new Date(order.created_at).toLocaleString()}`, 10, 26)

      doc.text(`Member: ${order.member_name_snapshot} (${order.member_id})`, 10, 34)
      doc.text(`Member Branch: ${order.member_branch?.name || '-'}`, 10, 40)
      doc.text(`Delivery: ${order.delivery?.name || '-'}`, 10, 46)
      doc.text(`Rep Phone: ${order.delivery?.rep_phone || '-'}`, 10, 52)
      doc.text(`Department: ${order.departments?.name || '-'}`, 10, 58)
      doc.text(`Payment: ${order.payment_option}`, 10, 64)

      let y = 70
      doc.setFontSize(11)
      doc.text('Items', 10, y); y += 6
      doc.setFontSize(10)
      // Removed SKU column for member-facing receipt
      doc.text('Item', 10, y)
      doc.text('Qty', 120, y)
      doc.text('Unit', 140, y)
      doc.text('Amount', 165, y)
      y += 5
      doc.line(10, y, 200, y); y += 4

      ;(order.order_lines || []).forEach((l) => {
        // No SKU shown
        doc.text(l.items?.name || '', 10, y)
        doc.text(String(l.qty), 125, y, { align: 'right' })
        // Avoid ₦ in PDF (may scramble in some viewers)
        doc.text(currencyPDF(l.unit_price), 140, y)
        doc.text(currencyPDF(l.amount), 165, y)
        y += 6
        if (y > 270) { doc.addPage(); y = 20 }
      })

      y += 4
      doc.line(120, y, 200, y); y += 6
      doc.setFontSize(12)
      // Payment breakdown for Loan option
      if (order.payment_option === 'Loan') {
        doc.text(`Principal: ${currencyPDF(principalAmount)}`, 165, y, { align: 'right' })
        y += 6
        doc.text(`Interest (${ratePct}%): ${currencyPDF(interestAmount)}`, 165, y, { align: 'right' })
        y += 6
        doc.text(`Total (incl. Interest): ${currencyPDF(totalWithInterest)}`, 165, y, { align: 'right' })
      } else {
        doc.text(`Total: ${currencyPDF(order.total_amount)}`, 165, y, { align: 'right' })
      }

      doc.save(`Order_${order.order_id}.pdf`)
    } catch (e) {
      alert(`PDF error: ${e.message}`)
    } finally {
      setDownloading(false)
    }
  }

  if (error) return <div className="p-6">Error: {error}</div>
  if (!order) return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <Skeleton className="mx-auto h-5 w-2/3" />
        <Skeleton className="mx-auto mt-3 h-5 w-1/2" />
      </div>
    </div>
  )

  return (
    <>
      {/* Print rules: only the receipt sheet survives on paper. */}
      <style>{`
        @media print {
          .print-hide { display: none !important; }
          html, body { background: #fff !important; }
          .receipt-sheet {
            box-shadow: none !important;
            border: 1px solid #000 !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }
          .receipt-sheet, .receipt-sheet * { color: #000 !important; }
          .receipt-sheet img { display: none !important; }
          .receipt-table th, .receipt-table td { border-color: #000 !important; }
        }
      `}</style>

      <div className="min-h-screen bg-canvas">
        <div aria-hidden="true" className="print-hide pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-2xl p-fluid pb-24">
          {/* Confirmation card — screen only */}
          <div className="print-hide rounded-2xl border border-line bg-surface p-6 text-center shadow-lg shadow-black/5 sm:p-8">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg ring-8 ring-success-bg/40">
              <CheckCircle2 className="h-8 w-8" strokeWidth={2} />
            </div>

            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-chips font-semibold uppercase tracking-wide text-brand-fg">
              <ShoppingBasket className="h-3.5 w-3.5" strokeWidth={2.2} />
              Food Distribution
            </div>
            <h1 className="mt-2 font-display text-h1 font-semibold tracking-tight text-fg">Order placed!</h1>
            <p className="mt-1 text-sm text-muted">
              Your order is <span className="font-semibold text-warning-fg">Pending</span> — your branch rep will post it, then deliver to your branch.
            </p>

            <div className="mt-6 space-y-4 text-left">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-4 py-3">
                <span className="text-chips font-medium text-muted">Order ID</span>
                <span className="text-sm font-bold tabular-nums text-fg">{order.order_id}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-4 py-3">
                <span className="text-chips font-medium text-muted">Payment</span>
                <span className="text-sm font-bold text-fg">{order.payment_option}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-4 py-3">
                <span className="text-chips font-medium text-muted">Total</span>
                <span className="text-sm font-bold tabular-nums text-brand">{currency(order.total_amount)}</span>
              </div>

              <div className="space-y-2 rounded-xl border border-line bg-canvas/60 p-4">
                <p className="text-chips font-semibold uppercase tracking-wider text-muted">Your items</p>
                {(order.order_lines || []).map((l, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{l.items?.name}</div>
                      <div className="text-chips text-muted">
                        {l.qty} × {currency(l.unit_price)}
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-nums text-fg">{currency(l.amount)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" leftIcon={Receipt} onClick={() => router.push('/orders')}>
                Track my orders
              </Button>
              <Button variant="secondary" className="flex-1" leftIcon={Home} onClick={() => router.push('/my-coop')}>
                My Coop
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => router.push('/shop')}>
                Keep browsing
              </Button>
            </div>
          </div>

          {/* Receipt — printable */}
          <div className="mt-6">
            <div className="print-hide mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-chips font-semibold uppercase tracking-wider text-muted">Receipt</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" leftIcon={Printer} onClick={() => window.print()}>
                  Print receipt
                </Button>
                <Button size="sm" leftIcon={FileText} onClick={downloadPDF} disabled={downloading}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </Button>
              </div>
            </div>

            <div className="receipt-sheet overflow-hidden rounded-2xl border border-line bg-white text-fg shadow-lg shadow-black/5">
              {/* Receipt header */}
              <div className="border-b border-line bg-gradient-to-r from-brand to-brand-active px-5 py-4 sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25">
                      <ShoppingBasket className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <div>
                      <p className="text-sm font-bold tracking-wide text-white">CBN COOP</p>
                      <p className="text-chips text-white/80">Seasonal Sales · Food Distribution</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-chips font-semibold uppercase tracking-wider text-white/80">Receipt</p>
                    <p className="text-sm font-bold tabular-nums text-white">{order.order_id}</p>
                  </div>
                </div>
              </div>

              {/* Receipt meta */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-sm sm:grid-cols-3 sm:px-6">
                <div>
                  <p className="text-chips font-medium uppercase tracking-wider text-muted">Date</p>
                  <p className="font-medium text-fg">{new Date(order.created_at).toLocaleDateString()}</p>
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
                    {order.member_name_snapshot || order.member_id}
                    <span className="text-muted"> · {order.member_id}</span>
                    {order.member_branch?.name ? <span className="text-muted"> · {order.member_branch.name}</span> : null}
                  </p>
                </div>
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
              </div>

              {/* Receipt lines */}
              <div className="overflow-x-auto">
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
                    {(order.order_lines || []).map((l, idx) => (
                      <tr key={idx} className="border-b border-line/70 last:border-0">
                        <td className="px-5 py-2.5 font-medium text-fg sm:px-6">{l.items?.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-fg">{l.qty}</td>
                        <td className="px-3 py-2.5 text-right text-muted">{currency(l.unit_price)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-fg sm:px-6">{currency(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Receipt total */}
              <div className="border-t-2 border-line bg-subtle/40 px-5 py-4 sm:px-6">
                {order.payment_option === 'Loan' ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-muted">Principal</p>
                      <p className="tabular-nums text-fg">{currency(principalAmount)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-muted">Interest ({ratePct}%)</p>
                      <p className="tabular-nums text-fg">{currency(interestAmount)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2">
                      <p className="text-sm font-semibold uppercase tracking-wide text-fg">Total (incl. interest)</p>
                      <p className="text-lg font-bold tabular-nums text-brand">{currency(totalWithInterest)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-wide text-fg">Total</p>
                    <p className="text-lg font-bold tabular-nums text-brand">{currency(order.total_amount)}</p>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 text-center sm:px-6">
                <p className="text-chips text-muted">Thank you for shopping with CBN Coop — every order keeps the Coop strong.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function Success() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <SuccessContent />
    </Suspense>
  )
}
