// POST /api/chat/send — send a chat message (member or admin)
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export async function POST(request) {
  try {
    const body = await request.json()
    const { sender_type, sender_id, sender_name, message, attachment_url, attachment_type, attachment_name } = body

    if (!sender_type || !sender_id) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
    }

    if (!message?.trim() && !attachment_url) {
      return NextResponse.json({ ok: false, error: 'Message or attachment required' }, { status: 400 })
    }

    if (!['member', 'admin'].includes(sender_type)) {
      return NextResponse.json({ ok: false, error: 'Invalid sender_type' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        sender_type,
        sender_id: String(sender_id),
        sender_name: sender_name || '',
        message: message?.trim() || '',
        attachment_url: attachment_url || null,
        attachment_type: attachment_type || null,
        attachment_name: attachment_name || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Chat send error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to send message' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: data })
  } catch (err) {
    console.error('Chat send error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
