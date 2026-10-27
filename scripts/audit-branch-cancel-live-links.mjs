// READ-ONLY audit: the cancelled-and-resubmitted pattern — a branch+cycle
// where a product has BOTH a cancelled survey entry AND a live one linking
// it. Before the live-link fix, any cancelled link hid the product from
// that branch's shop preview / member shop even though the rep's
// resubmission still sold it (the Lagos Kings Oil 5L case). This prints
// every occurrence so the admin can see which branches were affected and
// are now fixed, plus a count of products still intentionally hidden
// (every link cancelled — no live resubmission stands behind them).
//
//   node scripts/audit-branch-cancel-live-links.mjs
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const act = await c.query(`SELECT id, code FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
const activeId = act.rows[0]?.id ?? null
console.log('active cycle:', activeId, act.rows[0]?.code || '')

// 1. Branch+cycle+item groups with BOTH cancelled and live links —
//    hidden by the old rule, visible with the fix.
const findings = await c.query(
  `SELECT b.id AS branch_id, b.name AS branch, s.cycle_id,
          i.item_id, i.name AS item, i.source,
          COUNT(*) FILTER (WHERE e.cancelled)     AS cancelled_links,
          COUNT(*) FILTER (WHERE NOT e.cancelled) AS live_links,
          EXISTS (
            SELECT 1 FROM branch_item_prices p
            WHERE p.branch_id = b.id AND p.item_id = i.item_id AND p.price > 0
              AND (s.cycle_id IS NULL OR p.cycle_id IS NULL OR p.cycle_id = s.cycle_id)
          ) AS priced_here
     FROM food_survey_entries e
     JOIN food_survey_submissions s ON s.id = e.submission_id
     JOIN branches b ON b.id = s.branch_id
     JOIN items i ON i.item_id = e.saved_item_id
    WHERE e.saved_item_id IS NOT NULL
    GROUP BY b.id, b.name, s.cycle_id, i.item_id, i.name, i.source
   HAVING COUNT(*) FILTER (WHERE e.cancelled) > 0
      AND COUNT(*) FILTER (WHERE NOT e.cancelled) > 0
    ORDER BY b.name, s.cycle_id DESC NULLS LAST, i.name`
)
console.log(`\n== cancelled + LIVE links to the same product (was wrongly hidden, now visible) ==`)
if (!findings.rows.length) console.log('   (none)')
else console.table(findings.rows.map((r) => ({
  ...r,
  cycle: r.cycle_id ?? 'legacy(null)',
  in_active_cycle: r.cycle_id === activeId || r.cycle_id == null ? 'yes' : 'no',
  was_actually_missing: r.priced_here ? 'YES — priced, was off the shelf' : 'no price row here',
})))

// 2. Context: products still hidden on purpose (ALL links cancelled).
const stillHidden = await c.query(
  `SELECT b.name AS branch, COUNT(*) AS products_still_hidden
     FROM (
       SELECT s.branch_id, e.saved_item_id,
              COUNT(*) FILTER (WHERE e.cancelled)     AS n_cancelled,
              COUNT(*) FILTER (WHERE NOT e.cancelled) AS n_live
         FROM food_survey_entries e
         JOIN food_survey_submissions s ON s.id = e.submission_id
        WHERE e.saved_item_id IS NOT NULL
        GROUP BY s.branch_id, s.cycle_id, e.saved_item_id
     ) g
     JOIN branches b ON b.id = g.branch_id
    WHERE g.n_cancelled > 0 AND g.n_live = 0
    GROUP BY b.name ORDER BY products_still_hidden DESC, b.name`
)
console.log('\n== products still intentionally hidden (every link cancelled) — per branch ==')
console.table(stillHidden.rows)

await c.end()
console.log('\nDONE (read-only)')
