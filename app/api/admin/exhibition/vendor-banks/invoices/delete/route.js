import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { removeInvoiceFile } from '@/lib/invoiceStorage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export async function DELETE(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const invoiceId = asInt(searchParams.get('invoice_id') || searchParams.get('id'), 0)
    if (!invoiceId) return NextResponse.json({ ok: false, error: 'invoice_id required' }, { status: 400 })

    const supabase = createClient()
    const { data: inv, error: selErr } = await supabase
      .from('exhibition_vendor_invoices')
      .select('id,storage_bucket,storage_path')
      .eq('id', invoiceId)
      .maybeSingle()

    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })
    if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })

    await removeInvoiceFile(supabase, inv)

    const { error: delErr } = await supabase.from('exhibition_vendor_invoices').delete().eq('id', invoiceId)
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
