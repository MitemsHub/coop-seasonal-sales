// app/api/branches/list/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    // id included so admin forms can post a numeric branch_id (the cycles and
    // vendor pages select by id; existing consumers keep using code/name).
    const { data, error } = await supabase
      .from('branches')
      .select('id, code, name')
      .order('name')
    
    if (error) {
      console.error('Error fetching branches:', error)
      return NextResponse.json({ ok: false, error: 'Failed to fetch branches' }, { status: 500 })
    }
    
    return NextResponse.json({ ok: true, branches: data || [] })
  } catch (error) {
    console.error('Branches list error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}