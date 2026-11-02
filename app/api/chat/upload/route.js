// POST /api/chat/upload — upload an image or file for chat attachments
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer.js'
import { validateSession } from '../../../../lib/validation.js'
import { checkRateLimitShared, rateLimitResponse } from '../../../../lib/rateLimitShared.js'

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
    // Attachments require a signed-in session. Without this anyone can POST a
    // file straight into the bucket with any sender_id they like. Guests can
    // still exchange text messages.
    const session = await validateSession(request)
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Please sign in to send attachments.' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const senderId = formData.get('sender_id')

    if (!file || !senderId) {
      return NextResponse.json({ ok: false, error: 'file and sender_id required' }, { status: 400 })
    }

    // A signed-in member may only attach files to their own conversation.
    const claims = session.claims || {}
    const sessionMemberId = String(claims.member_id || claims.sub || '').toUpperCase()
    if (claims.role === 'member' && sessionMemberId && String(senderId).toUpperCase() !== sessionMemberId) {
      return NextResponse.json({ ok: false, error: 'You can only attach files to your own chat.' }, { status: 403 })
    }

    // Uploads are the expensive path (storage + bandwidth), so they get a
    // tighter limit than ordinary chat messages.
    const limited = await checkRateLimitShared('chat-upload', String(claims.member_id || senderId), 20, 60_000)
    if (!limited.allowed) return rateLimitResponse(limited.retryAfterMs)

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, error: 'File too large (max 5 MB)' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ ok: false, error: `File type not allowed: ${file.type}` }, { status: 400 })
    }

    const ext = file.name.split('.').pop() || 'bin'
    const path = `chat/${senderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const supabase = createClient()
    const buffer = Buffer.from(await file.arrayBuffer())

    // Try upload directly
    let { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      })

    // If bucket doesn't exist, create it and retry
    if (uploadError) {
      const msg = String(uploadError.message || uploadError.error || '')
      const isMissing = msg.includes('Bucket not found') || msg.includes('does not exist') || uploadError.status === 404

      if (isMissing) {
        console.log('[chat-upload] Bucket missing, creating chat-attachments…')
        const { error: createErr } = await supabase.storage.createBucket('chat-attachments', {
          public: true,
          fileSizeLimit: MAX_SIZE,
          allowedMimeTypes: ALLOWED_TYPES,
        })
        if (createErr) {
          console.error('[chat-upload] Bucket create error:', createErr)
          return NextResponse.json({ ok: false, error: `Failed to create storage bucket: ${createErr.message}` }, { status: 500 })
        }

        // Retry upload
        const retry = await supabase.storage
          .from('chat-attachments')
          .upload(path, buffer, { contentType: file.type, upsert: false })
        if (retry.error) {
          console.error('[chat-upload] Retry upload error:', retry.error)
          return NextResponse.json({ ok: false, error: `Upload failed after bucket creation: ${retry.error.message}` }, { status: 500 })
        }
      } else {
        console.error('[chat-upload] Upload error:', uploadError)
        return NextResponse.json({ ok: false, error: `Upload failed: ${msg}` }, { status: 500 })
      }
    }

    const { data: urlData } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(path)

    if (!urlData?.publicUrl) {
      return NextResponse.json({ ok: false, error: 'Failed to get public URL' }, { status: 500 })
    }

    const isImage = file.type.startsWith('image/')

    return NextResponse.json({
      ok: true,
      url: urlData.publicUrl,
      type: isImage ? 'image' : 'file',
      name: file.name,
    })
  } catch (err) {
    console.error('[chat-upload] Unexpected error:', err)
    return NextResponse.json({ ok: false, error: err.message || 'Upload failed' }, { status: 500 })
  }
}
