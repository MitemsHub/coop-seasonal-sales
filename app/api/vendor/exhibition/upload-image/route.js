import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { createClient } from '@/lib/supabaseServer'
import { verify } from '@/lib/signingEdge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The client already resizes/crops to a square WebP before uploading, so the
// route mainly validates and stores it. Keeps storage tiny and renders uniform.
export async function POST(request) {
  try {
    const token = request.cookies.get('vendor_token')?.value
    const claim = token ? await verify(token) : null
    if (!claim || claim.role !== 'vendor' || !claim.vendor_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('image')
    const sku = String(formData.get('sku') || '').trim()

    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    if (!sku) {
      return NextResponse.json({ error: 'SKU is required' }, { status: 400 })
    }

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only JPG, PNG and WebP are allowed.' }, { status: 400 })
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 2MB after optimization).' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const safeSku = sku.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'image'

    try {
      const supabase = createClient()
      const bucket = process.env.EXHIBITION_IMAGES_BUCKET || 'exhibition-images'
      const path = `vendors/${claim.vendor_id}/${safeSku}.webp`

      const { data: bucketInfo, error: bucketInfoErr } = await supabase.storage.getBucket(bucket)
      if (bucketInfoErr || !bucketInfo) {
        await supabase.storage.createBucket(bucket, { public: true })
      }

      const { error: upErr } = await supabase.storage.from(bucket).upload(path, bytes, {
        contentType: 'image/webp',
        upsert: true,
      })
      if (!upErr) {
        const { data: pub } = await supabase.storage.from(bucket).getPublicUrl(path)
        const publicUrl = pub?.publicUrl || ''
        if (publicUrl) {
          return NextResponse.json({ success: true, imageUrl: `${publicUrl}?v=${Date.now()}` })
        }
      }
      console.warn('Supabase Storage upload failed or no public URL:', upErr?.message)
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Image storage is unavailable. Check Supabase bucket settings.' }, { status: 500 })
      }
    } catch (e) {
      console.warn('Supabase Storage not available:', e?.message)
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Image storage is unavailable.' }, { status: 500 })
      }
    }

    // Local filesystem fallback (development only)
    const uploadDir = join(process.cwd(), 'public', 'images', 'exhibition', String(claim.vendor_id))
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
    const filepath = join(uploadDir, `${safeSku}.webp`)
    await writeFile(filepath, bytes)
    return NextResponse.json({ success: true, imageUrl: `/images/exhibition/${claim.vendor_id}/${safeSku}.webp?v=${Date.now()}` })
  } catch (error) {
    console.error('Exhibition image upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
