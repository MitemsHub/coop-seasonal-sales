#!/usr/bin/env node
// scripts/recover-vendor-passcodes.mjs
//
// Passcodes issued before the encrypted copy existed (86c05fe) are stored only
// as a salted scrypt hash, which cannot be reversed. The uniqueness fingerprint
// in `passcode_lookup` is a keyed HMAC of the same passcode, so with
// APP_SECRET it can be searched: vendor passcodes are 6 characters from a
// 32-character alphabet, an exhaustive sweep of 32^6 = 1,073,741,824.
//
// This recovers those passcodes offline, verifies each hit against the scrypt
// hash it belongs to, and (with --apply) writes the sealed copy back so the
// admin "View login" sheet can show the passcode from then on.
//
// Nothing is written unless you pass --apply.
//
//   node scripts/recover-vendor-passcodes.mjs                 # report only
//   node scripts/recover-vendor-passcodes.mjs --out=passcodes.csv
//   node scripts/recover-vendor-passcodes.mjs --apply         # backfill copies
//
// Options: --workers=N  --from=N --to=N (bounded sweep, for a smoke run)
//          --self-test   (in-memory check of the sweep, no database)
//
// Needs SUPABASE_DB_URL and APP_SECRET (from .env.local by default).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createHmac } from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

// Kept in step with lib/vendorCredentials.js — the sweep must cover exactly the
// space the generator can produce, or it silently misses real passcodes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LENGTH = 6
const SPACE = ALPHABET.length ** LENGTH
const PREFIX = 'vendor-passcode:v1:'

function candidateAt(index) {
  let x = index
  let out = ''
  for (let d = 0; d < LENGTH; d += 1) {
    out += ALPHABET[x & 31]
    x >>>= 5
  }
  return out
}

if (!isMainThread) {
  const { secret, targets, from, to } = workerData
  // A string key is ~10x faster here than the same bytes as a Buffer, which
  // matters across a billion candidates.
  const key = secret
  const prefix = Buffer.from(PREFIX)
  const wanted = new Map(targets)
  const started = Date.now()
  // Writing the candidate as 6 raw bytes into one reused buffer is the fastest
  // shape measured here: HMAC dominates, so avoid per-candidate allocation.
  const candidate = Buffer.alloc(LENGTH)
  let checked = 0

  for (let index = from; index < to; index += 1) {
    // Same digit order as candidateAt(), so the bytes hashed and the passcode
    // reported for a hit are the same string.
    let x = index
    for (let d = 0; d < LENGTH; d += 1) {
      candidate[d] = ALPHABET.charCodeAt(x & 31)
      x >>>= 5
    }
    const digest = createHmac('sha256', key).update(prefix).update(candidate).digest('hex')
    checked += 1
    const code = wanted.get(digest)
    if (code) {
      parentPort.postMessage({ type: 'hit', code, passcode: candidateAt(index) })
    }
    if ((checked & 0xffff) === 0) {
      parentPort.postMessage({ type: 'progress', checked })
    }
  }
  parentPort.postMessage({ type: 'done', checked })
  // A worker only ever sweeps; it must not fall through into the main script.
  process.exit(0)
}

const here = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(here, '../.env.local') })

const { queryDirect } = await import('../lib/directDb.js')
const { verifyPasscode } = await import('../lib/passcodeHash.js')
const { encryptPasscode } = await import('../lib/passcodeVault.js')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

// Same key precedence as passcodeLookup(): a dedicated lookup secret wins,
// otherwise APP_SECRET. Searching with the wrong key finds nothing at all.
const secret = String(process.env.PASSCODE_LOOKUP_SECRET || process.env.APP_SECRET || '')
if (!secret) {
  console.error('APP_SECRET (or PASSCODE_LOOKUP_SECRET) is not set — without it the fingerprints cannot be searched.')
  process.exit(1)
}
console.log(`Search key: ${process.env.PASSCODE_LOOKUP_SECRET ? 'PASSCODE_LOOKUP_SECRET' : 'APP_SECRET'}`)

function planWorkers(from, to, requested) {
  const workers = Math.max(1, Number(requested) || Math.min(8, os.availableParallelism?.() || os.cpus().length))
  const span = to - from
  const per = Math.floor(span / workers)
  const slices = []
  for (let i = 0; i < workers; i += 1) {
    const start = from + per * i
    const end = i === workers - 1 ? to : start + per
    if (end > start) slices.push([start, end])
  }
  return slices
}

// A tiny in-memory sweep: proves the alphabet indexing, the HMAC prefix and the
// hit matching all agree with passcodeLookup() before spending minutes on it.
if (flag('self-test')) {
  const passcode = candidateAt(12345)
  const lookup = createHmac('sha256', secret).update(`${PREFIX}${passcode}`).digest('hex')
  let recovered = null
  const worker = new Worker(new URL(import.meta.url), {
    workerData: {
      secret,
      alphabet: ALPHABET,
      targets: [[lookup, 'SELF']],
      from: 12000,
      to: 13000,
    },
  })
  await new Promise((resolve, reject) => {
    worker.on('message', (msg) => {
      if (msg.type === 'hit') recovered = msg.passcode
      if (msg.type === 'done') resolve()
    })
    worker.on('error', reject)
    worker.on('exit', resolve)
  })
  if (recovered !== passcode) {
    console.error(`Self-test failed: expected ${passcode}, got ${recovered}`)
    process.exit(1)
  }
  console.log(`Self-test passed — recovered ${recovered} from its fingerprint.`)
  process.exit(0)
}

const from = Number(value('from') || 0)
const to = Math.min(SPACE, Number(value('to') || SPACE))
const apply = flag('apply')
const outPath = value('out')

const { rows } = await queryDirect(
  `select id, code, name, passcode, passcode_lookup, passcode_encrypted
     from exhibition_vendors
    order by code`
)

const readable = rows.filter((r) => r.passcode_encrypted)
const plaintext = rows.filter((r) => !r.passcode_encrypted && !String(r.passcode || '').startsWith('scrypt$'))
const searchable = rows.filter(
  (r) => !r.passcode_encrypted && String(r.passcode || '').startsWith('scrypt$') && r.passcode_lookup
)
const hopeless = rows.filter(
  (r) => !r.passcode_encrypted && String(r.passcode || '').startsWith('scrypt$') && !r.passcode_lookup
)

console.log(`Vendors: ${rows.length} · already readable: ${readable.length} · legacy plaintext: ${plaintext.length}`)
console.log(`Searchable from their fingerprint: ${searchable.length} · no fingerprint (unrecoverable): ${hopeless.length}`)
for (const row of hopeless) console.log(`  ! ${row.code} ${row.name} — no passcode_lookup, cannot be recovered`)

const recovered = new Map()
for (const row of plaintext) recovered.set(row.code, row.passcode)

if (searchable.length) {
  const targets = searchable.map((row) => [row.passcode_lookup, row.code])
  const slices = planWorkers(from, to, value('workers'))
  console.log(`Sweeping ${(to - from).toLocaleString()} candidates across ${slices.length} worker(s)…`)
  const total = to - from
  // Each worker reports its own running total; the sum is the sweep's progress.
  const perWorker = new Array(slices.length).fill(0)
  const checkedTotal = () => perWorker.reduce((sum, n) => sum + n, 0)
  let finishedSlices = 0
  const started = Date.now()

  const timer = setInterval(() => {
    const elapsed = (Date.now() - started) / 1000
    const checked = checkedTotal()
    const done = Math.min(total, checked)
    const rate = checked / Math.max(1, elapsed)
    const remaining = Math.max(0, total - done)
    const eta = rate > 0 ? (remaining / rate / 60).toFixed(1) : '?'
    console.log(
      `  ${((done / total) * 100).toFixed(1)}% · ${Math.round(rate / 1000)}k/s · found ${recovered.size}/${searchable.length} · ~${eta} min left`
    )
  }, 15000)

  const verify = async (msg) => {
    const row = searchable.find((r) => r.code === msg.code)
    if (!row) return
    const check = await verifyPasscode(msg.passcode, String(row.passcode))
    if (!check.ok) {
      console.warn(`  ? ${msg.code}: fingerprint matched ${msg.passcode} but the hash rejected it (secret changed since issue?)`)
      return
    }
    recovered.set(row.code, msg.passcode)
    console.log(`  ✓ ${row.code} ${row.name} → ${msg.passcode}`)
    if (recovered.size === searchable.length) stopAll()
  }

  const workers = []
  let stopped = false
  const stopAll = () => {
    if (stopped) return
    stopped = true
    for (const w of workers) w.terminate()
  }

  await new Promise((resolve) => {
    slices.forEach(([sliceFrom, sliceTo], index) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { secret, alphabet: ALPHABET, targets, from: sliceFrom, to: sliceTo },
      })
      workers.push(worker)
      worker.on('message', (msg) => {
        if (msg.type === 'hit') verify(msg).catch((e) => console.warn(`  ! verify failed: ${e.message}`))
        if (msg.type === 'progress' || msg.type === 'done') perWorker[index] = Math.max(perWorker[index], msg.checked)
        if (msg.type === 'done') {
          finishedSlices += 1
          if (finishedSlices === slices.length) stopAll()
        }
      })
      worker.on('error', (e) => console.warn(`  ! worker error: ${e.message}`))
    })
    const poll = setInterval(() => {
      if (stopped || finishedSlices === slices.length) {
        clearInterval(poll)
        resolve()
      }
    }, 250)
  })

  clearInterval(timer)
  await new Promise((r) => setTimeout(r, 250))
  const minutes = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`Sweep finished in ${minutes} min — recovered ${recovered.size - plaintext.length} of ${searchable.length} hashed passcodes.`)
}

const ordered = rows.filter((r) => recovered.has(r.code))
if (ordered.length) {
  console.log('\nRecovered passcodes:')
  for (const row of ordered) console.log(`  ${row.code}  ${recovered.get(row.code)}  ${row.name}`)
}

if (outPath) {
  const lines = ['vendor_code,passcode,name', ...ordered.map((r) => `"${r.code}","${recovered.get(r.code)}","${String(r.name || '').replace(/"/g, '""')}"`)]
  fs.writeFileSync(path.resolve(outPath), `${lines.join('\n')}\n`, { mode: 0o600 })
  console.log(`\nWrote ${ordered.length} passcode(s) to ${outPath} (keep it private and delete it after use).`)
}

if (apply) {
  let written = 0
  for (const row of ordered) {
    const sealed = encryptPasscode(recovered.get(row.code), secret)
    await queryDirect(
      'update exhibition_vendors set passcode_encrypted = $1 where id = $2 and passcode_encrypted is null',
      [sealed, row.id]
    )
    written += 1
  }
  console.log(`\nBackfilled the encrypted copy for ${written} vendor(s) — the View login sheet can show these now.`)
} else if (ordered.length) {
  console.log('\nNothing was written. Re-run with --apply to backfill the encrypted copies.')
}
