// app/api/orders/route.secure.js
// Secure version of orders API with proper validation and error handling
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { 
  validateMemberId, 
  validateBranchCode, 
  validatePaymentOption, 
  validateOrderLines,
  sanitizeString,
  checkRateLimit,
  getClientIP
} from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(url, serviceKey)

// Standardized error response
function errorResponse(message, status = 400, code = null) {
  return NextResponse.json({ 
    ok: false, 
    error: message,
    code,
    timestamp: new Date().toISOString()
  }, { status })
}

// Standardized success response
function successResponse(data, status = 200) {
  return NextResponse.json({ 
    ok: true, 
    ...data,
    timestamp: new Date().toISOString()
  }, { status })
}

export async function GET() {
  return successResponse({ message: 'Orders API is operational' })
}

export async function POST(req) {
  try {
    // Rate limiting
    const clientIP = getClientIP(req)
    if (!checkRateLimit(`orders:${clientIP}`, 10, 60000)) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED')
    }

    // Parse and validate request body
    let body
    try {
      body = await req.json()
    } catch (e) {
      return errorResponse('Invalid JSON in request body', 400, 'INVALID_JSON')
    }

    const { memberId, deliveryBranchCode, departmentName, paymentOption, lines } = body || {}

    // Input validation
    const memberValidation = validateMemberId(memberId)
    if (!memberValidation.isValid) {
      return errorResponse(`Invalid member ID: ${memberValidation.error}`, 400, 'INVALID_MEMBER_ID')
    }

    const branchValidation = validateBranchCode(deliveryBranchCode)
    if (!branchValidation.isValid) {
      return errorResponse(`Invalid delivery branch: ${branchValidation.error}`, 400, 'INVALID_BRANCH_CODE')
    }

    const paymentValidation = validatePaymentOption(paymentOption)
    if (!paymentValidation.isValid) {
      return errorResponse(`Invalid payment option: ${paymentValidation.error}`, 400, 'INVALID_PAYMENT_OPTION')
    }

    const linesValidation = validateOrderLines(lines)
    if (!linesValidation.isValid) {
      return errorResponse(`Invalid order lines: ${linesValidation.error}`, 400, 'INVALID_ORDER_LINES')
    }

    // Sanitize department name
    const sanitizedDepartmentName = sanitizeString(departmentName, { maxLength: 255 })
    if (!sanitizedDepartmentName) {
      return errorResponse('Department name is required', 400, 'MISSING_DEPARTMENT')
    }

    // Database operations with proper error handling
    try {
      // Fetch member with timeout
      const { data: member, error: mErr } = await supabase
        .from('members')
        .select('member_id, full_name, category, savings, loans, global_limit, branch_id')
        .eq('member_id', memberValidation.sanitized)
        .single()
        .abortSignal(AbortSignal.timeout(5000)) // 5 second timeout

      if (mErr || !member) {
        return errorResponse('Member not found', 404, 'MEMBER_NOT_FOUND')
      }

      // Fetch delivery branch
      const { data: deliveryBranch, error: bErr } = await supabase
        .from('branches')
        .select('id, code, name')
        .eq('code', branchValidation.sanitized)
        .single()
        .abortSignal(AbortSignal.timeout(5000))

      if (bErr || !deliveryBranch) {
        return errorResponse('Delivery branch not found', 404, 'BRANCH_NOT_FOUND')
      }

      // Fetch department
      const { data: deptRow, error: dErr } = await supabase
        .from('departments')
        .select('id, name')
        .eq('name', sanitizedDepartmentName)
        .single()
        .abortSignal(AbortSignal.timeout(5000))

      if (dErr || !deptRow) {
        return errorResponse('Department not found', 404, 'DEPARTMENT_NOT_FOUND')
      }

      const hasColumn = async (table, column) => {
        const { error } = await supabase.from(table).select(column).limit(1)
        return !error
      }

      const { data: activeCycle, error: cycleErr } = await supabase
        .from('cycles')
        .select('id, starts_at, ends_at')
        .eq('is_active', true)
        .maybeSingle()
        .abortSignal(AbortSignal.timeout(5000))
      if (cycleErr) return errorResponse(cycleErr.message, 500, 'DATABASE_ERROR')
      if (!activeCycle?.id) return errorResponse('No active cycle found', 400, 'NO_ACTIVE_CYCLE')

      // Reject orders outside the cycle date window
      const now = Date.now()
      if (activeCycle.starts_at && new Date(activeCycle.starts_at).getTime() > now) {
        return errorResponse('This cycle has not started yet. Orders open on ' + new Date(activeCycle.starts_at).toLocaleDateString(), 400, 'CYCLE_NOT_STARTED')
      }
      if (activeCycle.ends_at && new Date(activeCycle.ends_at).getTime() <= now) {
        return errorResponse('This cycle has ended. Please wait for the next cycle to open.', 400, 'CYCLE_ENDED')
      }

      const [ordersHasCycle, pricesHasCycle] = await Promise.all([
        hasColumn('orders', 'cycle_id'),
        hasColumn('branch_item_prices', 'cycle_id'),
      ])

      // Calculate exposure with proper error handling
      const statuses = ['Pending', 'Posted', 'Delivered']
      const sumAmt = (rows) => (rows || []).reduce((s, r) => s + Number(r.total_amount || 0), 0)

      const [loanResult, savingsResult] = await Promise.all([
        supabase
          .from('orders')
          .select('total_amount')
          .eq('member_id', memberValidation.sanitized)
          .eq('payment_option', 'Loan')
          .in('status', statuses)
          .abortSignal(AbortSignal.timeout(5000)),
        supabase
          .from('orders')
          .select('total_amount')
          .eq('member_id', memberValidation.sanitized)
          .eq('payment_option', 'Savings')
          .in('status', statuses)
          .abortSignal(AbortSignal.timeout(5000))
      ])

      if (loanResult.error) {
        console.error('Shopping exposure query failed:', loanResult.error)
        return errorResponse('Failed to calculate shopping exposure', 500, 'DATABASE_ERROR')
      }

      if (savingsResult.error) {
        console.error('Savings exposure query failed:', savingsResult.error)
        return errorResponse('Failed to calculate savings exposure', 500, 'DATABASE_ERROR')
      }

      const loanExposure = sumAmt(loanResult.data)
      const savingsExposure = sumAmt(savingsResult.data)

      // Calculate eligibility
      const memberLoans = Number(member.loans || 0)
      const memberSavings = Number(member.savings || 0)
      const globalLimit = Number(member.global_limit || 0)

      const outstandingLoansTotal = memberLoans + loanExposure
      const savingsBase = 0.5 * memberSavings
      const savingsEligible = outstandingLoansTotal > 0 ? 0 : Math.max(0, savingsBase - savingsExposure)
      const rawLoanLimit = memberSavings * 5 - outstandingLoansTotal
      const loanEligible = Math.min(Math.max(rawLoanLimit, 0), globalLimit)

      // Process order lines with validation
      let total = 0
      const pricedLines = []

      for (const line of linesValidation.sanitized) {
        // Fetch item
        const { data: item, error: iErr } = await supabase
          .from('items')
          .select('item_id, sku')
          .eq('sku', line.sku)
          .single()
          .abortSignal(AbortSignal.timeout(5000))

        if (iErr || !item) {
          return errorResponse(`Item not found: ${line.sku}`, 404, 'ITEM_NOT_FOUND')
        }

        // Fetch price
        let priceQuery = supabase
          .from('branch_item_prices')
          .select('id, price')
          .eq('branch_id', deliveryBranch.id)
          .eq('item_id', item.item_id)
        if (pricesHasCycle) priceQuery = priceQuery.eq('cycle_id', activeCycle.id)

        const { data: bip, error: pErr } = await priceQuery
          .single()
          .abortSignal(AbortSignal.timeout(5000))

        if (pErr || !bip) {
          return errorResponse(`No price for ${line.sku} in ${branchValidation.sanitized}`, 404, 'PRICE_NOT_FOUND')
        }

        const unit_price = Number(bip.price)
        if (unit_price < 0 || unit_price > 1000000) {
          return errorResponse(`Invalid price for ${line.sku}`, 400, 'INVALID_PRICE')
        }

        const amount = unit_price * line.qty
        total += amount

        pricedLines.push({
          item_id: item.item_id,
          branch_item_price_id: bip.id,
          unit_price,
          qty: line.qty,
          amount
        })
      }

      // Validate total amount
      if (total <= 0 || total > 10000000) {
        return errorResponse('Invalid order total', 400, 'INVALID_TOTAL')
      }

      // Enforce payment limits
      if (paymentValidation.sanitized === 'Savings') {
        if (outstandingLoansTotal > 0) {
          return errorResponse('Savings not allowed while loans outstanding (including pending/posted loan applications)', 400, 'SAVINGS_BLOCKED_BY_LOANS')
        }
        if (total > savingsEligible) {
          return errorResponse(`Total ₦${total.toLocaleString()} exceeds Savings available ₦${savingsEligible.toLocaleString()}`, 400, 'EXCEEDS_SAVINGS_LIMIT')
        }
      } else if (paymentValidation.sanitized === 'Loan') {
        if (total > loanEligible) {
          return errorResponse(`Total ₦${total.toLocaleString()} exceeds Loan available ₦${loanEligible.toLocaleString()}`, 400, 'EXCEEDS_LOAN_LIMIT')
        }
      }

      // Insert order with transaction
      const orderInsert = {
        member_id: member.member_id,
        member_name_snapshot: member.full_name,
        member_category_snapshot: member.category,
        branch_id: member.branch_id,
        delivery_branch_id: deliveryBranch.id,
        department_id: deptRow.id,
        payment_option: paymentValidation.sanitized,
        total_amount: total,
        status: 'Pending'
      }
      if (ordersHasCycle) orderInsert.cycle_id = activeCycle.id

      const { data: order, error: oErr } = await supabase
        .from('orders')
        .insert(orderInsert)
        .select('order_id')
        .single()
        .abortSignal(AbortSignal.timeout(10000))

      if (oErr || !order) {
        console.error('Order insert failed:', oErr)
        return errorResponse('Failed to create order', 500, 'ORDER_INSERT_FAILED')
      }

      // Insert order lines
      const orderLines = pricedLines.map(pl => ({ order_id: order.order_id, ...pl }))
      const { error: lErr } = await supabase
        .from('order_lines')
        .insert(orderLines)
        .abortSignal(AbortSignal.timeout(10000))

      if (lErr) {
        console.error('Order lines insert failed:', lErr)
        // Try to clean up the order
        await supabase.from('orders').delete().eq('order_id', order.order_id)
        return errorResponse('Failed to create order lines', 500, 'ORDER_LINES_INSERT_FAILED')
      }

      return successResponse({
        order_id: order.order_id,
        total,
        payment_option: paymentValidation.sanitized,
        eligibility: {
          savingsEligible,
          loanEligible
        }
      }, 201)

    } catch (dbError) {
      console.error('Database operation failed:', dbError)
      return errorResponse('Database operation failed', 500, 'DATABASE_ERROR')
    }

  } catch (error) {
    console.error('Order creation error:', error)
    return errorResponse('Internal server error', 500, 'INTERNAL_ERROR')
  }
}
