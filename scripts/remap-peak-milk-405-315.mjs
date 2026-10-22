import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Merge the Peak Milk twin: item #405 (Peak Milk Full Cream 14g,
// SKU PEAKMILKFULLCREAM14G-2 — the auto-suffixed rename twin the admin kept
// seeing) onto the canonical item #315 (Peak Milk Full Cream 14g,
// SKU PEAKMILKFULLCREAM14G, which owns the real bank image).
// Moves every branch price row, markup row, survey link and order line,
// then purges #405. Pattern identical to remap-knorr-299-326.mjs —
// dry-run unless GO is passed; invariants must hold before COMMIT.
const p = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: 1 })
const DRY = process.argv[2] !== 'GO'
try {
  await p.query('BEGIN')
  const beforeT = await p.query('SELECT count(*)::int c, coalesce(sum(total_amount),0)::float s FROM orders')
  const beforeL = await p.query('SELECT count(*)::int c, coalesce(sum(amount),0)::float s FROM order_lines')
  const remap = [{ from: 405, to: 315 }]
  for (const m of remap) {
    const rps = await p.query('SELECT id,branch_id,cycle_id,price FROM branch_item_prices WHERE item_id=$1', [m.from])
    for (const rp of rps.rows) {
      const tp = await p.query('SELECT id,price FROM branch_item_prices WHERE item_id=$1 AND branch_id=$2 AND cycle_id=$3', [m.to, rp.branch_id, rp.cycle_id])
      let target
      if (tp.rowCount === 0) {
        target = (await p.query('INSERT INTO branch_item_prices(item_id,branch_id,cycle_id,price) VALUES($1,$2,$3,$4) RETURNING id', [m.to, rp.branch_id, rp.cycle_id, rp.price])).rows[0].id
      } else target = tp.rows[0].id
      const upd = await p.query('UPDATE order_lines SET item_id=$1, branch_item_price_id=$2 WHERE item_id=$3 AND branch_item_price_id=$4 RETURNING id', [m.to, target, m.from, rp.id])
      console.log('moved', upd.rowCount, 'lines (price', rp.id, '@branch', rp.branch_id, 'cycle', rp.cycle_id, '-> target price', target, ')')
      await p.query('DELETE FROM branch_item_prices WHERE id=$1', [rp.id])
    }
    await p.query('UPDATE branch_item_markups SET item_id=$1 WHERE item_id=$2', [m.to, m.from])
    const se = await p.query('UPDATE food_survey_entries SET saved_item_id=$1 WHERE saved_item_id=$2 RETURNING id', [m.to, m.from])
    console.log('remapped survey links:', se.rowCount, '→', se.rows.map(r => r.id))
    const di = await p.query('DELETE FROM items WHERE item_id=$1 RETURNING item_id,sku,name', [m.from])
    console.log('purged:', JSON.stringify(di.rows))
  }
  const afterT = await p.query('SELECT count(*)::int c, coalesce(sum(total_amount),0)::float s FROM orders')
  const afterL = await p.query('SELECT count(*)::int c, coalesce(sum(amount),0)::float s FROM order_lines')
  const orphI = await p.query('SELECT count(*)::int c FROM order_lines ol LEFT JOIN items i ON i.item_id=ol.item_id WHERE i.item_id IS NULL')
  const orphP = await p.query('SELECT count(*)::int c FROM order_lines ol LEFT JOIN branch_item_prices bp ON bp.id=ol.branch_item_price_id WHERE bp.id IS NULL')
  const orphF = await p.query('SELECT count(*)::int c FROM food_survey_entries fe WHERE fe.saved_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = fe.saved_item_id)')
  const twinLeft = await p.query("SELECT count(*)::int c FROM items WHERE sku='PEAKMILKFULLCREAM14G-2'")
  console.log('BEFORE orders', beforeT.rows[0], 'lines', beforeL.rows[0])
  console.log('AFTER  orders', afterT.rows[0], 'lines', afterL.rows[0], 'orphans item', orphI.rows[0].c, 'price', orphP.rows[0].c, 'survey', orphF.rows[0].c, 'twin leftover', twinLeft.rows[0].c)
  const same = beforeT.rows[0].c === afterT.rows[0].c && Math.abs(beforeT.rows[0].s - afterT.rows[0].s) < 0.001
    && beforeL.rows[0].c === afterL.rows[0].c && Math.abs(beforeL.rows[0].s - afterL.rows[0].s) < 0.001 && orphI.rows[0].c === 0 && orphP.rows[0].c === 0 && orphF.rows[0].c === 0 && twinLeft.rows[0].c === 0
  console.log(same ? 'INVARIANTS HOLD' : 'INVARIANT MISMATCH')
  if (DRY) { await p.query('ROLLBACK'); console.log('DRY RUN — rolled back') }
  else if (same) { await p.query('COMMIT'); console.log('COMMITTED') }
  else { await p.query('ROLLBACK'); process.exitCode = 2 }
} catch (e) { console.log('ERROR', e.message); await p.query('ROLLBACK').catch(() => {}); process.exitCode = 1 }
finally { await p.end() }
