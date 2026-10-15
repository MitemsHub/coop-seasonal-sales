import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const supabase = createClient()
    const { branchCode, sku, qty, note } = await req.json()
    const adjQty = Number(qty)
    if (!branchCode || !sku || !adjQty) {
      return NextResponse.json({ ok:false, error:'branchCode, sku, qty required' }, { status:400 })
    }

    const [{ data: br }, { data: it }] = await Promise.all([
      supabase.from('branches').select('id,code').eq('code', branchCode).single(),
      supabase.from('items').select('item_id,sku').eq('sku', sku).eq('is_active', true).single()
    ])
    if (!br) return NextResponse.json({ ok:false, error:'Branch not found' }, { status:404 })
    if (!it) return NextResponse.json({ ok:false, error:'Item not found' }, { status:404 })

    // Record the inventory movement for audit trail
    const movementData = {
      item_id: it.item_id,
      branch_id: br.id,
      movement_type: adjQty > 0 ? 'In' : 'Out',
      quantity: Math.abs(adjQty),
      reference_type: 'adjustment',
      notes: note || 'Admin adjustment'
    }
    
    const { error: insErr } = await supabase
      .from('inventory_movements')
      .insert(movementData)
    if (insErr) return NextResponse.json({ ok:false, error: insErr.message }, { status:500 })

    // Calculate new stock based on all movements for this item/branch
    const { data: movements, error: movementsErr } = await supabase
      .from('inventory_movements')
      .select('movement_type, quantity')
      .eq('item_id', it.item_id)
      .eq('branch_id', br.id)

    if (movementsErr) return NextResponse.json({ ok:false, error: movementsErr.message }, { status:500 })

    const currentStock = movements.reduce((sum, movement) => {
      return sum + (movement.movement_type === 'In' ? movement.quantity : -movement.quantity)
    }, 0)

    return NextResponse.json({ 
      ok: true, 
      previousStock: currentStock - adjQty,
      adjustment: adjQty,
      newStock: currentStock
    })
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 })
  }
}