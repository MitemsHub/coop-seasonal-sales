// app/api/exhibition/suggest-shelf/route.js
// Photo-based shelf suggestion for the vendor and admin product forms. It is a
// suggestion only: the forms pre-select it, and the person saving the listing
// confirms or changes it. Nothing here is used by the shop's classification.
//
// Auth: a signed-in vendor or an admin session. Both forms use this route.
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { getVendorContext } from '../../vendor/_session'
import { suggestShelfFromPhoto } from '@/lib/exhibitionPhotoShelf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const session = await validateSession(req, 'admin')
  const isAdmin = !!session?.valid
  if (!isAdmin) {
    const vendor = await getVendorContext(req)
    if (!vendor) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const name = String(body?.name || '').slice(0, 200)
  const imageUrl = String(body?.imageUrl || '')
  // Only our own storage or https is worth sending to a model; anything else is
  // a local path or a data URL the vendor form does not use.
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
    return NextResponse.json({ ok: true, suggestion: null, reason: 'unsupported-image' })
  }

  try {
    const suggestion = await suggestShelfFromPhoto({
      name,
      imageUrl,
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
    })
    return NextResponse.json({
      ok: true,
      suggestion,
      // Tells the form why nothing came back, without exposing any key.
      reason: suggestion ? undefined : process.env.OPENAI_API_KEY ? 'no-match' : 'no-key',
    })
  } catch {
    return NextResponse.json({ ok: true, suggestion: null, reason: 'error' })
  }
}
