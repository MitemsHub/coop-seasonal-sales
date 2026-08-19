// lib/signing.js
import crypto from 'crypto'

function encode(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
}

function getSecret() {
  const secret = process.env.APP_SECRET
  if (!secret) throw new Error('APP_SECRET environment variable is not set')
  return secret
}

export function sign(payload, expiresInSec = 60 * 60) {
  const secret = getSecret()
  const exp = Math.floor(Date.now() / 1000) + expiresInSec
  const body = { ...payload, exp }
  const data = encode(body)
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
  return Buffer.from(JSON.stringify({ b: body, s: sig }), 'utf8').toString('base64url')
}

export function verify(token) {
  try {
    const secret = getSecret()
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    const data = encode(parsed.b)
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
    if (sig !== parsed.s) return null
    if (parsed.b.exp && parsed.b.exp < Math.floor(Date.now() / 1000)) return null
    return parsed.b
  } catch {
    return null
  }
}