// lib/directDb.test.js
// Unit tests for isLocalPostgresUrl — decides whether the direct Postgres
// connection needs SSL. Local stacks (docker / localhost / private net) have no
// TLS; remote Supabase poolers require it. An explicit ?sslmode= in the URL
// always wins.
import { describe, it, expect } from 'vitest'
import { isLocalPostgresUrl } from './directDb'

describe('isLocalPostgresUrl', () => {
  it('treats loopback hosts as local (no SSL)', () => {
    expect(isLocalPostgresUrl('postgres://postgres:postgres@127.0.0.1:54322/postgres')).toBe(true)
    expect(isLocalPostgresUrl('postgresql://postgres:pw@localhost:5432/postgres')).toBe(true)
    expect(isLocalPostgresUrl('postgres://postgres:pw@[::1]:5432/postgres')).toBe(true)
  })

  it('treats docker/private-network hosts as local', () => {
    expect(isLocalPostgresUrl('postgres://postgres:pw@coop-pg:5432/postgres')).toBe(true)
    expect(isLocalPostgresUrl('postgres://postgres:pw@172.17.0.2:5432/postgres')).toBe(true)
    expect(isLocalPostgresUrl('postgres://postgres:pw@10.0.0.5:5432/postgres')).toBe(true)
    expect(isLocalPostgresUrl('postgres://postgres:pw@192.168.1.10:5432/postgres')).toBe(true)
  })

  it('treats remote Supabase hosts as SSL', () => {
    expect(isLocalPostgresUrl('postgres://postgres:pw@db.xyz.supabase.co:6543/postgres')).toBe(false)
    expect(isLocalPostgresUrl('postgres://postgres:pw@aws-0-us-east.pooler.supabase.com:5432/postgres')).toBe(false)
  })

  it('lets an explicit sslmode override the host heuristic', () => {
    expect(isLocalPostgresUrl('postgres://postgres:pw@127.0.0.1:54322/postgres?sslmode=require')).toBe(false)
    expect(isLocalPostgresUrl('postgres://postgres:pw@db.xyz.supabase.co:6543/postgres?sslmode=disable')).toBe(true)
  })

  it('returns false for empty/invalid URLs', () => {
    expect(isLocalPostgresUrl('')).toBe(false)
    expect(isLocalPostgresUrl(undefined)).toBe(false)
  })
})
