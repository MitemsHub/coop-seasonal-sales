// app/api/food-survey/photo/route.js
// Public: uploads a single item photo for the /survey form.
// Photos upload as they are picked (small, one request each) so the final
// submit stays a light JSON payload — important on Vercel's 4.5MB request cap.
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'food-survey'
const VALID_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_BYTES = 8 * 1024 * 1024 // 8MB — phone photos; client compresses before sending

const extFor = (type) => (
  { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[type] || 'jpg'
)

export async function POST(req) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 })
    }
    if (!VALID_TYPES.includes(file.type)) {
      return NextResponse.json({ ok: false, error: 'Only JPG, PNG, HEIC or WebP images are allowed' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'Image is too large (max 8MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extFor(file.type)}`

    // Supabase Storage first (same pattern as upload-item-image).
    try {
      const supabase = createClient()
      const { data: bucketInfo, error: bucketErr } = await supabase.storage.getBucket(BUCKET)
      if (bucketErr || !bucketInfo) {
        await supabase.storage.createBucket(BUCKET, { public: true })
      }
      const path = `survey/${filename}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      })
      if (!upErr) {
        const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path)
        if (pub?.publicUrl) {
          return NextResponse.json({ ok: true, url: `${pub.publicUrl}?v=${Date.now()}` })
        }
      }
      console.warn('Food survey photo upload failed:', upErr?.message)
      if (process.env.NODE_ENV === 'production') {
        // Honest failure — never return a URL that would 404 later.
        return NextResponse.json({ ok: false, error: 'Photo storage is unavailable. Please try again later.' }, { status: 500 })
      }
    } catch (e) {
      console.warn('Food survey photo storage unavailable:', e?.message)
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ ok: false, error: 'Photo storage is unavailable. Please try again later.' }, { status: 500 })
      }
    }

    // Local filesystem fallback (development only), served from /uploads/…
    const rel = `food-survey/${new Date().toISOString().slice(0, 10)}/${filename}`
    const abs = join(process.cwd(), 'public', 'uploads', rel)
    await mkdir(abs, { recursive: true })
    await writeFile(abs, buffer)
    return NextResponse.json({ ok: true, url: `/uploads/${rel}?v=${Date.now()}` })
  } catch (e) {
    console.error('Food survey photo error:', e)
    return NextResponse.json({ ok: false, error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
