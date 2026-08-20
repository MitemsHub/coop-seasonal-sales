// GET /api/public/stats — public endpoint for landing page stats
// Returns real member, branch, and delivered-order counts.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()

    // Run all three count queries in parallel
    const [membersRes, branchesRes, deliveredRes] = await Promise.all([
      supabase.from('members').select('member_id', { count: 'exact', head: true }),
      supabase.from('branches').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'Delivered'),
    ])

    const memberCount = membersRes.count ?? 0
    const branchCount = branchesRes.count ?? 0
    const deliveredCount = deliveredRes.count ?? 0

    return NextResponse.json({
      ok: true,
      stats: {
        members: memberCount,
        branches: branchCount,
        delivered: deliveredCount,
        rating: 4.8, // static — no ratings table yet
      },
    })
  } catch (err) {
    console.error('Public stats error:', err)
    // Return fallback values so the landing page never breaks
    return NextResponse.json({
      ok: true,
      stats: { members: 0, branches: 0, delivered: 0, rating: 4.8 },
    })
  }
}
