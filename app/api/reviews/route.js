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
      .select('id, member_id, rating, review_text, reviewer_name, branch_name, module, created_at')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error

    let rows = reviews || []

    // Reviews can be created with nothing but member_id (reviewer_name and
    // branch_name blank), which renders as nameless cards on the landing
    // page. Fill the gaps from the members/branches tables without
    // rewriting what was stored.
    if (rows.some((r) => !r.reviewer_name || !r.branch_name)) {
      const memberIds = [...new Set(rows.map((r) => r.member_id).filter(Boolean))]
      if (memberIds.length > 0) {
        const { data: members } = await supabase
          .from('members')
          .select('member_id, full_name, branch_id')
          .in('member_id', memberIds)
        const memberById = new Map((members || []).map((m) => [m.member_id, m]))
        const branchIds = [...new Set((members || []).map((m) => m.branch_id).filter(Boolean))]
        const branchNameById = new Map()
        if (branchIds.length > 0) {
          const { data: branches } = await supabase
            .from('branches')
            .select('id, name')
            .in('id', branchIds)
          for (const b of branches || []) branchNameById.set(b.id, b.name)
        }
        rows = rows.map((r) => {
          const m = memberById.get(r.member_id)
          if (!m) return r
          return {
            ...r,
            reviewer_name: r.reviewer_name || m.full_name || '',
            branch_name: r.branch_name || branchNameById.get(m.branch_id) || '',
          }
        })
      }
    }

    // Same member + same (or empty) review text renders as identical cards —
    // e.g. a member who rates several orders without writing a note. Keep
    // only the newest row of each such pair so the carousel never repeats.
    const seen = new Set()
    const deduped = []
    for (const r of rows) {
      const key = `${r.member_id}|${String(r.review_text || '').trim()}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(r)
    }

    return NextResponse.json({ ok: true, reviews: deduped })
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
