// app/exhibition/success/[id]/page.jsx
// Order confirmation after a member submits an exhibition order.
// Includes a print-friendly receipt layout + Download PDF / Print actions.
'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle2, FileText, Home, Package, Printer, Receipt, Store } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { useAuth } from '../../../contexts/AuthContext'
import useCartCount from '../../../hooks/useCartCount'
import { writePendingIds, hasNewPending, writePendingFresh } from '../../../lib/exhibitionPendingBadge'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`
// ASCII-only currency for the PDF so the glyph never scrambles in viewers.
const currencyPDF = (v) => `NGN ${Number(v || 0).toLocaleString()}`

function SuccessContent() {
  const router = useRouter()
  const params = useParams()
  const orderId = String(params?.id || '')
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  // Live pending-exhibition badge wiring — announce right after checkout so
  // the Navbar's "awaiting approval" pill updates instantly.
  const { announceCart: announceExhPending } = useCartCount('exhibitionPending', { memberId })

  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!orderId || !memberId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/exhibition/orders?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (json?.ok) {
          const found = (json.orders || []).find((o) => o.order_id === orderId)
          if (found) setOrder(found)
          else setError('Order not found')
          // Keep the Navbar's "awaiting approval" badge current right after
          // checkout. The member just placed the order — do NOT mark it seen,
          // so the badge pulses for the new arrival until they view /orders.
          try {
            const pendingOrders = (json.orders || []).filter((o) => o.status === 'Pending')
            const pending = pendingOrders.length
            const ids = pendingOrders.map((o) => o.order_id)
            localStorage.setItem(`exhibitionPending_${memberId}`, String(pending))
            writePendingIds(memberId, ids)
            const fresh = hasNewPending(memberId, ids)
            writePendingFresh(memberId, fresh)
            announceExhPending({ qty: pending, fresh })
          } catch {}
        } else {
          setError(json?.error || 'Could not load the order')
        }
      } catch {
        if (!cancelled) setError('Could not reach the Coop right now.')
      }
    })()
    return () => { cancelled = true }
  }, [orderId, memberId, announceExhPending])

  const downloadPDF = async () => {
    if (!order) return
    setDownloading(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF()

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
    } catch (e) {
      alert(`PDF error: ${e.message}`)
    } finally {
      setDownloading(false)
    }
  }

  if (error) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
          <div className="w-full max-w-sm text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-bg text-danger-fg">
              <Package className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <h2 className="text-base font-semibold text-fg">Couldn't load your order</h2>
            <p className="mt-1 text-sm text-muted">{error}</p>
            <Button className="mt-4" leftIcon={Home} onClick={() => router.push('/my-coop')}>
              Back to My Coop
            </Button>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute allowedRoles={['member']}>
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

            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-chips font-semibold uppercase tracking-wide text-accent">
              <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
              Coop Exhibition
            </div>
            <h1 className="mt-2 font-display text-h1 font-semibold tracking-tight text-fg">Order placed!</h1>
            <p className="mt-1 text-sm text-muted">
              Your order is <span className="font-semibold text-warning-fg">Pending</span> — the branch rep will approve it, then the vendor delivers your goods at the market.
            </p>

            {!order ? (
              <div className="mt-6 space-y-2">
                <Skeleton className="h-5 w-2/3 mx-auto" />
                <Skeleton className="h-5 w-1/2 mx-auto" />
              </div>
            ) : (
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
                  <span className="text-sm font-bold tabular-nums text-brand">{naira(order.total_amount)}</span>
                </div>

                <div className="space-y-2 rounded-xl border border-line bg-canvas/60 p-4">
                  <p className="text-chips font-semibold uppercase tracking-wider text-muted">Your items</p>
                  {(order.lines || []).map((l) => (
                    <div key={l.id} className="flex items-center gap-3">
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-subtle">
                        <Image
                          src={l.image_url || '/images/items/placeholder.svg'}
                          alt={l.product_name}
                          fill
                          sizes="40px"
                          className="object-cover"
                          onError={(e) => {
                            e.currentTarget.src = '/images/items/placeholder.svg'
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg">{l.product_name}</div>
                        <div className="text-chips text-muted">
                          {l.qty} × {naira(l.final_price)}
                        </div>
                      </div>
                      <div className="text-sm font-bold tabular-nums text-fg">{naira(l.amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" leftIcon={Receipt} onClick={() => router.push('/exhibition/orders')}>
                Track my orders
              </Button>
              <Button variant="secondary" className="flex-1" leftIcon={Home} onClick={() => router.push('/my-coop')}>
                My Coop
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => router.push('/exhibition')}>
                Keep browsing
              </Button>
            </div>
          </div>

          {/* Receipt — printable */}
          {order && (
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
                        <Store className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <div>
                        <p className="text-sm font-bold tracking-wide text-white">CBN COOP</p>
                        <p className="text-chips text-white/80">Seasonal Sales · Exhibition</p>
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
                      {order.member_name_snapshot || memberId}
                      <span className="text-muted"> · {memberId}</span>
                      {order.branch?.name ? <span className="text-muted"> · {order.branch.name}</span> : null}
                    </p>
                  </div>
                </div>

                {/* Receipt lines */}
                <div className="overflow-x-auto">
                  <table className="receipt-table w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle/60">
                        <th className="px-5 py-2 text-left text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Item</th>
                        <th className="px-3 py-2 text-left text-chips font-semibold uppercase tracking-wider text-muted">Vendor</th>
                        <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Qty</th>
                        <th className="px-3 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted">Unit</th>
                        <th className="px-5 py-2 text-right text-chips font-semibold uppercase tracking-wider text-muted sm:px-6">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.lines || []).map((l) => (
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
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Receipt total */}
                <div className="flex items-center justify-between gap-3 border-t-2 border-line bg-subtle/40 px-5 py-4 sm:px-6">
                  <p className="text-sm font-semibold uppercase tracking-wide text-fg">Total</p>
                  <p className="text-lg font-bold tabular-nums text-brand">{naira(order.total_amount)}</p>
                </div>

                <div className="px-5 py-4 text-center sm:px-6">
                  <p className="text-chips text-muted">Thank you for shopping with CBN Coop — every order keeps the Coop strong.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionSuccessPage() {
  return <SuccessContent />
}
