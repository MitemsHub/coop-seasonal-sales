// GET /api/chat/messages?sender_id=xxx — fetch messages for a member conversation
// GET /api/chat/messages?all=true — fetch all conversations (admin view)
// GET /api/chat/messages?unread=true — fetch unread messages (admin badge)
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const senderId = searchParams.get('sender_id')
    const all = searchParams.get('all') === 'true'
    const unreadOnly = searchParams.get('unread') === 'true'
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 500)

    const supabase = createClient()

    // Unread count for admin badge
    if (unreadOnly) {
      const { count, error } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null)
        .eq('sender_type', 'member')

      if (error) throw error
      return NextResponse.json({ ok: true, count: count || 0 })
    }

    // All conversations — distinct member list with last message
    if (all) {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('sender_id, sender_name, sender_type, message, attachment_url, attachment_type, attachment_name, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error

      // Group by sender_id and pick the latest message per member
      const members = new Map()
      for (const msg of data || []) {
        if (msg.sender_type === 'member' && !members.has(msg.sender_id)) {
          members.set(msg.sender_id, {
            sender_id: msg.sender_id,
            sender_name: msg.sender_name,
            last_message: msg.message,
            last_at: msg.created_at,
          })
        }
      }

      return NextResponse.json({ ok: true, conversations: Array.from(members.values()) })
    }

    // Single member conversation
    if (!senderId) {
      return NextResponse.json({ ok: false, error: 'sender_id required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, sender_type, sender_id, sender_name, message, attachment_url, attachment_type, attachment_name, created_at, read_at')
      .eq('sender_id', senderId)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) throw error
    return NextResponse.json({ ok: true, messages: data || [] })
  } catch (err) {
    console.error('[chat-messages] Error:', err?.message || err)
    return NextResponse.json({ ok: false, error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
