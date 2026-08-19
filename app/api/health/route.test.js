// app/api/health/route.test.js
// Unit tests for the public health check endpoint.
// Mocks the Supabase server client so tests run without a real database.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the Supabase server client before importing the route
vi.mock('@/lib/supabaseServer', () => ({
  createClient: vi.fn(),
}))

import { GET } from './route'
import { createClient } from '@/lib/supabaseServer'

function mockSupabase({ error = null } = {}) {
  createClient.mockReturnValue({
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ error }),
      }),
    }),
  })
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with healthy status when DB is reachable', async () => {
    mockSupabase({ error: null })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.db).toBe('ok')
    expect(body.timestamp).toBeDefined()
    expect(typeof body.latencyMs).toBe('number')
  })

  it('returns 503 with unhealthy status when Supabase query fails', async () => {
    mockSupabase({ error: { message: 'connection refused' } })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.db).toBe('connection refused')
  })

  it('returns 503 when createClient throws', async () => {
    createClient.mockImplementation(() => {
      throw new Error('env missing')
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.db).toBe('env missing')
  })
})
