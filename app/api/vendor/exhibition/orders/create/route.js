// app/api/vendor/exhibition/orders/create/route.js
// POST /api/vendor/exhibition/orders/create
// The vendor raises an invoice at the stand — no catalogue, no stock, no SKU.
//
// body: {
//   member_id: 'CBN-104882',
//   payment_option: 'Cash' | 'Savings' | 'Loan',
//   items: [{ name: 'Ankara fabric', qty: 2, price: 45000 }]
// }
//
// The order lands as Pending, exactly like a storefront order: the admin
// approves it, then the member confirms receipt. Savings/Loan are checked
// against the same atomic RPC the storefront uses, so Pending invoices hold
// their room from the moment they are captured. Cash never touches a limit.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { getVendorContext } from '../../../_session'

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

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const paymentOption = String(body?.payment_option || '').trim()
    if (!PAYMENTS.includes(paymentOption)) {
      return NextResponse.json({ ok: false, error: 'Choose Cash, Savings or Loan.' }, { status: 400 })
    }

    const memberId = String(body?.member_id || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'Choose the member first.' }, { status: 400 })

    const rawItems = Array.isArray(body?.items) ? body.items : []
    if (rawItems.length === 0) {
      return NextResponse.json({ ok: false, error: 'Add at least one item.' }, { status: 400 })
    }
    if (rawItems.length > MAX_ITEMS) {
      return NextResponse.json({ ok: false, error: `An invoice can hold at most ${MAX_ITEMS} items.` }, { status: 400 })
    }

    const items = []
    for (const raw of rawItems) {
      const name = cleanText(raw?.name)
      const qty = wholeNumber(raw?.qty)
      const price = wholeNumber(raw?.price)
      if (!name) return NextResponse.json({ ok: false, error: 'Every item needs a name.' }, { status: 400 })
      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ ok: false, error: `Quantity for "${name}" must be at least 1.` }, { status: 400 })
      }
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ ok: false, error: `Price for "${name}" cannot be negative.` }, { status: 400 })
      }
      items.push({ name, qty, price, amount: qty * price })
    }

    const principal = items.reduce((sum, i) => sum + i.amount, 0)
    if (principal <= 0) {
      return NextResponse.json({ ok: false, error: 'The invoice total must be more than zero.' }, { status: 400 })
    }
    if (principal > MAX_PRINCIPAL) {
      return NextResponse.json({ ok: false, error: 'That total is too large for one invoice.' }, { status: 400 })
    }

    const supabase = createClient()

    // The vendor's own stand decides the branch and the season.
    const { data: vendor, error: vErr } = await supabase
      .from('exhibition_vendors')
      .select('id, name, branch_id, cycle_id, status')
      .eq('id', ctx.vendor_id)
      .maybeSingle()
    if (vErr) return NextResponse.json({ ok: false, error: vErr.message }, { status: 500 })
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })
    if (vendor.status !== 'active') {
      return NextResponse.json({ ok: false, error: 'This stand is suspended.' }, { status: 403 })
    }

    const cycleId = Number(vendor.cycle_id || ctx.cycle_id)
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return NextResponse.json({ ok: false, error: 'This stand is not attached to an exhibition season.' }, { status: 400 })
    }

    const { data: cycle, error: cErr } = await supabase
      .from('exhibition_cycles')
      .select('id, status, starts_at, ends_at, loan_interest_rate_pct, exh_loan_cap_include_interest')
      .eq('id', cycleId)
      .maybeSingle()
    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ ok: false, error: 'Exhibition season not found' }, { status: 404 })
    if (cycle.status !== 'active') {
      return NextResponse.json({ ok: false, error: 'This exhibition season is not open.' }, { status: 409 })
    }
    const now = Date.now()
    if (cycle.starts_at && new Date(cycle.starts_at).getTime() > now) {
      return NextResponse.json({ ok: false, error: 'This exhibition has not opened yet.' }, { status: 409 })
    }
    if (cycle.ends_at && new Date(cycle.ends_at).getTime() <= now) {
      return NextResponse.json({ ok: false, error: 'This exhibition has closed.' }, { status: 409 })
    }

    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id, full_name, portal_enabled')
      .eq('member_id', memberId)
      .maybeSingle()
    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    if (!member || member.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Member not found.' }, { status: 404 })
    }

    // Loan interest works exactly like the storefront: added to the invoice,
    // and counted against the cap unless the season says otherwise.
    const loanRatePct = Math.max(0, Number(cycle.loan_interest_rate_pct ?? 0))
    const interest = paymentOption === 'Loan' ? Math.round((principal * loanRatePct) / 100) : 0
    const total = principal + interest
    const includeInterest = cycle.exh_loan_cap_include_interest !== false
    const capAmount = includeInterest ? total : principal

    // Atomic exposure check: locks the member row, so two stands cannot both
    // pass the check and overdraw the same room. Cash is untouched.
    const { data: exposure, error: expErr } = await supabase.rpc('check_exhibition_exposure_atomic', {
      p_member_id: memberId,
      p_payment_option: paymentOption,
      p_total_amount: capAmount,
      p_cycle_id: cycleId,
    })
    if (expErr) return NextResponse.json({ ok: false, error: expErr.message }, { status: 500 })
    if (!exposure?.ok) {
      return NextResponse.json({ ok: false, error: exposure?.error || 'This member cannot use that payment option.' }, { status: 400 })
    }

    const totalQty = items.reduce((sum, i) => sum + i.qty, 0)

    // order_id comes from the sequential display-number default, so invoices
    // read 1, 2, 3 instead of a random EXH- code.
    const { data: inserted, error: insErr } = await supabase
      .from('exhibition_orders')
      .insert({
        cycle_id: cycleId,
        branch_id: vendor.branch_id,
        member_id: memberId,
        member_name_snapshot: member.full_name || '',
        payment_option: paymentOption,
        status: 'Pending',
        total_qty: totalQty,
        total_amount: total,
        source: 'counter',
        captured_by_role: 'vendor',
        captured_by_code: String(ctx.vendor_code || ''),
      })
      .select('id, order_id')
      .single()
    if (insErr) {
      const code = String(insErr.code || '')
      const msg = String(insErr.message || '')
      if (code === '42703' || code === 'PGRST204' || /source|captured_by/.test(msg)) {
        return NextResponse.json(
          { ok: false, error: 'The counter-invoice migration has not been applied yet (migrations/exhibition-counter-invoices.sql).' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: msg || 'Failed to create the invoice' }, { status: 500 })
    }
    const orderDbId = inserted.id
    const orderId = inserted.order_id

    const { error: lineErr } = await supabase.from('exhibition_order_lines').insert(
      items.map((i) => ({
        order_id: orderDbId,
        vendor_id: ctx.vendor_id,
        product_id: null,
        product_name: i.name,
        sku: '',
        unit: 'each',
        vendor_price: i.price,
        final_price: i.price,
        qty: i.qty,
        amount: i.amount,
      }))
    )
    if (lineErr) {
      await supabase.from('exhibition_orders').delete().eq('id', orderDbId)
      return NextResponse.json({ ok: false, error: lineErr.message || 'Failed to save the invoice items' }, { status: 500 })
    }

    // The co-op pays the vendor the principal later; interest is the co-op's.
    const { error: payErr } = await supabase.from('exhibition_vendor_payment_status').insert({
      cycle_id: cycleId,
      vendor_id: ctx.vendor_id,
      order_id: orderDbId,
      amount: principal,
      paid: false,
    })
    if (payErr) {
      await supabase.from('exhibition_orders').delete().eq('id', orderDbId)
      return NextResponse.json({ ok: false, error: payErr.message || 'Failed to register the vendor payable' }, { status: 500 })
    }

    await logExhibitionAudit([orderDbId], {
      action: 'Order placed',
      actorType: 'vendor',
      actorLabel: `Vendor · ${ctx.vendor_code || ctx.vendor_id}`,
      note: 'Counter invoice captured at the stand',
    })

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      total,
      principal,
      interest,
      payment_option: paymentOption,
      member: { member_id: member.member_id, full_name: member.full_name || '' },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to create the invoice' }, { status: 500 })
  }
}
