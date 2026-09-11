import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public list of vendor stands for the vendor login "Select your Hub" dropdown.
// Shows all active vendors regardless of cycle status or date window.
export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, status, branches:branch_id(name), cycles:cycle_id(name)')
      .eq('status', 'active')
      .order('name')

    if (error) {
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message || 'Failed to load vendor stands' }, { status: 500 })
    }

    const vendors = (data || []).map((v) => ({
      id: Number(v.id),
      name: v.name || '',
      code: v.code || '',
      branch: v.branches?.name || '',
      cycle: v.cycles?.name || '',
    }))

    return NextResponse.json({ ok: true, vendors })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load vendor stands' }, { status: 500 })
  }
}
