import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const supabase = createClient()
    const { sku, branchCode, adjustment, memberId, action } = await req.json()
    
    if (!sku || !branchCode || !adjustment || !memberId || !action) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing required fields: sku, branchCode, adjustment, memberId, action' 
      }, { status: 400 })
    }

    // Get branch, item, and active cycle
    const [{ data: branch }, { data: item }, { data: cycle }] = await Promise.all([
      supabase.from('branches').select('id,code').eq('code', branchCode).single(),
      supabase.from('items').select('item_id,sku').eq('sku', sku).eq('is_active', true).single(),
      supabase.from('cycles').select('id').eq('is_active', true).single()
    ])

    if (!branch) {
      return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })
    }
    if (!item) {
      return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })
    }
    if (!cycle) {
      return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    // Demand tracking mode - no stock validation needed
    // Simply log the demand adjustment for tracking purposes
    
    // Calculate movement quantity based on action (for logging purposes only)
    let movementQty = 0
    let movementType = ''
    let referenceType = ''

    switch (action) {
      case 'reserve':
        movementQty = adjustment // Positive for demand increase
        movementType = 'demand_increase'
        referenceType = 'reservation'
        break
      case 'release':
        movementQty = -adjustment // Negative for demand decrease
        movementType = 'demand_decrease'
        referenceType = 'release'
        break
      case 'purchase':
        movementQty = adjustment // Positive for confirmed demand
        movementType = 'demand_confirmed'
        referenceType = 'purchase'
        break
      default:
        return NextResponse.json({ 
          ok: false, 
          error: 'Invalid action. Must be reserve, release, or purchase' 
        }, { status: 400 })
    }

    // Optional: Record demand tracking movement (if you want to keep audit trail)
    // This is now just for logging/tracking purposes, not stock management
    const { error: movementError } = await supabase
      .from('inventory_movements')
      .insert({
        item_id: item.item_id,
        branch_id: branch.id,
        cycle_id: cycle.id,
        movement_type: movementType,
        quantity: movementQty,
        reference_type: referenceType,
        notes: `Demand ${action} by member ${memberId}`
      })

    if (movementError) {
      console.error('Demand tracking movement error:', movementError)
      // Don't fail the request for logging errors in demand tracking mode
    }

    // Always return success for demand tracking - no stock limits
    return NextResponse.json({ 
      ok: true, 
      demand: {
        adjustment: movementQty,
        action: action,
        mode: 'demand_tracking'
      }
    })

  } catch (error) {
    console.error('Demand adjustment error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}