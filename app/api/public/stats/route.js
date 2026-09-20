// GET /api/public/stats — public endpoint for landing page stats
// Returns real member, branch, delivered-order counts (all 3 modules),
// and average rating from member_reviews.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()

    // Run all count queries in parallel
    const [membersRes, branchesRes, foodDeliveredRes, ramDeliveredRes, exhibitionDeliveredRes, ratingRes] = await Promise.all([
      supabase.from('members').select('member_id', { count: 'exact', head: true }),
      supabase.from('branches').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'Delivered'),
      supabase.from('ram_orders').select('id', { count: 'exact', head: true }).eq('status', 'Delivered'),
      supabase.from('exhibition_orders').select('id', { count: 'exact', head: true }).eq('status', 'Delivered'),
      supabase.from('member_reviews').select('rating', { count: 'exact', head: true }),
    ])

    const memberCount = membersRes.count ?? 0
    const branchCount = branchesRes.count ?? 0
    const deliveredCount = (foodDeliveredRes.count ?? 0) + (ramDeliveredRes.count ?? 0) + (exhibitionDeliveredRes.count ?? 0)

    // Compute average rating from member_reviews
    let rating = null
    if (ratingRes.count > 0) {
      const { data: ratings } = await supabase
        .from('member_reviews')
        .select('rating')
      if (ratings && ratings.length > 0) {
        const sum = ratings.reduce((acc, r) => acc + (r.rating || 0), 0)
        rating = Math.round((sum / ratings.length) * 10) / 10
      }
    }

    return NextResponse.json({
      ok: true,
      stats: {
        members: memberCount,
        branches: branchCount,
        delivered: deliveredCount,
        rating,
      },
    })
  } catch (err) {
    console.error('Public stats error:', err)
    return NextResponse.json({
      ok: true,
      stats: { members: 0, branches: 0, delivered: 0, rating: null },
    })
  }
}
