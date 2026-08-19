import { queryDirect } from '@/lib/directDb'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isDirectDbUnavailable(error) {
  return error?.message?.includes('SUPABASE_DB_URL')
}

// The active ram season (id, name, code, ends_at) — null when no active
// cycle or the table is missing. Best-effort: never breaks the flag read.
async function getRamCycle() {
  try {
    const result = await queryDirect(
      'SELECT id, name, code, ends_at FROM ram_cycles WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1'
    )
    const c = result.rows?.[0]
    return c ? { id: Number(c.id), name: c.name || '', code: c.code || '', ends_at: c.ends_at || null } : null
  } catch {
    return null
  }
}

async function getRamCycleViaSupabase(supabase) {
  try {
    const { data } = await supabase
      .from('ram_cycles')
      .select('id, name, code, ends_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
      ? { id: Number(data.id), name: data.name || '', code: data.code || '', ends_at: data.ends_at || null }
      : null
  } catch {
    return null
  }
}

export async function GET() {
  try {
    try {
      await queryDirect(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value VARCHAR(255),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

      const result = await queryDirect('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', ['ram_shopping_open'])
      const value = result.rows[0]?.value
      const open = value === 'true'
      const cycle = await getRamCycle()
      return Response.json({ ok: true, open, cycle })
    } catch (error) {
      if (isDirectDbUnavailable(error)) {
        const supabase = createClient()
        const { data, error: sErr } = await supabase.from('app_settings').select('value').eq('key', 'ram_shopping_open').limit(1).maybeSingle()
        if (sErr) return Response.json({ ok: false, error: sErr.message || 'Failed to read shopping status' }, { status: 500 })
        const value = data?.value
        const open = value === 'true'
        const cycle = await getRamCycleViaSupabase(supabase)
        return Response.json({ ok: true, open, cycle })
      }
      throw error
    }
  } catch (error) {
    return Response.json({ ok: false, error: 'Failed to read shopping status' }, { status: 500 })
  }
}

