// app/api/admin/system/shopping/route.js
// Admin endpoint to read food shopping status.
// Open/closed is derived from the active cycle's start and end dates.
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { queryDirect } from '@/lib/directDb'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isDirectDbUnavailable(error) {
  return error?.message?.includes('SUPABASE_DB_URL')
}

async function getFoodCycle() {
  try {
    const result = await queryDirect(
      'SELECT id, name, code, starts_at, ends_at FROM cycles WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1'
    )
    const c = result.rows?.[0]
    return c ? { id: Number(c.id), name: c.name || '', code: c.code || '', starts_at: c.starts_at || null, ends_at: c.ends_at || null } : null
  } catch {
    return null
  }
}

async function getFoodCycleViaSupabase(supabase) {
  try {
    const { data } = await supabase
      .from('cycles')
      .select('id, name, code, starts_at, ends_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
      ? { id: Number(data.id), name: data.name || '', code: data.code || '', starts_at: data.starts_at || null, ends_at: data.ends_at || null }
      : null
  } catch {
    return null
  }
}

function isCycleOpen(cycle) {
  if (!cycle) return false
  const now = Date.now()
  const started = !cycle.starts_at || new Date(cycle.starts_at).getTime() <= now
  const notEnded = !cycle.ends_at || new Date(cycle.ends_at).getTime() > now
  return started && notEnded
}

export async function GET(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const cycle = await getFoodCycle()
      const open = isCycleOpen(cycle)
      return NextResponse.json({ ok: true, open, cycle })
    } catch (error) {
      if (isDirectDbUnavailable(error)) {
        const supabase = createClient()
        const cycle = await getFoodCycleViaSupabase(supabase)
        const open = isCycleOpen(cycle)
        return NextResponse.json({ ok: true, open, cycle })
      }
      throw error
    }
  } catch (error) {
    console.error('GET /api/admin/system/shopping error:', error)
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to read setting' }, { status: 500 })
  }
}