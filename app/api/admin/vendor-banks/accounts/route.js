// app/api/admin/vendor-banks/accounts/route.js
// Admin management of the bank accounts attached to one payout owner.
//   GET    ?module=food|ram|exhibition&owner_id=NNN   — every account, not just the current one
//   POST   { module, owner_id, bank_name, account_name, account_number, make_current? }
//   PATCH  { module, owner_id, account_id, ...fields, make_current? }
//   DELETE ?module=...&owner_id=...&account_id=...
// A payout owner can hold several accounts (food and ram already do); exactly
// one of them is current and is the one payouts point at.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { resolveFoodCycle } from '@/lib/cycleResolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ACCOUNTS = 10

const MODULES = {
  food: {
    table: 'food_vendor_bank_accounts',
    ownerCol: 'branch_id',
    cycleCol: 'cycle_id',
    label: 'branch',
  },
  ram: {
    table: 'ram_vendor_bank_accounts',
    ownerCol: 'ram_delivery_location_id',
    cycleCol: 'ram_cycle_id',
    label: 'delivery location',
  },
  exhibition: {
    table: 'exhibition_vendor_bank_accounts',
    ownerCol: 'vendor_id',
    cycleCol: 'cycle_id',
    label: 'vendor',
  },
}

const SELECT = 'id,bank_name,account_name,account_number,is_current,created_at,created_by_role,created_by_code'

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

function isMissingColumn(error, columnName) {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const c = String(columnName || '').toLowerCase()
  if (!msg.includes(c)) return false
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find'))
}

async function hasColumn(supabase, tableName, columnName) {
  const { error } = await supabase.from(tableName).select(columnName).limit(1)
  if (!error) return true
  if (isMissingTable(error, tableName) || isMissingColumn(error, columnName)) return false
  throw error
}

function cleanText(v, maxLen = 120) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

function normalizeAccountNumber(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function parseId(v) {
  const n = Math.trunc(Number(v || 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

async function resolveRamCycleId(supabase) {
  const { data: active, error } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'ram_cycles')) return null
    throw error
  }
  if (active?.id) return active.id
  const { data: latest, error: lErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (lErr) {
    if (isMissingTable(lErr, 'ram_cycles')) return null
    throw lErr
  }
  return latest?.id || null
}

// Resolves the owner row, its payout cycle and whether the season is locked
// (a paid vendor's bank details must not move underneath the payment).
async function loadContext(supabase, module, ownerId) {
  const meta = MODULES[module]
  if (!meta) return { error: 'Unknown module', status: 400 }

  let owner = null
  let cycleId = null
  let extra = {}

  if (module === 'food') {
    const { data, error } = await supabase.from('branches').select('id,name,code').eq('id', ownerId).maybeSingle()
    if (error) throw error
    if (!data) return { error: 'Branch not found', status: 404 }
    owner = data
    const cycle = await resolveFoodCycle(supabase)
    cycleId = cycle?.id ? Number(cycle.id) : null
    const { data: paid } = await supabase
      .from('food_vendor_payment_status')
      .select('is_paid')
      .eq('branch_id', ownerId)
      .eq('cycle_id', cycleId)
      .maybeSingle()
    extra.paid = !!paid?.is_paid
  } else if (module === 'ram') {
    const { data, error } = await supabase
      .from('ram_delivery_locations')
      .select('id,name,delivery_location')
      .eq('id', ownerId)
      .maybeSingle()
    if (error) throw error
    if (!data) return { error: 'Delivery location not found', status: 404 }
    owner = data
    cycleId = await resolveRamCycleId(supabase)
    if (cycleId) {
      const { data: paid, error: pErr } = await supabase
        .from('ram_vendor_payment_status')
        .select('is_paid')
        .eq('ram_delivery_location_id', ownerId)
        .eq('ram_cycle_id', cycleId)
        .maybeSingle()
      if (pErr && !isMissingTable(pErr, 'ram_vendor_payment_status')) throw pErr
      extra.paid = !!paid?.is_paid
    }
  } else {
    const { data, error } = await supabase
      .from('exhibition_vendors')
      .select('id,name,code,cycle_id,branch_id')
      .eq('id', ownerId)
      .maybeSingle()
    if (error) throw error
    if (!data) return { error: 'Vendor not found', status: 404 }
    owner = data
    cycleId = data.cycle_id ? Number(data.cycle_id) : null
    extra.branch_id = data.branch_id || null
  }

  const bankHasCycle = module === 'food' || module === 'exhibition'
    ? true
    : await hasColumn(supabase, meta.table, meta.cycleCol).catch(() => false)

  return { meta, owner, cycleId, bankHasCycle, extra }
}

function scoped(query, ctx, ownerId) {
  const { meta, cycleId, bankHasCycle } = ctx
  let q = query.eq(meta.ownerCol, ownerId)
  if (bankHasCycle && cycleId) q = q.eq(meta.cycleCol, cycleId)
  return q
}

async function listAccounts(supabase, ctx, ownerId) {
  const { meta } = ctx
  let q = supabase.from(meta.table).select(SELECT)
  q = scoped(q, ctx, ownerId).order('created_at', { ascending: false })
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error, meta.table)) return []
    throw error
  }
  // Current account first, then newest.
  return (data || []).sort((a, b) => Number(b.is_current) - Number(a.is_current))
}

async function promoteNewest(supabase, ctx, ownerId) {
  const { meta } = ctx
  let q = supabase.from(meta.table).select('id')
  q = scoped(q, ctx, ownerId).order('created_at', { ascending: false }).limit(1)
  const { data, error } = await q
  if (error || !data?.length) return null
  const nextId = Number(data[0].id)
  const { error: upErr } = await supabase.from(meta.table).update({ is_current: true }).eq('id', nextId)
  return upErr ? null : nextId
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const module = String(searchParams.get('module') || '')
    const ownerId = parseId(searchParams.get('owner_id'))
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId) return NextResponse.json({ ok: false, error: 'owner_id is required' }, { status: 400 })

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })

    const accounts = await listAccounts(supabase, ctx, ownerId)
    return NextResponse.json({
      ok: true,
      module,
      owner_id: ownerId,
      cycle_id: ctx.cycleId,
      locked: !!ctx.extra?.paid,
      accounts,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load bank accounts' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const module = String(body.module || '')
    const ownerId = parseId(body.owner_id)
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId) return NextResponse.json({ ok: false, error: 'owner_id is required' }, { status: 400 })

    const bankName = cleanText(body.bank_name, 120)
    const accountName = cleanText(body.account_name, 120)
    const accountNumber = cleanText(body.account_number, 40)
    if (!bankName || !accountName || !accountNumber) {
      return NextResponse.json({ ok: false, error: 'Bank name, account name and account number are required' }, { status: 400 })
    }

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })
    if (ctx.extra?.paid) return NextResponse.json({ ok: false, error: 'Vendor is marked as Paid. Editing is locked.' }, { status: 403 })

    const existing = await listAccounts(supabase, ctx, ownerId)
    if (existing.length >= MAX_ACCOUNTS) {
      return NextResponse.json({ ok: false, error: `Up to ${MAX_ACCOUNTS} bank accounts per vendor. Remove one first.` }, { status: 400 })
    }
    const target = normalizeAccountNumber(accountNumber)
    if (existing.some((a) => normalizeAccountNumber(a.account_number) === target)) {
      return NextResponse.json({ ok: false, error: 'That account number is already attached.' }, { status: 409 })
    }

    const wantsPrimary = body.make_current === true || body.make_current === 'true'
    const hasPrimary = existing.some((a) => a.is_current)
    const setPrimary = wantsPrimary || !hasPrimary

    if (setPrimary && hasPrimary) {
      let clearQ = supabase.from(ctx.meta.table).update({ is_current: false })
      clearQ = scoped(clearQ, ctx, ownerId).eq('is_current', true)
      const { error: clearErr } = await clearQ
      if (clearErr) return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 })
    }

    const createdByCode = cleanText(session?.claims?.email || session?.claims?.user || 'admin', 120) || 'admin'
    const row = {
      [ctx.meta.ownerCol]: ownerId,
      bank_name: bankName,
      account_name: accountName,
      account_number: accountNumber,
      is_current: setPrimary,
      created_by_role: 'admin',
      created_by_code: createdByCode,
    }
    if (ctx.bankHasCycle && ctx.cycleId) row[ctx.meta.cycleCol] = ctx.cycleId
    if (module === 'exhibition' && ctx.extra?.branch_id) row.branch_id = ctx.extra.branch_id

    const { data, error } = await supabase.from(ctx.meta.table).insert(row).select(SELECT).single()
    if (error) {
      if (String(error.code || '') === '23505') {
        return NextResponse.json({ ok: false, error: 'Only one account can be current — retry, or mark another account current.' }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, account: data, accounts: await listAccounts(supabase, ctx, ownerId) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to add bank account' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const module = String(body.module || '')
    const ownerId = parseId(body.owner_id)
    const accountId = parseId(body.account_id)
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId || !accountId) return NextResponse.json({ ok: false, error: 'owner_id and account_id are required' }, { status: 400 })

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })
    if (ctx.extra?.paid) return NextResponse.json({ ok: false, error: 'Vendor is marked as Paid. Editing is locked.' }, { status: 403 })

    const accounts = await listAccounts(supabase, ctx, ownerId)
    const row = accounts.find((a) => Number(a.id) === accountId)
    if (!row) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })

    const patch = {}
    if (body.bank_name !== undefined) {
      const bankName = cleanText(body.bank_name, 120)
      if (!bankName) return NextResponse.json({ ok: false, error: 'Bank name is required' }, { status: 400 })
      patch.bank_name = bankName
    }
    if (body.account_name !== undefined) {
      const accountName = cleanText(body.account_name, 120)
      if (!accountName) return NextResponse.json({ ok: false, error: 'Account name is required' }, { status: 400 })
      patch.account_name = accountName
    }
    if (body.account_number !== undefined) {
      const accountNumber = cleanText(body.account_number, 40)
      if (!accountNumber) return NextResponse.json({ ok: false, error: 'Account number is required' }, { status: 400 })
      const next = normalizeAccountNumber(accountNumber)
      if (accounts.some((a) => Number(a.id) !== accountId && normalizeAccountNumber(a.account_number) === next)) {
        return NextResponse.json({ ok: false, error: 'That account number is already attached.' }, { status: 409 })
      }
      patch.account_number = accountNumber
    }

    const wantsPrimary = body.make_current === true || body.make_current === 'true'
    if (!Object.keys(patch).length && !wantsPrimary) {
      return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })
    }

    if (wantsPrimary && !row.is_current) {
      let clearQ = supabase.from(ctx.meta.table).update({ is_current: false })
      clearQ = scoped(clearQ, ctx, ownerId).eq('is_current', true)
      const { error: clearErr } = await clearQ
      if (clearErr) return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 })
      patch.is_current = true
    }

    const { data, error } = await supabase
      .from(ctx.meta.table)
      .update(patch)
      .eq('id', accountId)
      .select(SELECT)
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, account: data, accounts: await listAccounts(supabase, ctx, ownerId) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update bank account' }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const module = String(searchParams.get('module') || '')
    const ownerId = parseId(searchParams.get('owner_id'))
    const accountId = parseId(searchParams.get('account_id'))
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId || !accountId) return NextResponse.json({ ok: false, error: 'owner_id and account_id are required' }, { status: 400 })

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })
    if (ctx.extra?.paid) return NextResponse.json({ ok: false, error: 'Vendor is marked as Paid. Editing is locked.' }, { status: 403 })

    const accounts = await listAccounts(supabase, ctx, ownerId)
    const row = accounts.find((a) => Number(a.id) === accountId)
    if (!row) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })

    const { error } = await supabase.from(ctx.meta.table).delete().eq('id', accountId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    let promotedId = null
    if (row.is_current) promotedId = await promoteNewest(supabase, ctx, ownerId).catch(() => null)

    return NextResponse.json({
      ok: true,
      deleted_id: accountId,
      promoted_id: promotedId,
      accounts: await listAccounts(supabase, ctx, ownerId),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to remove bank account' }, { status: 500 })
  }
}
