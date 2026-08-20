// GET /api/chat/test — debug endpoint to verify chat_messages table is accessible
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()

    // 1. Check if table exists and is queryable
    const { count, error: countErr } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })

    if (countErr) {
      return NextResponse.json({
        ok: false,
        step: 'count',
        error: countErr.message,
        code: countErr.code,
        hint: 'Table may not exist or RLS is blocking. Run fix-chat-rls-and-storage.sql in Supabase.',
      })
    }

    // 2. Try fetching actual data
    const { data, error: selectErr } = await supabase
      .from('chat_messages')
      .select('id, sender_type, sender_id, sender_name, message, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    if (selectErr) {
      return NextResponse.json({
        ok: false,
        step: 'select',
        error: selectErr.message,
        code: selectErr.code,
        totalCount: count,
      })
    }

    // 3. Check storage bucket
    const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets()
    const hasBucket = (buckets || []).some((b) => b.id === 'chat-attachments')

    return NextResponse.json({
      ok: true,
      totalMessages: count || 0,
      sampleMessages: data || [],
      storageBuckets: (buckets || []).map((b) => b.id),
      hasChatAttachmentsBucket: hasBucket,
      bucketError: bucketErr?.message || null,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
