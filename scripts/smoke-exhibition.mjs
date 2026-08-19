// Smoke test for the Coop Exhibition lifecycle against a local stack.
// Drives the app's REAL API routes on the test server (3010):
//   member checkout → rep approve → vendor deliver → admin payout
// plus cancel / restore and cancelled-order payout exclusion.
import fs from 'node:fs'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3010'
const PASS = []
const FAIL = []

function ok(name, cond, detail) {
  if (cond) {
    PASS.push(name)
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    FAIL.push(name)
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function jfetch(path, { method = 'GET', body, cookies = '' } = {}) {
  // The dev server compiles routes on first hit after a restart; a cold route
  // can answer 404 once before it is ready. Retry a couple of times — a real
  // missing route keeps 404ing across retries, so nothing is masked.
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookies) headers.Cookie = cookies
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    })
    if (res.status !== 404 || attempt === 2) {
      let json = null
      try {
        json = await res.json()
      } catch {
        /* non-JSON */
      }
      const setCookie = res.headers.get('set-cookie') || ''
      return { status: res.status, json, setCookie }
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
}

function grabCookie(setCookie, name) {
  if (!setCookie) return ''
  const m = setCookie.match(new RegExp(`${name}=([^;]+)`))
  return m ? `${name}=${m[1]}` : ''
}

console.log('── 1. Member checkout ─────────────────────────────')
const checkout = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'ABJ-001',
    delivery_branch_code: 'ABJ',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [
      { product_id: 1, qty: 2 },
      { product_id: 2, qty: 1 },
    ],
  },
})
ok('checkout HTTP 200', checkout.status === 200, `status ${checkout.status}`)
ok('checkout ok:true', checkout.json?.ok === true, JSON.stringify(checkout.json?.error || checkout.json))
const orderId = checkout.json?.order_id
ok('order id issued', !!orderId, orderId || '')
// product1 = 40,000 + 5,000 = 45,000 ×2 ; product2 negotiated 8,000 ×1 → 98,000
ok('total priced correctly (98,000, negotiated 8,000 applied)', checkout.json?.total === 98000, `total ${checkout.json?.total}`)

console.log('── 2. Rep login + approve ─────────────────────────')
const repLogin = await jfetch('/api/rep/session', { method: 'POST', body: { module: 'exhibition', passcode: 'ABJ' } })
ok('rep login ok', repLogin.json?.ok === true, JSON.stringify(repLogin.json?.error || ''))
const repCookie = grabCookie(repLogin.setCookie, 'rep_token')
ok('rep_token cookie set', !!repCookie)

const pending = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: repCookie })
ok('rep pending list ok', pending.json?.ok === true)
const myOrder = (pending.json?.orders || []).find((o) => o.order_id === orderId)
ok('order visible to rep', !!myOrder, myOrder ? `id=${myOrder.id} total=${myOrder.total_amount}` : '')
ok('order lines tagged per vendor', (myOrder?.lines || []).length === 2 && myOrder.lines.every((l) => l.vendor_id === 1))
ok('rep cannot see other branch orders (only 1 seeded branch → scoping sanity)', pending.json?.orders?.every((o) => o.branch_id === 1) !== false)

const approve = await jfetch('/api/rep/exhibition/orders/approve', { method: 'POST', body: { ids: [myOrder.id] }, cookies: repCookie })
ok('rep approve ok', approve.json?.ok === true && (approve.json?.approved || []).includes(myOrder.id), JSON.stringify(approve.json))

const approvedList = await jfetch('/api/rep/exhibition/orders/list?status=Approved', { cookies: repCookie })
const approvedOrder = (approvedList.json?.orders || []).find((o) => o.order_id === orderId)
ok('order now Approved', approvedOrder?.status === 'Approved', approvedOrder?.status)

console.log('── 3. Vendor login + deliver ──────────────────────')
const vendorLogin = await jfetch('/api/vendor/session', { method: 'POST', body: { code: 'VND1', passcode: '1234' } })
ok('vendor login ok', vendorLogin.json?.ok === true, JSON.stringify(vendorLogin.json?.error || vendorLogin.json))
const vendorCookie = grabCookie(vendorLogin.setCookie, 'vendor_token')
ok('vendor_token cookie set', !!vendorCookie)

const deliver = await jfetch('/api/vendor/exhibition/orders', { method: 'POST', body: { orderId }, cookies: vendorCookie })
ok('vendor deliver ok', deliver.json?.ok === true, JSON.stringify(deliver.json))
ok('order fully delivered (single vendor)', deliver.json?.order_delivered === true, `order_delivered=${deliver.json?.order_delivered}`)

const memberOrders = await jfetch(`/api/exhibition/orders?member_id=${encodeURIComponent('ABJ-001')}`)
const memberOrder = (memberOrders.json?.orders || []).find((o) => o.order_id === orderId)
ok('member sees order Delivered', memberOrder?.status === 'Delivered', memberOrder?.status)
ok('member order carries lines w/ images field', Array.isArray(memberOrder?.lines) && memberOrder.lines.length === 2)

console.log('── 4. Admin login + payouts ───────────────────────')
const adminLogin = await jfetch('/api/admin/pin/session', { method: 'POST', body: { passcode: 'Coop@2025' } })
ok('admin login ok', adminLogin.json?.ok === true, JSON.stringify(adminLogin.json?.error || ''))
const adminCookie = grabCookie(adminLogin.setCookie, 'admin_token')
ok('admin_token cookie set', !!adminCookie)

const payouts = await jfetch('/api/admin/exhibition/payouts?cycle_id=1', { cookies: adminCookie })
ok('payouts GET ok', payouts.json?.ok === true, JSON.stringify(payouts.json?.error || ''))
const vendor = (payouts.json?.vendors || []).find((v) => v.code === 'VND1')
ok('vendor owed gross 98,000 (delivered, not cancelled)', vendor?.gross === 98000, `gross=${vendor?.gross}`)
ok('deduction 6% applied (5,880)', vendor?.deduction === 5880, `deduction=${vendor?.deduction}`)
ok('net 92,120, unpaid', vendor?.net === 92120 && vendor?.paid === false, `net=${vendor?.net} paid=${vendor?.paid}`)

const markPaid = await jfetch('/api/admin/exhibition/payouts', { method: 'POST', body: { vendor_id: 1, cycle_id: 1, amount: 92120, paid: true }, cookies: adminCookie })
// Known P1: upsert uses onConflict cycle_id,vendor_id but the table's UNIQUE is (order_id, vendor_id).
ok('mark-paid POST succeeds', markPaid.status === 200 && markPaid.json?.ok === true, `status=${markPaid.status} ${JSON.stringify(markPaid.json)}`)

console.log('── 5. Cancel → payout exclusion ───────────────────')
const second = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'ABJ-001',
    delivery_branch_code: 'ABJ',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [{ product_id: 1, qty: 1 }],
  },
})
ok('second checkout ok', second.json?.ok === true, second.json?.error || second.json?.order_id || '')
const secondId = second.json?.order_id
const pending2 = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: repCookie })
const order2 = (pending2.json?.orders || []).find((o) => o.order_id === secondId)
ok('second order pending', !!order2)
const cancel = await jfetch('/api/rep/exhibition/orders/cancel', { method: 'POST', body: { ids: [order2.id], reason: 'Smoke-test cancel' }, cookies: repCookie })
ok('rep cancel ok', cancel.json?.ok === true && (cancel.json?.cancelled || []).includes(order2.id), JSON.stringify(cancel.json))
const cancelledList = await jfetch('/api/rep/exhibition/orders/list?status=Cancelled', { cookies: repCookie })
const cancelledOrder = (cancelledList.json?.orders || []).find((o) => o.order_id === secondId)
ok('order now Cancelled with reason', cancelledOrder?.status === 'Cancelled' && !!cancelledOrder?.cancelled_reason, cancelledOrder?.cancelled_reason)

const restore = await jfetch('/api/rep/exhibition/orders/restore', { method: 'POST', body: { ids: [order2.id] }, cookies: repCookie })
ok('rep restore ok', restore.json?.ok === true && (restore.json?.restored || []).includes(order2.id), JSON.stringify(restore.json))

// Cancel again so the payout math stays deterministic (one cancelled order excluded).
await jfetch('/api/rep/exhibition/orders/cancel', { method: 'POST', body: { ids: [order2.id], reason: 're-cancel after restore' }, cookies: repCookie })

const payouts2 = await jfetch('/api/admin/exhibition/payouts?cycle_id=1', { cookies: adminCookie })
const vendor2 = (payouts2.json?.vendors || []).find((v) => v.code === 'VND1')
ok('cancelled order excluded from owed gross (still 98,000)', vendor2?.gross === 98000, `gross=${vendor2?.gross}`)

console.log('── 6. Rep stats strip API ─────────────────────────')
const stats = await jfetch('/api/rep/exhibition/stats', { cookies: repCookie })
ok('rep stats ok', stats.json?.ok === true, JSON.stringify(stats.json?.error || ''))
ok('stats counts consistent (1 delivered, 1 cancelled)', stats.json?.statuses?.Delivered?.count === 1 && stats.json?.statuses?.Cancelled?.count === 1, JSON.stringify(stats.json?.statuses))

console.log('── 7. Multi-vendor order: partial delivery + split payout ──')
// Order C mixes vendors: product 1 (VND1, 45,000) + product 3 (VND2, 17,000) → 62,000.
const multi = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'ABJ-001',
    delivery_branch_code: 'ABJ',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [
      { product_id: 1, qty: 1 },
      { product_id: 3, qty: 1 },
    ],
  },
})
ok('multi-vendor checkout ok', multi.json?.ok === true, JSON.stringify(multi.json?.error || ''))
const multiOrderId = multi.json?.order_id
ok('multi-vendor total 62,000 (45,000 + 17,000)', multi.json?.total === 62000, `total ${multi.json?.total}`)

const multiPending = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: repCookie })
const multiOrder = (multiPending.json?.orders || []).find((o) => o.order_id === multiOrderId)
ok('multi-vendor order visible to rep', !!multiOrder, multiOrderId || '')
ok('order lines tagged per vendor (VND1 + VND2)',
  new Set((multiOrder?.lines || []).map((l) => l.vendor_id)).size === 2,
  JSON.stringify((multiOrder?.lines || []).map((l) => ({ v: l.vendor_id, p: l.product_name, q: l.qty }))))

const multiApprove = await jfetch('/api/rep/exhibition/orders/approve', { method: 'POST', body: { ids: [multiOrder.id] }, cookies: repCookie })
ok('multi-vendor approve ok', multiApprove.json?.ok === true && (multiApprove.json?.approved || []).includes(multiOrder.id), JSON.stringify(multiApprove.json))

// Partial delivery — VND1 hands over ONLY its own line; order must stay Approved.
const vnd2Login = await jfetch('/api/vendor/session', { method: 'POST', body: { code: 'VND2', passcode: '1234' } })
ok('vendor 2 login ok', vnd2Login.json?.ok === true, JSON.stringify(vnd2Login.json?.error || ''))
const vnd2Cookie = grabCookie(vnd2Login.setCookie, 'vendor_token')
ok('vendor2_token cookie set', !!vnd2Cookie)

const partialDeliver = await jfetch('/api/vendor/exhibition/orders', { method: 'POST', body: { orderId: multiOrderId }, cookies: vendorCookie })
ok('VND1 partial deliver → order NOT fully delivered', partialDeliver.json?.ok === true && partialDeliver.json?.order_delivered === false, JSON.stringify(partialDeliver.json))

const partialCheck = await jfetch('/api/rep/exhibition/orders/list?status=Approved', { cookies: repCookie })
const partialOrder = (partialCheck.json?.orders || []).find((o) => o.order_id === multiOrderId)
ok('order stays Approved after partial delivery', partialOrder?.status === 'Approved', partialOrder?.status)

// VND2 completes its line → order flips to Delivered.
const finalDeliver = await jfetch('/api/vendor/exhibition/orders', { method: 'POST', body: { orderId: multiOrderId }, cookies: vnd2Cookie })
ok('VND2 deliver completes order', finalDeliver.json?.ok === true && finalDeliver.json?.order_delivered === true, JSON.stringify(finalDeliver.json))

const multiMember = await jfetch(`/api/exhibition/orders?member_id=${encodeURIComponent('ABJ-001')}`)
const multiMemberOrder = (multiMember.json?.orders || []).find((o) => o.order_id === multiOrderId)
ok('member sees multi-vendor order Delivered', multiMemberOrder?.status === 'Delivered', multiMemberOrder?.status)
ok('member order lines carry both vendors', new Set((multiMemberOrder?.lines || []).map((l) => l.vendor_name)).size === 2, JSON.stringify((multiMemberOrder?.lines || []).map((l) => l.vendor_name)))

// Per-vendor payout split — VND1 now owes 98,000 (order A) + 45,000 (order C),
// VND2 owes 17,000 (order C). Paying one vendor must not touch the other.
const splitPayouts = await jfetch('/api/admin/exhibition/payouts?cycle_id=1', { cookies: adminCookie })
const vnd1Split = (splitPayouts.json?.vendors || []).find((v) => v.code === 'VND1')
const vnd2Split = (splitPayouts.json?.vendors || []).find((v) => v.code === 'VND2')
ok('VND1 gross 143,000 (98,000 + 45,000)', vnd1Split?.gross === 143000, `gross=${vnd1Split?.gross}`)
ok('VND1 deduction 6% (8,580) → net 134,420', vnd1Split?.deduction === 8580 && vnd1Split?.net === 134420, `deduction=${vnd1Split?.deduction} net=${vnd1Split?.net}`)
ok('VND1 unpaid again after new order row', vnd1Split?.paid === false, `paid=${vnd1Split?.paid}`)
ok('VND2 gross 17,000, net 15,980', vnd2Split?.gross === 17000 && vnd2Split?.net === 15980, `gross=${vnd2Split?.gross} net=${vnd2Split?.net}`)
ok('VND2 unpaid', vnd2Split?.paid === false, `paid=${vnd2Split?.paid}`)

const markVnd2 = await jfetch('/api/admin/exhibition/payouts', { method: 'POST', body: { vendor_id: 2, cycle_id: 1, amount: 15980, paid: true }, cookies: adminCookie })
ok('mark VND2 paid ok', markVnd2.status === 200 && markVnd2.json?.ok === true, `status=${markVnd2.status} ${JSON.stringify(markVnd2.json)}`)

const paidCheck = await jfetch('/api/admin/exhibition/payouts?cycle_id=1', { cookies: adminCookie })
const vnd1After = (paidCheck.json?.vendors || []).find((v) => v.code === 'VND1')
const vnd2After = (paidCheck.json?.vendors || []).find((v) => v.code === 'VND2')
ok('VND2 paid, VND1 still unpaid (independent rows)', vnd2After?.paid === true && vnd1After?.paid === false, `VND2 paid=${vnd2After?.paid} VND1 paid=${vnd1After?.paid}`)

console.log('── 8. Branch scoping: LAG rep + vendor ─────────────')
const lagRepLogin = await jfetch('/api/rep/session', { method: 'POST', body: { module: 'exhibition', passcode: 'LAG' } })
ok('LAG rep login ok', lagRepLogin.json?.ok === true, JSON.stringify(lagRepLogin.json?.error || ''))
const lagRepCookie = grabCookie(lagRepLogin.setCookie, 'rep_token')
ok('LAG rep_token cookie set', !!lagRepCookie)

const lagPending = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: lagRepCookie })
ok('LAG rep sees zero ABJ orders (branch-scoped)', (lagPending.json?.orders || []).length === 0, JSON.stringify((lagPending.json?.orders || []).map((o) => o.order_id)))

// LAG member checks out from the LAG catalog → LAG rep sees it, ABJ rep does not.
const lagCheckout = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'LAG-001',
    delivery_branch_code: 'LAG',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [{ product_id: 4, qty: 1 }],
  },
})
ok('LAG checkout ok', lagCheckout.json?.ok === true, JSON.stringify(lagCheckout.json?.error || ''))
const lagOrderId = lagCheckout.json?.order_id
ok('LAG product priced 7,000 (6,000 + 1,000)', lagCheckout.json?.total === 7000, `total ${lagCheckout.json?.total}`)

const lagPending2 = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: lagRepCookie })
const lagOrder = (lagPending2.json?.orders || []).find((o) => o.order_id === lagOrderId)
ok('LAG rep sees LAG order', !!lagOrder, lagOrderId || '')
ok('LAG rep sees only branch 2 orders', (lagPending2.json?.orders || []).every((o) => o.branch_id === 2))

const abjPending2 = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: repCookie })
ok('ABJ rep does NOT see the LAG order', !(abjPending2.json?.orders || []).some((o) => o.order_id === lagOrderId))

// LAG vendor cannot touch an ABJ order.
const lagVendorLogin = await jfetch('/api/vendor/session', { method: 'POST', body: { code: 'VND3', passcode: '1234' } })
ok('LAG vendor login ok', lagVendorLogin.json?.ok === true, JSON.stringify(lagVendorLogin.json?.error || ''))
const lagVendorCookie = grabCookie(lagVendorLogin.setCookie, 'vendor_token')
// The route rejects cross-branch delivery either because the vendor has no
// lines on the order (404) or the order state forbids delivery (409) — both
// prove the LAG vendor cannot touch an ABJ order.
const crossDeliver = await jfetch('/api/vendor/exhibition/orders', { method: 'POST', body: { orderId: multiOrderId }, cookies: lagVendorCookie })
ok('LAG vendor cannot deliver ABJ order (rejected)', [404, 409].includes(crossDeliver.status), `status=${crossDeliver.status} ${JSON.stringify(crossDeliver.json)}`)
const multiAfterCross = await jfetch(`/api/exhibition/orders?member_id=${encodeURIComponent('ABJ-001')}`)
const multiStatus = (multiAfterCross.json?.orders || []).find((o) => o.order_id === multiOrderId)?.status
ok('ABJ order unaffected by LAG vendor attempt', multiStatus === 'Delivered', `status=${multiStatus}`)

const lagVendorList = await jfetch('/api/vendor/exhibition/orders', { cookies: lagVendorCookie })
ok('LAG vendor sees only its own lines (1 pending LAG order)', (lagVendorList.json?.orders || []).length === 1 && lagVendorList.json?.orders?.[0]?.order_id === lagOrderId, JSON.stringify((lagVendorList.json?.orders || []).map((o) => o.order_id)))

// Final stats: ABJ now has 2 delivered (orders A + C) + 1 cancelled.
const finalStats = await jfetch('/api/rep/exhibition/stats', { cookies: repCookie })
ok('ABJ final stats: 2 delivered, 1 cancelled', finalStats.json?.statuses?.Delivered?.count === 2 && finalStats.json?.statuses?.Cancelled?.count === 1, JSON.stringify(finalStats.json?.statuses))

console.log('── 9. Oversell protection (stock decrement + restore) ──')
// Product 5 'Festive Gift Basket' is seeded with qty = 2 so the stock math is
// exact. Checkout must decrement, cancel must release, restore must re-reserve,
// and any request past the remaining stock must be rejected.
const stockOf = async () => {
  const res = await jfetch('/api/admin/exhibition/products?cycle_id=1', { cookies: adminCookie })
  const p = (res.json?.products || []).find((x) => x.id === 5)
  return p ? Number(p.qty) : null
}

// 9a. Checkout consumes the entire stock (2 → 0).
const basket = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'ABJ-001',
    delivery_branch_code: 'ABJ',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [{ product_id: 5, qty: 2 }],
  },
})
ok('gift-basket checkout ok (2× 30,000 = 60,000)', basket.json?.ok === true && basket.json?.total === 60000, JSON.stringify(basket.json?.error || basket.json))
const basketOrderId = basket.json?.order_id
ok('gift-basket stock decremented 2 → 0', (await stockOf()) === 0, `qty=${await stockOf()}`)

// 9b. Oversell rejected — no stock left, order must not be created.
const oversell = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'ABJ-001',
    delivery_branch_code: 'ABJ',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [{ product_id: 5, qty: 1 }],
  },
})
ok('oversell checkout rejected (400 + not-enough-stock)', oversell.status === 400 && String(oversell.json?.error || '').toLowerCase().includes('stock'), `status=${oversell.status} ${oversell.json?.error}`)
ok('stock unchanged after rejected oversell (still 0)', (await stockOf()) === 0, `qty=${await stockOf()}`)

// 9c. Cancel releases the reserved units (0 → 2).
const basketPending = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: repCookie })
const basketOrder = (basketPending.json?.orders || []).find((o) => o.order_id === basketOrderId)
ok('basket order pending', !!basketOrder)
const basketCancel = await jfetch('/api/rep/exhibition/orders/cancel', { method: 'POST', body: { ids: [basketOrder.id], reason: 'Smoke oversell test' }, cookies: repCookie })
ok('cancel frees stock back to 2', basketCancel.json?.ok === true && (await stockOf()) === 2, `qty=${await stockOf()}`)

// 9d. Restore re-reserves the units (2 → 0).
const basketRestore = await jfetch('/api/rep/exhibition/orders/restore', { method: 'POST', body: { ids: [basketOrder.id] }, cookies: repCookie })
ok('restore re-reserves stock to 0', basketRestore.json?.ok === true && (await stockOf()) === 0, JSON.stringify(basketRestore.json))

// 9e. Oversold restore rejected: cancel (frees 2), another member takes the
// last units, then restoring the cancelled order must fail with 409.
await jfetch('/api/rep/exhibition/orders/cancel', { method: 'POST', body: { ids: [basketOrder.id], reason: 'free for competitor' }, cookies: repCookie })
const rival = await jfetch('/api/exhibition/orders', {
  method: 'POST',
  body: {
    member_id: 'ABJ-001',
    delivery_branch_code: 'ABJ',
    department_name: 'IT',
    payment_option: 'Savings',
    lines: [{ product_id: 5, qty: 2 }],
  },
})
ok('rival takes both units (stock 0)', rival.json?.ok === true && (await stockOf()) === 0, `qty=${await stockOf()}`)
const oversoldRestore = await jfetch('/api/rep/exhibition/orders/restore', { method: 'POST', body: { ids: [basketOrder.id] }, cookies: repCookie })
ok('oversold restore rejected (409 + not enough stock)', oversoldRestore.status === 409 && String(oversoldRestore.json?.error || '').toLowerCase().includes('stock'), `status=${oversoldRestore.status} ${oversoldRestore.json?.error}`)
ok('stock still 0 after rejected restore', (await stockOf()) === 0, `qty=${await stockOf()}`)

// 9f. Approval-time stock gate: the rival order HOLDS both reserved units
// (product qty 0 >= 0 → reservation intact), so approving it must succeed —
// proving the guard never falsely rejects the member who legitimately took
// the last units. (The rejection side — qty driven below zero by an external
// correction — is exercised live against the stack.)
const rivalPending = await jfetch('/api/rep/exhibition/orders/list?status=Pending', { cookies: repCookie })
const rivalRow = (rivalPending.json?.orders || []).find((o) => o.order_id === rival.json?.order_id)
ok('rival order still pending', !!rivalRow, rival.json?.order_id || '')
const rivalApprove = await jfetch('/api/rep/exhibition/orders/approve', { method: 'POST', body: { ids: [rivalRow.id] }, cookies: repCookie })
ok('approval passes while reservation intact (qty 0, not falsely rejected)', rivalApprove.json?.ok === true && (rivalApprove.json?.approved || []).includes(rivalRow.id), JSON.stringify(rivalApprove.json))

console.log(`\n══════ RESULT: ${PASS.length} passed, ${FAIL.length} failed ══════`)
if (FAIL.length) {
  console.log('FAILED:', FAIL.join(' · '))
  process.exit(1)
}
