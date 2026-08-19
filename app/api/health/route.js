// app/api/health/route.js
// Public health check endpoint for load balancers and uptime monitors.
// Verifies database connectivity with a minimal read and returns a
// standardised status payload.  No authentication required.

import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const start = Date.now()
  const result = { status: 'healthy', db: 'ok', timestamp: new Date().toISOString() }

  try {
    const supabase = createClient()

    // Lightweight read — just verify the connection works
    const { error } = await supabase.from('members').select('member_id').limit(1)

    if (error) {
      result.status = 'unhealthy'
      result.db = error.message || 'unreachable'
      return Response.json(result, { status: 503 })
    }

    result.latencyMs = Date.now() - start
    return Response.json(result, { status: 200 })
  } catch (e) {
    result.status = 'unhealthy'
    result.db = e.message || 'unreachable'
    return Response.json(result, { status: 503 })
  }
}
