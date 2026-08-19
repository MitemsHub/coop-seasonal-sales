// Mint HS256 JWTs for the local PostgREST (mirrors how the app's env keys work).
import crypto from 'node:crypto'

const SECRET = 'local-coop-supabase-jwt-secret-2026-0123456789abcdef'

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function mint(role) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 }))
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

console.log(`SERVICE_KEY=${mint('service_role')}`)
console.log(`ANON_KEY=${mint('anon')}`)
