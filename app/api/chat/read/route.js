// PATCH /api/chat/read — mark messages as read
// Admin marks member messages: { sender_id: "MEMBER123" }
// Member marks admin messages: { reader_id: "MEMBER123" }
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export async function PATCH(request) {
  try {
    const body = await request.json()
    const { sender_id, reader_id } = body

    const supabase = createClient()

    // Member marking admin messages as read (their own chat thread)
    if (reader_id) {
      const { error } = await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('sender_id', reader_id)
        .eq('sender_type', 'admin')
        .is('read_at', null)

      if (error) {
        console.error('[chat-read] Error marking admin messages read:', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    // Admin marking member messages as read
    if (sender_id) {
      const { error } = await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('sender_id', sender_id)
        .eq('sender_type', 'member')
        .is('read_at', null)

      if (error) {
        console.error('[chat-read] Error marking member messages read:', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: 'sender_id or reader_id required' }, { status: 400 })
  } catch (err) {
    console.error('[chat-read] Error:', err)
    return NextResponse.json({ ok: false, error: err.message || 'Internal server error' }, { status: 500 })
  }
}
