import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Restore Ibadan's real product: Peak Milk Full Cream 12g.
// The earlier 12g→14g rename (admin, Makurdi card) put Ibadan's price row and
// survey draft onto the shared 14g item (#315), and the twin-purge merge
// (remap-peak-milk-405-315.mjs) consolidated that — Ibadan was left selling
// "Peak Milk Full Cream 14g". This script:
//   1. creates the "Peak Milk Full Cream 12g" catalog row (SKU is free);
//   2. moves Ibadan's cycle price row (₦34,000, cycle 3) onto it;
//   3. re-points Ibadan's survey draft (entry #1110) to the new item.
// Item #315 keeps every other branch untouched.
// Dry-run unless GO is passed; invariants must hold before COMMIT.
const p = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: 1 })
const DRY = process.argv[2] !== 'GO'
const ENTRY_ID = 1110
const ITEM_ID_PLAIN = 315
try {
  await p.query('BEGIN')

  const guard = await p.query(
    "SELECT item_id FROM items WHERE sku='PEAKMILKFULLCREAM12G' OR name='Peak Milk Full Cream 12g'"
  )
  if (guard.rowCount) throw new Error('A Peak Milk Full Cream 12g item already exists: ' + JSON.stringify(guard.rows))

  const entry = await p.query(
    'SELECT e.id, e.item_name, e.price, e.saved_item_id, s.branch_id FROM food_survey_entries e LEFT JOIN food_survey_submissions s ON s.id = e.submission_id WHERE e.id = $1',
    [ENTRY_ID]
  )
  if (entry.rowCount !== 1) throw new Error('Survey entry not found')
  const ent = entry.rows[0]
  if (Number(ent.saved_item_id) !== ITEM_ID_PLAIN) throw new Error('Entry ' + ENTRY_ID + ' no longer links to item ' + ITEM_ID_PLAIN + ' — refusing to run blindly')
  console.log('entry now:', JSON.stringify(ent))

  const price = await p.query(
    'SELECT id, branch_id, cycle_id, price FROM branch_item_prices WHERE item_id = $1 AND branch_id = $2',
    [ITEM_ID_PLAIN, ent.branch_id]
  )
  if (price.rowCount !== 1) throw new Error('Expected exactly one price row for item ' + ITEM_ID_PLAIN + ' at branch ' + ent.branch_id)
  const pr = price.rows[0]
  if (Math.abs(Number(pr.price) - Number(ent.price)) > 0.001) throw new Error('Price/entry mismatch — refusing to run blindly')
  console.log('price row:', JSON.stringify(pr))

  const beforeT = await p.query('SELECT count(*)::int c, coalesce(sum(total_amount),0)::float s FROM orders')
  const beforeL = await p.query('SELECT count(*)::int c, coalesce(sum(amount),0)::float s FROM order_lines')

  const ins = await p.query(
    "INSERT INTO items(sku, name, category, unit, is_active, source) VALUES('PEAKMILKFULLCREAM12G','Peak Milk Full Cream 12g','Dairy','Carton', TRUE, (SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='source') THEN 'outsourced'::varchar ELSE NULL END)) RETURNING item_id, sku, name"
  )
  if (!ins.rowCount) throw new Error('items insert failed')
  const itemId = ins.rows[0].item_id
  console.log('new item:', JSON.stringify(ins.rows[0]))

  await p.query('UPDATE branch_item_prices SET item_id = $1 WHERE id = $2', [itemId, pr.id])
  console.log('moved price', pr.id, 'to item', itemId)

  await p.query('UPDATE food_survey_entries SET saved_item_id = $1 WHERE id = $2', [itemId, ENTRY_ID])
  console.log('re-linked survey entry', ENTRY_ID)

  const afterT = await p.query('SELECT count(*)::int c, coalesce(sum(total_amount),0)::float s FROM orders')
  const afterL = await p.query('SELECT count(*)::int c, coalesce(sum(amount),0)::float s FROM order_lines')
  const orphF = await p.query('SELECT count(*)::int c FROM food_survey_entries fe WHERE fe.saved_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = fe.saved_item_id)')
  const orphP = await p.query('SELECT count(*)::int c FROM order_lines ol LEFT JOIN branch_item_prices bp ON bp.id=ol.branch_item_price_id WHERE bp.id IS NULL')
  const checkI = await p.query('SELECT count(*)::int c FROM branch_item_prices WHERE item_id=$1', [itemId])
  console.log('BEFORE orders', beforeT.rows[0], 'lines', beforeL.rows[0])
  console.log('AFTER  orders', afterT.rows[0], 'lines', afterL.rows[0], 'survey orphans', orphF.rows[0].c, 'price orphans', orphP.rows[0].c, 'new item price rows', checkI.rows[0].c)
  const same = beforeT.rows[0].c === afterT.rows[0].c && Math.abs(beforeT.rows[0].s - afterT.rows[0].s) < 0.001
    && beforeL.rows[0].c === afterL.rows[0].c && Math.abs(beforeL.rows[0].s - afterL.rows[0].s) < 0.001
    && orphF.rows[0].c === 0 && orphP.rows[0].c === 0 && checkI.rows[0].c === 1
  console.log(same ? 'INVARIANTS HOLD' : 'INVARIANT MISMATCH')
  if (DRY) { await p.query('ROLLBACK'); console.log('DRY RUN — rolled back') }
  else if (same) { await p.query('COMMIT'); console.log('COMMITTED — item', itemId) }
  else { await p.query('ROLLBACK'); process.exitCode = 2 }
} catch (e) { console.log('ERROR', e.message); await p.query('ROLLBACK').catch(() => {}); process.exitCode = 1 }
finally { await p.end() }
