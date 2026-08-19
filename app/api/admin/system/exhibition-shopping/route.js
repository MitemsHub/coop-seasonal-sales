// app/api/admin/system/exhibition-shopping/route.js
// Admin endpoint to read and update the exhibition Shopping Control toggle —
// mirrors /api/admin/system/shopping (food) and /api/admin/system/ram-shopping
// (ram). The value lives in app_settings under 'exhibition_shopping_open';
// unset defaults to open so exhibition availability still follows the seasons.
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { queryDirect } from '@/lib/directDb'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isDirectDbUnavailable(error) {
  return error?.message?.includes('SUPABASE_DB_URL')
}

async function ensureTable() {
  try {
    await queryDirect(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value VARCHAR(255),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  } catch (error) {
    if (isDirectDbUnavailable(error)) return
    throw error
  }
}

export async function GET(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    try {
      await ensureTable()
      const res = await queryDirect('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', ['exhibition_shopping_open'])
      const value = res.rows[0]?.value
      return NextResponse.json({ ok: true, open: value === 'true' })
    } catch (error) {
      if (isDirectDbUnavailable(error)) {
        const supabase = createClient()
        const { data, error: sErr } = await supabase.from('app_settings').select('value').eq('key', 'exhibition_shopping_open').limit(1).maybeSingle()
        if (sErr) return NextResponse.json({ ok: false, error: sErr.message || 'Failed to read setting' }, { status: 500 })
        return NextResponse.json({ ok: true, open: data?.value === 'true' })
      }
      throw error
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to read setting' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { open } = body || {}
    if (typeof open !== 'boolean') return NextResponse.json({ ok: false, error: 'Invalid payload: open must be boolean' }, { status: 400 })

    try {
      await ensureTable()
      await queryDirect(
        `INSERT INTO app_settings(key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        ['exhibition_shopping_open', open ? 'true' : 'false']
      )
      return NextResponse.json({ ok: true, open })
    } catch (error) {
      if (isDirectDbUnavailable(error)) {
        const supabase = createClient()
        const { error: sErr } = await supabase
          .from('app_settings')
          .upsert({ key: 'exhibition_shopping_open', value: open ? 'true' : 'false', updated_at: new Date().toISOString() }, { onConflict: 'key' })
        if (sErr) return NextResponse.json({ ok: false, error: sErr.message || 'Failed to update setting' }, { status: 500 })
        return NextResponse.json({ ok: true, open })
      }
      throw error
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to update setting' }, { status: 500 })
  }
}
