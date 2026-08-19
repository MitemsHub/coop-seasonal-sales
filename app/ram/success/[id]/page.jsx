// app/ram/success/[id]/page.jsx
// Order confirmation after a member submits a ram order.
// Includes a print-friendly receipt layout + Print receipt / Download PDF
// actions, matching the exhibition success page's standard. The sticky
// summary keeps the paid total visible while viewing the receipt.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { Suspense } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Beef, CheckCircle2, FileText, Home, Printer, Receipt } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'

function RamSuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()

  const orderId = useMemo(() => (Array.isArray(params?.id) ? params.id[0] : params?.id), [params])

  useEffect(() => {
    const mid = (searchParams.get('mid') || '').trim()
    if (!mid) return
    if (!orderId) return
    router.replace(`/ram/success/${encodeURIComponent(orderId)}`)
  }, [orderId, router, searchParams])

  const [order, setOrder] = useState(null)
  const [member, setMember] = useState(null)
  const [location, setLocation] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [shoppingStatusLoading, setShoppingStatusLoading] = useState(false)
  const memberId = String(order?.member_id || member?.member_id || '').trim()

  const currency = (n) => `₦${Number(n || 0).toLocaleString()}`
  const currencyPDF = (n) => `NGN ${Number(n || 0).toLocaleString()}`

  useEffect(() => {
    let cancelled = false
    const loadStatus = async () => {
      try {
        setShoppingStatusLoading(true)
        const res = await fetch('/api/system/ram-shopping', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load shopping status')
        if (!cancelled) setShoppingOpen(!!json.open)
      } catch {
        if (!cancelled) setShoppingOpen(false)
      } finally {
        if (!cancelled) setShoppingStatusLoading(false)
      }
    }
    loadStatus()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!orderId) return
      setError(null)
      setOrder(null)
      setMember(null)
      setLocation(null)
      try {
        const { data: o, error: oErr } = await supabase
          .from('ram_orders')
          .select(
            'id,member_id,status,created_at,payment_option,qty,unit_price,principal_amount,interest_amount,total_amount,ram_delivery_location_id'
          )
          .eq('id', Number(orderId))
          .single()
        if (oErr || !o) throw new Error(oErr?.message || 'Order not found')

        const [mRes, lRes] = await Promise.all([
          supabase.from('members').select('member_id,full_name,branch_id').eq('member_id', o.member_id).maybeSingle(),
          o.ram_delivery_location_id
            ? supabase
                .from('ram_delivery_locations')
                .select('id,delivery_location,name,phone,address')
                .eq('id', o.ram_delivery_location_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ])

        if (!cancelled) {
          setOrder(o)
          setMember(mRes?.data || null)
          setLocation(lRes?.data || null)
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load order')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [orderId])

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

      const detailsBody = [
        ['Order ID', `#${order.id}`, 'Status', String(order.status || '—')],
        ['Date', new Date(order.created_at).toLocaleString(), 'Payment', String(order.payment_option || '—')],
        ['Member', `${member?.full_name || '—'} (${order.member_id})`, 'Quantity', String(Number(order.qty || 0).toLocaleString())],
        ['Unit Price', currencyPDF(order.unit_price), 'Total', currencyPDF(order.total_amount)],
      ]

      autoTable(doc, {
        head: [['Order Details', '', '', '']],
        body: detailsBody,
        startY: headerY + headerH + 6,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: [240, 253, 244], textColor: [21, 128, 61], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 66 }, 2: { cellWidth: 26 }, 3: { cellWidth: 66 } },
        margin: { left: marginX, right: marginX },
      })

      const principal = Number(order.principal_amount || 0)
      const interest = Number(order.interest_amount || 0)
      const total = Number(order.total_amount || 0)

      autoTable(doc, {
        head: [['Amount Breakdown', '', '']],
        body: [
          ['Principal', currencyPDF(principal), ''],
          ['Interest', currencyPDF(interest), ''],
          ['Total', currencyPDF(total), ''],
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
        ['Delivery Location', String(location?.delivery_location || location?.name || '—')],
        ['Vendor Name', String(location?.name || '—')],
        ['Vendor Phone No', String(location?.phone || '—')],
      ]
      if (location?.address) vendorRows.push(['Vendor Address', String(location.address)])

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
    } catch (e) {
      alert(`PDF error: ${e?.message || 'Failed to generate PDF'}`)
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
              <Receipt className="h-6 w-6" strokeWidth={1.8} />
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

  if (!order) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
          <div className="w-full max-w-sm">
            <Skeleton className="mx-auto h-5 w-2/3" />
            <Skeleton className="mx-auto mt-3 h-5 w-1/2" />
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

      <main className="min-h-screen bg-canvas">
        <div className="relative mx-auto max-w-2xl px-4 pb-24 md:px-6">
          {/* Confirmation card — screen only */}
          <div className="print-hide ui-card mt-6 p-6 md:p-8 md:mt-10">
            <div className="text-center">
              <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg ring-8 ring-success-bg/40">
                <CheckCircle2 className="h-8 w-8" strokeWidth={2} />
              </div>
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-chips font-semibold uppercase tracking-wide text-accent">
                <Beef className="h-3.5 w-3.5" strokeWidth={2.2} />
                Ram Sales
              </div>
              <h1 className="mt-2 font-display text-h1 font-semibold tracking-tight text-fg">Ram order placed!</h1>
              <p className="mt-1 text-sm text-muted">
                Your order is <span className="font-semibold text-warning-fg">Pending</span> — the branch rep will approve it, then the vendor delivers your ram at the delivery location.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-4 py-3">
                <span className="text-chips font-medium text-muted">Order ID</span>
                <span className="text-sm font-bold tabular-nums text-fg">#{order.id}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-4 py-3">
                <span className="text-chips font-medium text-muted">Member ID</span>
                <span className="text-sm font-bold text-fg">{memberId}</span>
              </div>

              {!!error && (
                <div className="rounded-xl border border-danger-border bg-danger-bg p-3 text-sm text-danger-fg">{error}</div>
              )}

              <div className="rounded-xl border border-line bg-canvas/60 p-4 text-sm text-fg">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted">Member</div>
                  <div className="font-semibold text-right">{member?.full_name || '—'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Payment</div>
                  <div className="font-semibold text-right">{order.payment_option || '—'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Quantity</div>
                  <div className="font-semibold text-right">{Number(order.qty || 0).toLocaleString()}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Unit Price</div>
                  <div className="font-semibold text-right">{currency(order.unit_price)}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Principal</div>
                  <div className="font-semibold text-right">{currency(order.principal_amount)}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Interest</div>
                  <div className="font-semibold text-right">{currency(order.interest_amount)}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2">
                  <div className="font-semibold">Total</div>
                  <div className="font-bold text-right">{currency(order.total_amount)}</div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-muted">Delivery Location</div>
                  <div className="font-semibold text-right break-words">{location?.delivery_location || location?.name || '—'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Vendor Name</div>
                  <div className="font-semibold text-right break-words">{location?.name || '—'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-muted">Vendor Phone No</div>
                  <div className="font-semibold text-right break-words">{location?.phone || '—'}</div>
                </div>
              </div>
            </div>

            {/* Sticky order summary — keeps the paid total visible while viewing the receipt */}
            <div className="sticky bottom-2 z-10 mt-4 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur-sm md:bottom-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="min-w-0 rounded-xl bg-subtle/70 px-2 py-2 text-center sm:px-3">
                  <div className="text-chips font-medium text-muted">Rams</div>
                  <div className="text-xs font-semibold tabular-nums text-fg sm:text-sm">{Number(order.qty || 0).toLocaleString()}</div>
                </div>
                <div className="min-w-0 rounded-xl bg-subtle/70 px-2 py-2 text-center sm:px-3">
                  <div className="text-chips font-medium text-muted">Payment</div>
                  <div className="text-xs font-semibold text-fg sm:text-sm">{order.payment_option || '—'}</div>
                </div>
                <div className="min-w-0 rounded-xl border border-brand/20 bg-brand-subtle/60 px-2 py-2 text-center sm:px-3">
                  <div className="text-chips font-medium text-brand-fg">Paid total</div>
                  <div className="text-xs font-semibold tabular-nums text-brand-fg sm:text-sm">{currency(order.total_amount)}</div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => router.push('/ram/shop')}
                disabled={!shoppingOpen || shoppingStatusLoading}
              >
                {shoppingOpen ? 'Back to Ram Shopping' : 'Ram Shopping Closed'}
              </Button>
            </div>
          </div>

          {/* Receipt — printable */}
          <div className="mt-6 pb-6">
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
                      <Beef className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <div>
                      <p className="text-sm font-bold tracking-wide text-white">CBN COOP</p>
                      <p className="text-chips text-white/80">Seasonal Sales · Ram Sales</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-chips font-semibold uppercase tracking-wider text-white/80">Receipt</p>
                    <p className="text-sm font-bold tabular-nums text-white">#{order.id}</p>
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
                    {member?.full_name || memberId}
                    <span className="text-muted"> · {memberId}</span>
                  </p>
                </div>
              </div>

              {/* Receipt amounts */}
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <div className="mb-3 text-chips font-semibold uppercase tracking-wider text-muted">Order details</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-chips font-medium uppercase tracking-wider text-muted">Quantity</p>
                    <p className="font-medium tabular-nums text-fg">{Number(order.qty || 0).toLocaleString()} ram(s)</p>
                  </div>
                  <div>
                    <p className="text-chips font-medium uppercase tracking-wider text-muted">Unit price</p>
                    <p className="font-medium tabular-nums text-fg">{currency(order.unit_price)}</p>
                  </div>
                  <div>
                    <p className="text-chips font-medium uppercase tracking-wider text-muted">Principal</p>
                    <p className="font-medium tabular-nums text-fg">{currency(order.principal_amount)}</p>
                  </div>
                  <div>
                    <p className="text-chips font-medium uppercase tracking-wider text-muted">Interest</p>
                    <p className="font-medium tabular-nums text-fg">{currency(order.interest_amount)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-chips font-medium uppercase tracking-wider text-muted">Total</p>
                    <p className="font-semibold tabular-nums text-fg">{currency(order.total_amount)}</p>
                  </div>
                </div>
              </div>

              {/* Receipt vendor */}
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <div className="mb-3 text-chips font-semibold uppercase tracking-wider text-muted">Vendor details</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Delivery location</span>
                    <span className="font-medium text-right text-fg">{location?.delivery_location || location?.name || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Vendor name</span>
                    <span className="font-medium text-right text-fg">{location?.name || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Vendor phone</span>
                    <span className="font-medium text-right text-fg">{location?.phone || '—'}</span>
                  </div>
                  {location?.address && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted">Vendor address</span>
                      <span className="font-medium text-right text-fg">{location.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Receipt total */}
              <div className="flex items-center justify-between gap-3 bg-subtle/40 px-5 py-4 sm:px-6">
                <p className="text-sm font-semibold uppercase tracking-wide text-fg">Total</p>
                <p className="text-lg font-bold tabular-nums text-brand">{currency(order.total_amount)}</p>
              </div>

              <div className="px-5 py-4 text-center sm:px-6">
                <p className="text-chips text-muted">Thank you for shopping with CBN Coop — every order keeps the Coop strong.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </ProtectedRoute>
  )
}

export default function RamSuccessPage() {
  return (
    <ProtectedRoute allowedRoles={['member']}>
      <Suspense>
        <RamSuccessContent />
      </Suspense>
    </ProtectedRoute>
  )
}
