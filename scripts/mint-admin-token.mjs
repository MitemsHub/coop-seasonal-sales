// Mint an admin_token for local preview testing (matches lib/signing.js).
import crypto from 'node:crypto'
import { config } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const secret = process.env.APP_SECRET || 'dev-secret-change-me'
const payload = {
  role: 'admin',
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
}
const body = JSON.stringify(payload)
const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
const token = Buffer.from(JSON.stringify({ b: payload, s: sig }))
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '')

console.log(token)
