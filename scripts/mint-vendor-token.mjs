// Mint a vendor_token for local preview testing (matches lib/signingEdge.js).
import crypto from 'node:crypto'
import { config } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const secret = process.env.APP_SECRET || 'dev-secret-change-me'
const payload = {
  role: 'vendor',
  vendor_id: Number(process.argv[2] || 1),
  vendor_code: String(process.argv[3] || 'VND-001').toUpperCase(),
  cycle_id: Number(process.argv[4] || 1),
  branch_id: Number(process.argv[5] || 1),
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
