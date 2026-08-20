// PATCH /api/chat/read — mark messages as read
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export async function PATCH(request) {
  try {
    const body = await request.json()
    const { sender_id } = body

    if (!sender_id) {
      return NextResponse.json({ ok: false, error: 'sender_id required' }, { status: 400 })
    }

    const supabase = createClient()
    const { error } = await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', sender_id)
      .eq('sender_type', 'member')
      .is('read_at', null)

    if (error) {
      console.error('Chat read error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to mark as read' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Chat read error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
