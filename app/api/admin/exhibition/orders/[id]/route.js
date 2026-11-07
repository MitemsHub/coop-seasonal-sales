// app/api/admin/exhibition/orders/[id]/route.js
// PATCH /api/admin/exhibition/orders/:id — edit a pending counter invoice.
//
// Editing replaces the invoice's items and (optionally) its payment method.
// The exposure RPC sums every order including this one, so the edit only asks
// it to cover the INCREASE: what was already reserved stays reserved, and a
// smaller invoice needs no check at all. Switching between Savings and Loan is
// refused — the old reservation would still count against the new method, so
// the correct fix there is to cancel and raise a fresh invoice.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ITEMS = 40
const MAX_PRINCIPAL = 100_000_000
const PAYMENTS = ['Cash', 'Savings', 'Loan']

function cleanText(v, max = 120) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

function wholeNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : NaN
}

export async function PATCH(req, { params }) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const id = Math.trunc(Number((await params)?.id || 0))
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid invoice id' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const paymentOption = String(body?.payment_option || '').trim()
    if (!PAYMENTS.includes(paymentOption)) {
      return NextResponse.json({ ok: false, error: 'Choose Cash, Savings or Loan.' }, { status: 400 })
    }

    const rawItems = Array.isArray(body?.items) ? body.items : []
    if (rawItems.length === 0) return NextResponse.json({ ok: false, error: 'Add at least one item.' }, { status: 400 })
    if (rawItems.length > MAX_ITEMS) {
      return NextResponse.json({ ok: false, error: `An invoice can hold at most ${MAX_ITEMS} items.` }, { status: 400 })
    }

    const items = []
    for (const raw of rawItems) {
      const name = cleanText(raw?.name)
      const note = cleanText(raw?.note, 160)
      const qty = wholeNumber(raw?.qty)
      const price = wholeNumber(raw?.price)
      if (!name) return NextResponse.json({ ok: false, error: 'Every item needs a name.' }, { status: 400 })
      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ ok: false, error: `Quantity for "${name}" must be at least 1.` }, { status: 400 })
      }
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ ok: false, error: `Price for "${name}" cannot be negative.` }, { status: 400 })
      }
      items.push({ name, note, qty, price, amount: qty * price })
    }

    const principal = items.reduce((sum, i) => sum + i.amount, 0)
    if (principal <= 0) return NextResponse.json({ ok: false, error: 'The invoice total must be more than zero.' }, { status: 400 })
    if (principal > MAX_PRINCIPAL) {
      return NextResponse.json({ ok: false, error: 'That total is too large for one invoice.' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: order, error: oErr } = await supabase
      .from('exhibition_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })
    if (!order) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })
    if (order.status !== 'Pending') {
      return NextResponse.json({ ok: false, error: 'Only pending invoices can be edited. Cancel this one and raise a new invoice.' }, { status: 409 })
    }
    const source = String(order.source || 'counter')
    if (source !== 'counter' && source !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Only counter invoices can be edited here.' }, { status: 409 })
    }

    const oldPayment = String(order.payment_option || 'Cash')
    if (
      (oldPayment === 'Savings' && paymentOption === 'Loan') ||
      (oldPayment === 'Loan' && paymentOption === 'Savings')
    ) {
      return NextResponse.json(
        { ok: false, error: 'Switching between Savings and Loan needs a new invoice. Cancel this one instead.' },
        { status: 409 }
      )
    }

    const { data: lines, error: lErr } = await supabase
      .from('exhibition_order_lines')
      .select('id, vendor_id, product_id, product_name, sku, unit, vendor_price, final_price, qty, amount, note')
      .eq('order_id', id)
      .order('id')
    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })
    if (!lines?.length) return NextResponse.json({ ok: false, error: 'This invoice has no items to edit.' }, { status: 409 })
    const vendorIds = [...new Set(lines.map((l) => Number(l.vendor_id)))]
    if (vendorIds.length !== 1) {
      return NextResponse.json({ ok: false, error: 'This invoice spans several vendors and cannot be edited here.' }, { status: 409 })
    }
    const vendorId = vendorIds[0]

    const { data: cycle, error: cErr } = await supabase
      .from('exhibition_cycles')
      .select('id, status, ends_at, loan_interest_rate_pct, exh_loan_cap_include_interest')
      .eq('id', order.cycle_id)
      .maybeSingle()
    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ ok: false, error: 'Exhibition season not found' }, { status: 404 })
    if (cycle.status !== 'active') {
      return NextResponse.json({ ok: false, error: 'This exhibition season is closed; its invoices can no longer be edited.' }, { status: 409 })
    }

    // A paid vendor payable locks the invoice: changing it would leave the
    // payout disagreeing with the order, so refuse before touching anything.
    const { data: payRows } = await supabase
      .from('exhibition_vendor_payment_status')
      .select('id, paid')
      .eq('order_id', id)
      .limit(1)
    const payRow = payRows?.[0] || null
    if (payRow?.paid) {
      return NextResponse.json(
        { ok: false, error: 'This vendor payable has already been paid; the invoice can no longer change.' },
        { status: 409 }
      )
    }

    const loanRatePct = Math.max(0, Number(cycle.loan_interest_rate_pct ?? 0))
    const interest = paymentOption === 'Loan' ? Math.round((principal * loanRatePct) / 100) : 0
    const total = principal + interest
    const includeInterest = cycle.exh_loan_cap_include_interest !== false

    const oldPrincipal = lines.reduce((sum, l) => sum + Number(l.amount || 0), 0)
    const oldTotal = Number(order.total_amount || 0)
    const capOf = (pay, p, t) => (pay === 'Loan' ? (includeInterest ? t : p) : 0)
    const oldCap = capOf(oldPayment, oldPrincipal, oldTotal)
    const newCap = capOf(paymentOption, principal, total)
    const delta = newCap - oldCap

    if (delta > 0) {
      const { data: exposure, error: expErr } = await supabase.rpc('check_exhibition_exposure_atomic', {
        p_member_id: order.member_id,
        p_payment_option: paymentOption,
        p_total_amount: delta,
        p_cycle_id: order.cycle_id,
      })
      if (expErr) return NextResponse.json({ ok: false, error: expErr.message }, { status: 500 })
      if (!exposure?.ok) {
        return NextResponse.json(
          { ok: false, error: exposure?.error || 'This edit would exceed the member\'s limit.' },
          { status: 400 }
        )
      }
    }

    const now = new Date().toISOString()
    const { data: updated, error: upErr } = await supabase
      .from('exhibition_orders')
      .update({
        payment_option: paymentOption,
        total_qty: items.reduce((sum, i) => sum + i.qty, 0),
        total_amount: total,
        last_edited_at: now,
        last_edited_by_role: 'admin',
        last_edited_by_code: String(session.claims?.email || session.claims?.sub || 'admin'),
        edit_count: Number(order.edit_count || 0) + 1,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'Pending')
      .select('id')
    if (upErr) {
      const code = String(upErr.code || '')
      if (code === '42703' || code === 'PGRST204') {
        return NextResponse.json(
          { ok: false, error: 'The counter-invoice migration has not been applied yet (migrations/exhibition-counter-invoices.sql).' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
    }
    if (!updated?.length) {
      return NextResponse.json({ ok: false, error: 'This invoice changed while you were editing it. Reload and try again.' }, { status: 409 })
    }

    // Replace the lines. Keep the old rows so a failed insert can be undone.
    const { error: delErr } = await supabase.from('exhibition_order_lines').delete().eq('order_id', id)
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    const { error: insErr } = await supabase.from('exhibition_order_lines').insert(
      items.map((i) => ({
        order_id: id,
        vendor_id: vendorId,
        product_id: null,
        product_name: i.name,
        sku: '',
        unit: 'each',
        vendor_price: i.price,
        final_price: i.price,
        qty: i.qty,
        amount: i.amount,
        note: i.note,
      }))
    )
    if (insErr) {
      // Put the invoice back the way it was rather than leaving it itemless.
      await supabase
        .from('exhibition_orders')
        .update({
          payment_option: oldPayment,
          total_qty: Number(order.total_qty || 0),
          total_amount: oldTotal,
          last_edited_at: order.last_edited_at || null,
          last_edited_by_role: order.last_edited_by_role || '',
          last_edited_by_code: order.last_edited_by_code || '',
          edit_count: Number(order.edit_count || 0),
        })
        .eq('id', id)
      await supabase.from('exhibition_order_lines').insert(
        lines.map((l) => ({
          order_id: id,
          vendor_id: l.vendor_id,
          product_id: l.product_id,
          product_name: l.product_name,
          sku: l.sku || '',
          unit: l.unit || 'each',
          vendor_price: l.vendor_price,
          final_price: l.final_price,
          qty: l.qty,
          amount: l.amount,
          note: l.note || '',
        }))
      )
      return NextResponse.json({ ok: false, error: insErr.message || 'Failed to save the invoice items' }, { status: 500 })
    }

    // The vendor is paid the principal, so their payable follows the edit.
    if (payRow) {
      await supabase.from('exhibition_vendor_payment_status').update({ amount: principal }).eq('id', payRow.id)
    } else {
      await supabase.from('exhibition_vendor_payment_status').insert({
        cycle_id: order.cycle_id,
        vendor_id: vendorId,
        order_id: id,
        amount: principal,
        paid: false,
      })
    }

    await logExhibitionAudit([id], {
      action: 'Invoice edited',
      actorType: 'admin',
      actorLabel: 'System admin',
      note: `Updated at the admin desk · ${oldPayment} → ${paymentOption}`,
    })

    return NextResponse.json({
      ok: true,
      order_id: order.order_id,
      total,
      principal,
      interest,
      payment_option: paymentOption,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update the invoice' }, { status: 500 })
  }
}
