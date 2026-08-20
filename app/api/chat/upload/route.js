// POST /api/chat/upload — upload an image or file for chat attachments
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'

const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]

export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const senderId = formData.get('sender_id')

    if (!file || !senderId) {
      return NextResponse.json({ ok: false, error: 'file and sender_id required' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, error: 'File too large (max 5 MB)' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ ok: false, error: 'File type not allowed' }, { status: 400 })
    }

    const ext = file.name.split('.').pop() || 'bin'
    const path = `chat/${senderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const supabase = createClient()

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      // If bucket doesn't exist, create it and retry
      if (uploadError.message?.includes('Bucket not found') || uploadError.status === 404) {
        await supabase.storage.createBucket('chat-attachments', { public: true })
        const { error: retryError } = await supabase.storage
          .from('chat-attachments')
          .upload(path, buffer, { contentType: file.type, upsert: false })
        if (retryError) throw retryError
      } else {
        throw uploadError
      }
    }

    const { data: urlData } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(path)

    const isImage = file.type.startsWith('image/')

    return NextResponse.json({
      ok: true,
      url: urlData.publicUrl,
      type: isImage ? 'image' : 'file',
      name: file.name,
    })
  } catch (err) {
    console.error('Chat upload error:', err)
    return NextResponse.json({ ok: false, error: 'Upload failed' }, { status: 500 })
  }
}
