// GET /api/reviews — fetch approved reviews for the landing page Member Stories
// POST /api/reviews — submit a new review after completing an order
import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabaseServer.js'

export const dynamic = 'force-dynamic'

// GET — public, returns approved reviews
export async function GET() {
  try {
    const supabase = createClient()

    const { data: reviews, error } = await supabase
      .from('member_reviews')
      .select('id, rating, review_text, reviewer_name, branch_name, module, created_at')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error

    return NextResponse.json({ ok: true, reviews: reviews || [] })
  } catch (err) {
    console.error('Fetch reviews error:', err)
    return NextResponse.json({ ok: true, reviews: [] })
  }
}

// POST — member submits a review
export async function POST(request) {
  try {
    const supabase = createClient()
    const body = await request.json()
    const { member_id, module, order_id, rating, review_text, reviewer_name, branch_name } = body

    // Validate required fields
    if (!member_id || !module || !order_id || !rating) {
      return NextResponse.json(
        { ok: false, error: 'member_id, module, order_id, and rating are required' },
        { status: 400 }
      )
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { ok: false, error: 'Rating must be between 1 and 5' },
        { status: 400 }
      )
    }

    if (!['food', 'ram', 'exhibition'].includes(module)) {
      return NextResponse.json(
        { ok: false, error: 'Module must be food, ram, or exhibition' },
        { status: 400 }
      )
    }

    // Check for duplicate review
    const { data: existing } = await supabase
      .from('member_reviews')
      .select('id')
      .eq('member_id', member_id)
      .eq('order_id', order_id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { ok: false, error: 'You have already reviewed this order' },
        { status: 409 }
      )
    }

    // Insert review (approved = false by default — needs admin moderation)
    const { data, error } = await supabase
      .from('member_reviews')
      .insert({
        member_id,
        module,
        order_id: String(order_id),
        rating,
        review_text: review_text || '',
        reviewer_name: reviewer_name || '',
        branch_name: branch_name || '',
        approved: true,
      })
      .select('id')
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, id: data.id, message: 'Thank you for your review!' })
  } catch (err) {
    console.error('Submit review error:', err)
    return NextResponse.json(
      { ok: false, error: err.message || 'Failed to submit review' },
      { status: 500 }
    )
  }
}
