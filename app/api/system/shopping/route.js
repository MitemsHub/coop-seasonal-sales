// app/api/system/shopping/route.js
// Public endpoint to read whether food shopping is open.
// Open/closed is derived from the active cycle's start and end dates:
//   open = active cycle exists AND (no starts_at OR starts_at <= now) AND (no ends_at OR ends_at > now)
import { queryDirect } from '@/lib/directDb'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isDirectDbUnavailable(error) {
  return error?.message?.includes('SUPABASE_DB_URL')
}

// The active food cycle (id, name, code, starts_at, ends_at) — null when
// no active cycle or the table is missing.
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

/**
 * Determine whether food shopping is open based on the active cycle dates.
 * A cycle is considered "open" when:
 *   1. An active cycle exists, AND
 *   2. starts_at is absent or <= now, AND
 *   3. ends_at is absent or > now.
 */
function isCycleOpen(cycle) {
  if (!cycle) return false
  const now = Date.now()
  const started = !cycle.starts_at || new Date(cycle.starts_at).getTime() <= now
  const notEnded = !cycle.ends_at || new Date(cycle.ends_at).getTime() > now
  return started && notEnded
}

export async function GET() {
  try {
    const cycle = await getFoodCycle()
    const open = isCycleOpen(cycle)
    return Response.json({ ok: true, open, cycle })
  } catch (error) {
    // Fallback to Supabase when direct DB is unavailable
    if (isDirectDbUnavailable(error)) {
      try {
        const supabase = createClient()
        const cycle = await getFoodCycleViaSupabase(supabase)
        const open = isCycleOpen(cycle)
        return Response.json({ ok: true, open, cycle })
      } catch (innerError) {
        console.error('GET /api/system/shopping Supabase fallback error:', innerError)
        return Response.json({ ok: false, error: 'Failed to read shopping status' }, { status: 500 })
      }
    }
    console.error('GET /api/system/shopping error:', error)
    return Response.json({ ok: false, error: 'Failed to read shopping status' }, { status: 500 })
  }
}