import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'

export async function POST(req) {
  try {
    const supabase = createClient()
    const { skus } = await req.json()
    
    if (!Array.isArray(skus) || skus.length === 0) {
      return NextResponse.json({ ok: false, error: 'SKUs array is required' }, { status: 400 })
    }

    // Batch fetch items by SKUs
    const { data: items, error } = await supabase
      .from('items')
      .select('item_id, sku, name, department')
      .in('sku', skus)
      .eq('is_active', true)

    if (error) {
      console.error('Batch items fetch error:', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }

    // Create SKU to item mapping
    const itemsMap = {}
    items.forEach(item => {
      itemsMap[item.sku] = {
        id: item.item_id,
        sku: item.sku,
        name: item.name,
        department: item.department
      }
    })

    // Check for missing SKUs
    const foundSkus = items.map(item => item.sku)
    const missingSkus = skus.filter(sku => !foundSkus.includes(sku))

    return NextResponse.json({ 
      ok: true, 
      items: itemsMap,
      missing_skus: missingSkus,
      found_count: foundSkus.length,
      missing_count: missingSkus.length
    })
  } catch (e) {
    console.error('Batch items error:', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}