// app/api/exhibition/orders/route.js
// Member order creation for the Coop Exhibition module.
//   POST /api/exhibition/orders
// body: { member_id, delivery_branch_code, department_name, payment_option,
//         lines: [{ product_id, qty }] }
//
// Business rules:
//   - The active exhibition cycle is org-wide, not per member branch.
//   - The delivery branch determines which approved catalogue items are
//     available, and is stored on the order so admin and rep views report it
//     to the branch fulfilling the order.
//   - Each product price = vendor_price (the member price).
//   - Savings/Loan limits reuse the shared eligibility numbers, reduced by the
//     member's open exhibition exposure (Pending/Approved orders).
//   - Loan orders accrue interest at the cycle's loan_interest_rate_pct.
//   - One order, lines tagged per vendor, plus a vendor payment-status row per
//     vendor (the co-op pays vendors after the exhibition).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { csrfGuard } from '@/lib/csrf'
import { validateMemberId, validateNumber, validatePaymentOption } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

// Statuses that still consume this cycle's loan allowance. Confirmed orders
// have already been spent — excluding them would free the cap.

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
      lines.push({ product_id: pid, qty: qtyRes.value })
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
      .eq('approval_status', 'approved')
    if (!delivProducts) {
      return NextResponse.json(
        { ok: false, error: 'Delivery is only available at branches taking part in this exhibition.' },
        { status: 400 }
      )
    }

    // Duplicate guard — same member, payment, products and qty within 30s.
    // This is a courtesy check, not the race guard; the RPC below is atomic.
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

    // ── Atomic checkout ────────────────────────────────────────────────
    // The RPC locks the member, prices the products, enforces the cap,
    // reserves stock, and writes the order + lines + vendor rows in one
    // transaction. If any step fails, PostgreSQL rolls all of it back.
    let lastError = 'Could not create the order.'
    for (let attempt = 0; attempt < 3; attempt++) {
      const orderId = makeOrderId()
      const { data: result, error: rpcErr } = await supabase.rpc('create_exhibition_order_atomic', {
        p_order_id: orderId,
        p_cycle_id: cycleId,
        p_branch_id: Number(deliveryBranch.id),
        p_member_id: memberId,
        p_payment_option: paymentOption,
        p_lines: lines,
      })

      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('EXHIBITION_DUPLICATE_ORDER')) {
          lastError = 'Could not allocate an order number. Please try again.'
          continue
        }
        if (msg.includes('EXHIBITION_OVERSELL')) {
          return NextResponse.json(
            { ok: false, error: 'Not enough stock for an item in your cart. Some items may have sold out.' },
            { status: 400 }
          )
        }
        if (msg.includes('EXHIBITION_CLOSED')) {
          return NextResponse.json(
            { ok: false, error: 'The Coop Exhibition is closed right now.' },
            { status: 400 }
          )
        }
        if (msg.includes('EXHIBITION_PRODUCT_UNAVAILABLE')) {
          return NextResponse.json(
            { ok: false, error: 'A product in your cart is no longer available.' },
            { status: 400 }
          )
        }
        return NextResponse.json({ ok: false, error: rpcErr.message || 'Failed to place order' }, { status: 500 })
      }

      if (!result?.ok) {
        return NextResponse.json({ ok: false, error: result?.error || 'Could not place the order.' }, { status: 400 })
      }

      return NextResponse.json({
        ok: true,
        order_id: result.order_id,
        total: Number(result.total || 0),
        principal: Number(result.principal || 0),
        interest: Number(result.interest || 0),
        payment_option: paymentOption,
        eligibility: {
          savingsEligible: Number(result.eligibility?.savingsEligible || 0),
          loanEligible: Number(result.eligibility?.loanEligible || 0),
        },
      })
    }

    return NextResponse.json({ ok: false, error: lastError }, { status: 500 })

  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to place order' }, { status: 500 })
  }
}
