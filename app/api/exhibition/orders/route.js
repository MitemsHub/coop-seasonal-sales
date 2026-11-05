// app/api/exhibition/orders/route.js
// Member order creation for the Coop Exhibition module.
//   POST /api/exhibition/orders
// body: { member_id, delivery_branch_code, department_name, payment_option,
//         lines: [{ product_id, qty }] }
//
// Business rules (mirrors the Food + Ram modules):
//   - The member's branch determines the cycle + catalog.
//   - Each product price = negotiated per-member price if present, else
//     vendor_price.
//   - Savings/Loan limits reuse the shared eligibility numbers, reduced by the
//     member's open exhibition exposure (Pending/Approved orders).
//   - Loan orders accrue interest at the cycle's loan_interest_rate_pct.
//   - One order, lines tagged per vendor, plus a vendor payment-status row per
//     vendor (the co-op pays vendors after the exhibition).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { csrfGuard } from '@/lib/csrf'
import { validateMemberId, validateNumber, validatePaymentOption } from '@/lib/validation'
import { getCrossModuleExposure } from '@/lib/crossModuleExposure'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

// Statuses that still consume this cycle's loan allowance. Delivered and
// Confirmed orders have already been spent — excluding them would free the cap.

function makeOrderId() {
  const y = new Date().getFullYear()
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `EXH-${y}-${rand}`
}

// GET /api/exhibition/orders?member_id=XXX — the member's exhibition orders
// with their lines (used by the confirmation + any member-facing view).
// Pass &status_only=1 to fetch just order_id + status (used by the member's
// status-toast poll so it stays light).
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const statusOnly = searchParams.get('status_only') === '1'
    const supabase = createClient()
    const { data: orders, error } = await supabase
      .from('exhibition_orders')
      .select(
        statusOnly
          ? 'id, order_id, status'
          : 'id, order_id, status, payment_option, total_qty, total_amount, created_at, approved_at, ready_at, delivered_at, cancelled_at, cancelled_reason, member_confirmed_at, member_name_snapshot, branch:branches(id, name, code), lines:exhibition_order_lines(id, product_id, vendor_id, product_name, sku, unit, final_price, qty, amount, image_url:exhibition_products(image_url), vendor:exhibition_vendors(name))'
      )
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      orders: (orders || []).map((o) => ({
        ...o,
        lines: (o.lines || []).map((l) => {
          const { vendor, ...rest } = l
          return {
            ...rest,
            image_url: l.image_url?.image_url || '',
            vendor_name: vendor?.name || '',
          }
        }),
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}

export async function POST(req) {
  const csrfResponse = csrfGuard(req)
  if (csrfResponse) return csrfResponse
  try {
    const body = await req.json().catch(() => ({}))

    const memberIdRes = validateMemberId(String(body.member_id || ''))
    if (!memberIdRes.isValid) return NextResponse.json({ ok: false, error: memberIdRes.error }, { status: 400 })

    const paymentRes = validatePaymentOption(String(body.payment_option || ''))
    if (!paymentRes.isValid) return NextResponse.json({ ok: false, error: paymentRes.error }, { status: 400 })

    const linesRaw = Array.isArray(body.lines) ? body.lines : []
    if (!linesRaw.length) return NextResponse.json({ ok: false, error: 'Your cart is empty' }, { status: 400 })
    if (linesRaw.length > 60) return NextResponse.json({ ok: false, error: 'Too many items in one order' }, { status: 400 })

    const lines = []
    for (const l of linesRaw) {
      const pid = Number(l?.product_id)
      if (!Number.isFinite(pid) || pid <= 0) {
        return NextResponse.json({ ok: false, error: 'Invalid product in order' }, { status: 400 })
      }
      const qtyRes = validateNumber(l?.qty, { min: 1, max: 9999, integer: true })
      if (!qtyRes.isValid) return NextResponse.json({ ok: false, error: `Invalid quantity for a product: ${qtyRes.error}` }, { status: 400 })
      // Services ticked for this product (installation …). Only the ids are
      // trusted; the prices come from the database below.
      const addonIds = []
      for (const raw of Array.isArray(l?.addon_ids) ? l.addon_ids : []) {
        const aid = Number(raw)
        if (Number.isFinite(aid) && aid > 0 && !addonIds.includes(aid)) addonIds.push(aid)
      }
      if (addonIds.length > 10) return NextResponse.json({ ok: false, error: 'Too many services on one item' }, { status: 400 })
      lines.push({ product_id: pid, qty: qtyRes.value, addon_ids: addonIds })
    }

    const memberId = memberIdRes.sanitized.toUpperCase()
    const paymentOption = paymentRes.sanitized
    const deliveryBranchCode = String(body.delivery_branch_code || '').trim().toUpperCase()
    const departmentName = String(body.department_name || '').trim()
    if (!deliveryBranchCode) return NextResponse.json({ ok: false, error: 'Delivery branch is required' }, { status: 400 })
    if (!departmentName) return NextResponse.json({ ok: false, error: 'Department is required' }, { status: 400 })

    const supabase = createClient()

    // Member + phone
    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id, full_name, category, savings, loans, global_limit, phone, branch_id, portal_enabled, branches:branch_id(code, name)')
      .eq('member_id', memberId)
      .maybeSingle()
    if (mErr) {
      if (isMissingTable(mErr, 'exhibition')) {
        return NextResponse.json(
          { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    }
    if (!member || member.portal_enabled === false) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    const phoneDigits = String(member.phone || '').replace(/\D/g, '')
    if (!phoneDigits) {
      return NextResponse.json({ ok: false, error: 'Phone number is required. Update your phone before ordering.' }, { status: 400 })
    }
    if (phoneDigits.length !== 11) {
      return NextResponse.json({ ok: false, error: 'Phone number must be exactly 11 digits. Update your phone before ordering.' }, { status: 400 })
    }

    const branchId = Number(member.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'Member has no branch assigned' }, { status: 400 })
    }

    // Delivery branch must exist
    const { data: deliveryBranch } = await supabase
      .from('branches')
      .select('id, code, name')
      .eq('code', deliveryBranchCode)
      .maybeSingle()
    if (!deliveryBranch) return NextResponse.json({ ok: false, error: 'Delivery branch not found' }, { status: 404 })

    // Delivery is only offered where the open season actually has goods —
    // checked against the cycle's products once the cycle is resolved below.

    // The active season — org-wide now, so a member of any branch orders
    // from the same cycle and the branch only decides what they can buy.
    const { data: cycle, error: cycErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, status, starts_at, ends_at, loan_interest_rate_pct, exh_loan_cap_include_interest')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .maybeSingle()
    if (cycErr) {
      if (isMissingTable(cycErr, 'exhibition')) {
        return NextResponse.json(
          { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: cycErr.message }, { status: 500 })
    }
    if (!cycle) return NextResponse.json({ ok: false, error: 'The Coop Exhibition is closed right now.' }, { status: 400 })

    // Reject orders outside the cycle date window (auto-close).
    const cycleNow = Date.now()
    if (cycle.starts_at && new Date(cycle.starts_at).getTime() > cycleNow) {
      return NextResponse.json({ ok: false, error: 'Exhibition has not started yet. Orders open on ' + new Date(cycle.starts_at).toLocaleDateString() }, { status: 400 })
    }
    if (cycle.ends_at && new Date(cycle.ends_at).getTime() <= cycleNow) {
      return NextResponse.json({ ok: false, error: 'This exhibition cycle has ended. Please shop from another open exhibition.' }, { status: 400 })
    }

    const cycleId = Number(cycle.id)

    // Delivery is only offered where the open season actually has goods.
    const { count: delivProducts } = await supabase
      .from('exhibition_products')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_id', cycleId)
      .eq('branch_id', deliveryBranch.id)
      .eq('status', 'active')
    if (!delivProducts) {
      return NextResponse.json(
        { ok: false, error: 'Delivery is only available at branches taking part in this exhibition.' },
        { status: 400 }
      )
    }

    const loanInterestRatePct = Math.max(0, Number(cycle.loan_interest_rate_pct ?? 13))
    const loanInterestRate = loanInterestRatePct / 100

    // Resolve products + per-member prices.
    // The products must come from the DELIVERY branch — the same branch the
    // catalog served the cart from. Filtering by the member's home branch here
    // rejected every cart line when the member shopped a stand at another
    // location ("A product in your cart is no longer available").
    const ids = lines.map((l) => l.product_id)
    const { data: productRows, error: pErr } = await supabase
      .from('exhibition_products')
      .select('id, vendor_id, name, sku, unit, vendor_price, qty, status')
      .eq('cycle_id', cycleId)
      .eq('branch_id', deliveryBranch.id)
      .in('id', ids)
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

    const byId = new Map((productRows || []).map((p) => [Number(p.id), p]))
    for (const l of lines) {
      const p = byId.get(l.product_id)
      if (!p || p.status !== 'active') {
        return NextResponse.json({ ok: false, error: 'A product in your cart is no longer available.' }, { status: 400 })
      }
      if (p.qty !== null && Number(p.qty) < l.qty) {
        return NextResponse.json({ ok: false, error: `Not enough stock for "${p.name}" (${Number(p.qty)} left).` }, { status: 400 })
      }
    }

    const { data: negRows } = await supabase
      .from('exhibition_member_prices')
      .select('product_id, price')
      .eq('cycle_id', cycleId)
      .eq('member_id', memberId)
      .in('product_id', ids)
    const negByProduct = new Map((negRows || []).map((r) => [Number(r.product_id), Number(r.price || 0)]))

    // Price each line
    const priced = lines.map((l) => {
      const p = byId.get(l.product_id)
      const base = Number(p.vendor_price || 0)
      const price = negByProduct.has(l.product_id) ? Math.max(0, negByProduct.get(l.product_id)) : base
      return {
        product_id: l.product_id,
        vendor_id: Number(p.vendor_id),
        product_name: p.name,
        sku: p.sku,
        unit: p.unit || 'each',
        vendor_price: Number(p.vendor_price || 0),
        final_price: price,
        qty: l.qty,
        amount: price * l.qty,
      }
    })

    // Optional services become their own lines, tied to the product's vendor,
    // so the delivery pack shows the work owed and the vendor is paid for it.
    const requestedAddonIds = [...new Set(lines.flatMap((l) => l.addon_ids || []))]
    const addonById = new Map()
    if (requestedAddonIds.length) {
      const { data: addonRows, error: addonErr } = await supabase
        .from('exhibition_product_addons')
        .select('id, product_id, name, price, active')
        .in('id', requestedAddonIds)
        .eq('active', true)
      if (addonErr) return NextResponse.json({ ok: false, error: addonErr.message }, { status: 500 })
      for (const a of addonRows || []) addonById.set(Number(a.id), a)
    }

    const serviceLines = []
    for (const l of priced) {
      const line = lines.find((x) => x.product_id === l.product_id)
      for (const addonId of line?.addon_ids || []) {
        const addon = addonById.get(Number(addonId))
        if (!addon || Number(addon.product_id) !== Number(l.product_id)) {
          return NextResponse.json({ ok: false, error: 'A service in your cart is no longer available.' }, { status: 400 })
        }
        const servicePrice = Math.max(0, Number(addon.price || 0))
        serviceLines.push({
          product_id: l.product_id,
          vendor_id: l.vendor_id,
          product_name: `${l.product_name} — ${addon.name}`,
          sku: `${l.sku}-SVC`,
          unit: 'service',
          vendor_price: 0,
          final_price: servicePrice,
          qty: l.qty,
          amount: servicePrice * l.qty,
        })
      }
    }

    const totalPrincipal = [...priced, ...serviceLines].reduce((s, l) => s + l.amount, 0)
    const totalQty = priced.reduce((s, l) => s + l.qty, 0)
    const loanInterest = paymentOption === 'Loan' ? Math.round(totalPrincipal * loanInterestRate) : 0
    const totalAmount = paymentOption === 'Loan' ? totalPrincipal + loanInterest : totalPrincipal

    // ── Eligibility ──────────────────────────────────────────────────────
    // Atomic exposure check: locks the member row to prevent concurrent
    // requests from both passing the exposure check.
    const includeInterestInCap = cycle.exh_loan_cap_include_interest !== false
    const capAmount = includeInterestInCap ? totalAmount : totalPrincipal
    const { data: exposureResult, error: exposureErr } = await supabase.rpc('check_exhibition_exposure_atomic', {
      p_member_id: memberId,
      p_payment_option: paymentOption,
      p_total_amount: capAmount,
      p_cycle_id: cycleId || null,
    })
    if (exposureErr) return NextResponse.json({ ok: false, error: exposureErr.message }, { status: 500 })
    if (!exposureResult?.ok) return NextResponse.json({ ok: false, error: exposureResult?.error }, { status: 400 })

    const loanExposure = Number(exposureResult.loanExposure || 0)
    const savingsExposure = Number(exposureResult.savingsExposure || 0)
    const savingsEligible = Number(exposureResult.savingsEligible || 0)
    // loanEligible is what this member can still take this cycle under the
    // exhibition rules (annual limit minus loans taken, with the category /
    // pensioner / retiree fallbacks) — computed inside the locked RPC, so the
    // two never disagree.
    const loanEligible = Number(exposureResult.loanEligible || 0)

    // Enforce limits
    if (paymentOption === 'Savings') {
      if (savingsEligible <= 0) return NextResponse.json({ ok: false, error: 'Savings option is not available for this member.' }, { status: 400 })
      if (totalPrincipal > savingsEligible) {
        return NextResponse.json({ ok: false, error: `Total exceeds your Savings limit (₦${savingsEligible.toLocaleString()}).` }, { status: 400 })
      }
    }
    if (paymentOption === 'Loan') {
      if (loanEligible <= 0) return NextResponse.json({ ok: false, error: 'Loan option is not available for this member.' }, { status: 400 })
      if (capAmount > loanEligible) {
        return NextResponse.json(
          {
            ok: false,
            error: includeInterestInCap
              ? `Total (incl. ${loanInterestRatePct}% interest) ₦${totalAmount.toLocaleString()} exceeds Loan available ₦${loanEligible.toLocaleString()}`
              : `Principal total ₦${totalPrincipal.toLocaleString()} exceeds Loan available ₦${loanEligible.toLocaleString()} (interest is excluded from the cap)`,
          },
          { status: 400 }
        )
      }
    }

    // Duplicate guard — same member, payment, products and qty within 30s
    const createdSince = new Date(Date.now() - 30_000).toISOString()
    const lineSig = [...lines]
      .map((l) => `${l.product_id}x${l.qty}`)
      .sort()
      .join('|')
    const { data: recent } = await supabase
      .from('exhibition_orders')
      .select('id, order_id, created_at')
      .eq('member_id', memberId)
      .eq('payment_option', paymentOption)
      .eq('status', 'Pending')
      .gte('created_at', createdSince)
      .order('created_at', { ascending: false })
      .limit(5)
    for (const r of recent || []) {
      const { data: recentLines } = await supabase
        .from('exhibition_order_lines')
        .select('product_id, qty')
        .eq('order_id', r.id)
      const sig = (recentLines || [])
        .map((l) => `${l.product_id}x${l.qty}`)
        .sort()
        .join('|')
      if (sig === lineSig) {
        return NextResponse.json({ ok: true, order_id: r.order_id, duplicate: true })
      }
    }

    // Reserve stock ATOMICALLY before creating the order. The read-only check
    // above is a friendly fast-fail; this RPC is the real oversell guard (a
    // single guarded UPDATE per product inside one transaction — if any line
    // can't be covered, everything rolls back and nothing is decremented).
    // Drop this member's courtesy cart holds first: the order's atomic
    // decrement is the real reservation, and keeping both would count the same
    // units twice when the catalogue subtracted them.
    await supabase
      .from('exhibition_stock_holds')
      .delete()
      .eq('member_id', memberId)
      .in('product_id', ids)

    const reserveItems = priced.map((l) => ({ product_id: l.product_id, qty: l.qty }))
    const { error: reserveErr } = await supabase.rpc('exhibition_reserve_stock', { p_items: reserveItems })
    if (reserveErr) {
      const msg = String(reserveErr.message || '')
      if (msg.includes('EXHIBITION_OVERSELL')) {
        return NextResponse.json(
          { ok: false, error: 'Not enough stock for an item in your cart. Some items may have sold out.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ ok: false, error: reserveErr.message }, { status: 500 })
    }

    // Create the order + lines + vendor payment rows.
    // order_id is a short random string behind a UNIQUE constraint, so a
    // collision must retry instead of surfacing as a checkout failure.
    let orderId = ''
    let inserted = null
    let insErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      orderId = makeOrderId()
      const res = await supabase
        .from('exhibition_orders')
        .insert({
          order_id: orderId,
          cycle_id: cycleId,
          branch_id: branchId,
          member_id: memberId,
          member_name_snapshot: member.full_name || '',
          payment_option: paymentOption,
          status: 'Pending',
          total_qty: totalQty,
          total_amount: totalAmount,
          exh_loan_grace_used: false,
        })
        .select('id')
        .single()
      inserted = res.data
      insErr = res.error
      if (!insErr || String(insErr?.code || '') !== '23505') break
    }
    if (insErr) {
      // Roll the reservation back so we never lock stock without an order.
      await supabase.rpc('exhibition_release_stock', { p_items: reserveItems }).catch(() => {})
      return NextResponse.json({ ok: false, error: insErr.message || 'Failed to create order' }, { status: 500 })
    }
    const orderDbId = inserted.id

    const { error: lineErr } = await supabase.from('exhibition_order_lines').insert(
      [...priced, ...serviceLines].map((l) => ({
        order_id: orderDbId,
        vendor_id: l.vendor_id,
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku,
        unit: l.unit,
        vendor_price: l.vendor_price,
        final_price: l.final_price,
        qty: l.qty,
        amount: l.amount,
      }))
    )
    if (lineErr) {
      await supabase.rpc('exhibition_release_stock', { p_items: reserveItems }).catch(() => {})
      return NextResponse.json({ ok: false, error: lineErr.message }, { status: 500 })
    }

    // One payment row per vendor in this order (co-op pays vendors later)
    const byVendor = new Map()
    for (const l of [...priced, ...serviceLines]) {
      byVendor.set(l.vendor_id, (byVendor.get(l.vendor_id) || 0) + l.amount)
    }
    const { error: payErr } = await supabase.from('exhibition_vendor_payment_status').insert(
      [...byVendor.entries()].map(([vendorId, amount]) => ({
        cycle_id: cycleId,
        vendor_id: vendorId,
        order_id: orderDbId,
        amount,
        paid: false,
      }))
    )
    if (payErr) {
      await supabase.rpc('exhibition_release_stock', { p_items: reserveItems }).catch(() => {})
      return NextResponse.json({ ok: false, error: payErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      total: totalAmount,
      principal: totalPrincipal,
      interest: loanInterest,
      payment_option: paymentOption,
      eligibility: { savingsEligible, loanEligible },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to place order' }, { status: 500 })
  }
}
