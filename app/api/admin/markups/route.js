// app/api/admin/markups/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { queryDirect } from '../../../../lib/directDb'
import { validateSession, validateBranchCode, validateSku, validateNumber } from '../../../../lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function resolveCycleId(supabase, cycleIdParam) {
  if (cycleIdParam != null && Number.isFinite(Number(cycleIdParam))) return Number(cycleIdParam)

  let { data: active, error: activeErr } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (activeErr) {
    const msg = String(activeErr?.message || '')
    if (!/is_active/i.test(msg)) throw activeErr
    active = null
  }
  if (active?.id) return active.id

  const { data: latest, error: latestErr } = await supabase.from('cycles').select('id').order('id', { ascending: false }).limit(1).maybeSingle()
  if (latestErr) throw latestErr
  if (!latest?.id) throw new Error('No cycle found')
  return latest.id
}

async function installRepricer() {
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error('Database repair requires SUPABASE_DB_URL (Supabase pooler connection string). Add it to your server env and redeploy, then retry.')
  }
  const sql = `
    BEGIN;
    CREATE OR REPLACE FUNCTION public.reprice_orders_for_branch_item(
      p_branch_id BIGINT,
      p_item_id   BIGINT
    )
    RETURNS JSON
    LANGUAGE plpgsql
    AS $$
    DECLARE
      updated_lines_count INTEGER := 0;
      has_cycle BOOLEAN := false;
      orders_has_cycle BOOLEAN := false;
      markups_has_cycle BOOLEAN := false;
      cycles_has_loan_rate BOOLEAN := false;
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'branch_item_prices' AND column_name = 'cycle_id'
      ) INTO has_cycle;

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cycle_id'
      ) INTO orders_has_cycle;

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'branch_item_markups' AND column_name = 'cycle_id'
      ) INTO markups_has_cycle;

      IF has_cycle AND orders_has_cycle THEN
        UPDATE public.order_lines AS ol
        SET
          unit_price = bip.price + COALESCE((
            SELECT bim.amount FROM public.branch_item_markups bim
            WHERE bim.branch_id = o.delivery_branch_id AND bim.item_id = ol.item_id AND bim.active = TRUE
              AND (NOT markups_has_cycle OR bim.cycle_id = o.cycle_id)
          ), 0),
          branch_item_price_id = bip.id,
          amount = (bip.price + COALESCE((
            SELECT bim.amount FROM public.branch_item_markups bim
            WHERE bim.branch_id = o.delivery_branch_id AND bim.item_id = ol.item_id AND bim.active = TRUE
              AND (NOT markups_has_cycle OR bim.cycle_id = o.cycle_id)
          ), 0)) * ol.qty
        FROM public.orders AS o
        JOIN public.branch_item_prices AS bip
          ON bip.branch_id = o.delivery_branch_id AND bip.cycle_id = o.cycle_id
        WHERE ol.order_id = o.order_id
          AND bip.item_id = ol.item_id
          AND o.delivery_branch_id = p_branch_id
          AND ol.item_id = p_item_id
          AND o.status::text IN ('Pending','Posted','Delivered');
      ELSE
        UPDATE public.order_lines AS ol
        SET
          unit_price = bip.price + COALESCE((
            SELECT bim.amount FROM public.branch_item_markups bim
            WHERE bim.branch_id = o.delivery_branch_id AND bim.item_id = ol.item_id AND bim.active = TRUE
          ), 0),
          branch_item_price_id = bip.id,
          amount = (bip.price + COALESCE((
            SELECT bim.amount FROM public.branch_item_markups bim
            WHERE bim.branch_id = o.delivery_branch_id AND bim.item_id = ol.item_id AND bim.active = TRUE
          ), 0)) * ol.qty
        FROM public.orders AS o
        JOIN public.branch_item_prices AS bip
          ON bip.branch_id = o.delivery_branch_id
        WHERE ol.order_id = o.order_id
          AND bip.item_id = ol.item_id
          AND o.delivery_branch_id = p_branch_id
          AND ol.item_id = p_item_id
          AND o.status::text IN ('Pending','Posted','Delivered');
      END IF;

      GET DIAGNOSTICS updated_lines_count = ROW_COUNT;

      IF orders_has_cycle THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cycles' AND column_name = 'food_loan_interest_rate_pct'
        ) INTO cycles_has_loan_rate;
      END IF;

      IF orders_has_cycle AND cycles_has_loan_rate THEN
        WITH s AS (
          SELECT ol.order_id, SUM(ol.amount) AS principal
          FROM public.order_lines AS ol
          GROUP BY ol.order_id
        )
        UPDATE public.orders AS o
        SET
          total_amount = COALESCE(s.principal, 0)
                       + CASE WHEN o.payment_option = 'Loan'
                              THEN ROUND(COALESCE(s.principal, 0) * (COALESCE(c.food_loan_interest_rate_pct, 0) / 100.0))
                              ELSE 0
                         END,
          updated_at = NOW()
        FROM s
        LEFT JOIN public.cycles AS c ON c.id = o.cycle_id
        WHERE o.delivery_branch_id = p_branch_id
          AND o.status::text IN ('Pending','Posted','Delivered')
          AND s.order_id = o.order_id
          AND EXISTS (
            SELECT 1 FROM public.order_lines AS ol2
            WHERE ol2.order_id = o.order_id AND ol2.item_id = p_item_id
          );
      ELSE
        WITH s AS (
          SELECT ol.order_id, SUM(ol.amount) AS principal
          FROM public.order_lines AS ol
          GROUP BY ol.order_id
        )
        UPDATE public.orders AS o
        SET
          total_amount = COALESCE(s.principal, 0)
                       + CASE WHEN o.payment_option = 'Loan'
                              THEN ROUND(COALESCE(s.principal, 0) * 0.13)
                              ELSE 0
                         END,
          updated_at = NOW()
        FROM s
        WHERE o.delivery_branch_id = p_branch_id
          AND o.status::text IN ('Pending','Posted','Delivered')
          AND s.order_id = o.order_id
          AND EXISTS (
            SELECT 1 FROM public.order_lines AS ol2
            WHERE ol2.order_id = o.order_id AND ol2.item_id = p_item_id
          );
      END IF;

      RETURN json_build_object('success', true, 'updated_lines', updated_lines_count);
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('success', false, 'error', SQLERRM);
    END;
    $$;

    ALTER FUNCTION public.reprice_orders_for_branch_item(BIGINT, BIGINT) SET search_path = public;

    CREATE OR REPLACE FUNCTION public.on_branch_item_markups_changed()
    RETURNS TRIGGER
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM public.reprice_orders_for_branch_item(NEW.branch_id, NEW.item_id);
      RETURN NEW;
    END;$$;

    DROP TRIGGER IF EXISTS trg_reprice_orders_on_bim_change ON public.branch_item_markups;
    CREATE TRIGGER trg_reprice_orders_on_bim_change
    AFTER INSERT OR UPDATE OF amount, active ON public.branch_item_markups
    FOR EACH ROW EXECUTE FUNCTION public.on_branch_item_markups_changed();

    CREATE OR REPLACE FUNCTION public.on_branch_item_prices_changed()
    RETURNS TRIGGER
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM public.reprice_orders_for_branch_item(NEW.branch_id, NEW.item_id);
      RETURN NEW;
    END;$$;

    DROP TRIGGER IF EXISTS trg_reprice_orders_on_bip_change ON public.branch_item_prices;
    CREATE TRIGGER trg_reprice_orders_on_bip_change
    AFTER INSERT OR UPDATE OF price ON public.branch_item_prices
    FOR EACH ROW EXECUTE FUNCTION public.on_branch_item_prices_changed();
    COMMIT;
  `
  await queryDirect(sql)
}

// List markups for a branch (optionally filter by sku)
export async function GET(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const branchCodeParam = searchParams.get('branch_code')
    const skuParam = searchParams.get('sku')
    const cycleIdParam = searchParams.get('cycle_id')
    const branchCodeRes = validateBranchCode(branchCodeParam)
    if (!branchCodeRes.isValid) return NextResponse.json({ ok: false, error: branchCodeRes.error }, { status: 400 })

    const supabase = createClient()
    const branchCode = branchCodeRes.sanitized

    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')
    let cycleId = null
    if (markupsHasCycle) {
      try {
        cycleId = await resolveCycleId(supabase, cycleIdParam)
      } catch (e) {
        return NextResponse.json({ ok: false, error: e?.message || 'Failed to resolve cycle' }, { status: 400 })
      }
    }

    const { data: branch, error: brErr } = await supabase
      .from('branches')
      .select('id, code, name')
      .eq('code', branchCode)
      .single()
    if (brErr || !branch) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

    // Join to items for convenience if available
    let query = supabase
      .from('branch_item_markups')
      .select(
        markupsHasCycle
          ? 'item_id, amount, active, cycle_id, items:item_id ( sku, name, unit, category )'
          : 'item_id, amount, active, items:item_id ( sku, name, unit, category )'
      )
      .eq('branch_id', branch.id)

    if (markupsHasCycle) query = query.eq('cycle_id', cycleId)

    if (skuParam) {
      const skuRes = validateSku(skuParam)
      if (!skuRes.isValid) return NextResponse.json({ ok: false, error: skuRes.error }, { status: 400 })
      // Filter client-side after fetch because PostgREST nested filter may not work depending on FK aliasing
      const { data, error } = await query
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      const sku = skuRes.sanitized
      const filtered = (data || []).filter(m => (m.items?.sku || '').toUpperCase() === sku.toUpperCase())
      return NextResponse.json({ ok: true, branch: { code: branch.code, name: branch.name }, markups: filtered })
    } else {
      const { data, error } = await query
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, branch: { code: branch.code, name: branch.name }, markups: data || [] })
    }
  } catch (error) {
    console.error('Markups GET error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

// Upsert a markup for a given branch_code + sku
export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const body = await request.json()
    const branchCodeRes = validateBranchCode(body.branch_code)
    const skuRes = validateSku(body.sku)
    const amountRes = validateNumber(body.amount ?? 500, { min: 0, max: 100000, integer: true })
    const cycleIdParam = body.cycle_id != null ? Number(body.cycle_id) : null
    const activeParam = typeof body.active === 'boolean' ? body.active : true

    if (!branchCodeRes.isValid) return NextResponse.json({ ok: false, error: branchCodeRes.error }, { status: 400 })
    if (!skuRes.isValid)        return NextResponse.json({ ok: false, error: skuRes.error }, { status: 400 })
    if (!amountRes.isValid)     return NextResponse.json({ ok: false, error: amountRes.error }, { status: 400 })
    if (cycleIdParam != null && !Number.isFinite(cycleIdParam)) {
      return NextResponse.json({ ok: false, error: 'Invalid cycle_id' }, { status: 400 })
    }

    const branchCode = branchCodeRes.sanitized
    const sku = skuRes.sanitized
    const amount = amountRes.value

    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')
    let cycleId = null
    if (markupsHasCycle) {
      try {
        cycleId = await resolveCycleId(supabase, cycleIdParam)
      } catch (e) {
        return NextResponse.json({ ok: false, error: e?.message || 'Failed to resolve cycle' }, { status: 400 })
      }
    }

    const { data: branch, error: brErr } = await supabase
      .from('branches')
      .select('id, code')
      .eq('code', branchCode)
      .single()
    if (brErr || !branch) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

    const { data: item, error: iErr } = await supabase
      .from('items')
      .select('item_id, sku')
      .eq('sku', sku)
      .single()
    if (iErr || !item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })

    const payload = { branch_id: branch.id, item_id: item.item_id, amount, active: activeParam }
    const onConflict = markupsHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id'
    if (markupsHasCycle) payload.cycle_id = cycleId

    let { error: upErr } = await supabase
      .from('branch_item_markups')
      .upsert(payload, { onConflict })

    // Self-heal if trigger calls missing repricer function due to BIGINT signature mismatch
    if (upErr && /reprice_orders_for_branch_item\(bigint,\s*bigint\) does not exist/i.test(upErr.message || '')) {
      try {
        await installRepricer()

        // Retry upsert after installing function/trigger
        const retry = await supabase
          .from('branch_item_markups')
          .upsert(payload, { onConflict })
        upErr = retry.error || null
      } catch (installErr) {
        return NextResponse.json({ ok: false, error: installErr?.message || 'Failed to install repricer function' }, { status: 500 })
      }
    }

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      message: markupsHasCycle ? `Markup set to ₦${amount} for ${sku} in ${branchCode} (cycle_id=${cycleId})` : `Markup set to ₦${amount} for ${sku} in ${branchCode}`
    })
  } catch (error) {
    console.error('Markups POST error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const body = await request.json()

    const branchCodeRes = validateBranchCode(body.branch_code)
    const skuRes = validateSku(body.sku)
    const priceRes = validateNumber(body.price, { min: 0, max: 100000000, integer: true })

    if (!branchCodeRes.isValid) return NextResponse.json({ ok: false, error: branchCodeRes.error }, { status: 400 })
    if (!skuRes.isValid)        return NextResponse.json({ ok: false, error: skuRes.error }, { status: 400 })
    if (!priceRes.isValid)      return NextResponse.json({ ok: false, error: priceRes.error }, { status: 400 })

    const cycleIdParam = body.cycle_id != null ? Number(body.cycle_id) : null
    if (cycleIdParam != null && !Number.isFinite(cycleIdParam)) {
      return NextResponse.json({ ok: false, error: 'Invalid cycle_id' }, { status: 400 })
    }

    const branchCode = branchCodeRes.sanitized
    const sku = skuRes.sanitized
    const price = priceRes.value

    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }
    const pricesHasCycle = await hasColumn('branch_item_prices', 'cycle_id')
    const cyclesOk = await hasColumn('cycles', 'id')

    let cycleId = cycleIdParam
    if (pricesHasCycle && cyclesOk && !cycleId) {
      const { data: active, error: activeErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('is_active', true)
        .maybeSingle()
      if (activeErr) return NextResponse.json({ ok: false, error: activeErr.message }, { status: 500 })
      cycleId = active?.id || null
      if (!cycleId) {
        // Closed season: default to the newest cycle that has orders.
        const { data: latestCycle } = await supabase
          .from('orders')
          .select('cycle_id')
          .not('cycle_id', 'is', null)
          .order('order_id', { ascending: false })
          .limit(1)
          .maybeSingle()
        cycleId = latestCycle?.cycle_id || null
      }
      if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    const { data: branch, error: brErr } = await supabase
      .from('branches')
      .select('id, code')
      .eq('code', branchCode)
      .single()
    if (brErr || !branch) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

    const { data: item, error: iErr } = await supabase
      .from('items')
      .select('item_id, sku')
      .eq('sku', sku)
      .single()
    if (iErr || !item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })

    const payload = { branch_id: branch.id, item_id: item.item_id, price }
    const onConflict = pricesHasCycle ? 'branch_id,item_id,cycle_id' : 'branch_id,item_id'
    if (pricesHasCycle) payload.cycle_id = cycleId

    let { error: upErr } = await supabase
      .from('branch_item_prices')
      .upsert(payload, { onConflict })

    if (upErr && /reprice_orders_for_branch_item\(bigint,\s*bigint\) does not exist/i.test(upErr.message || '')) {
      try {
        await installRepricer()
        const retry = await supabase
          .from('branch_item_prices')
          .upsert(payload, { onConflict })
        upErr = retry.error || null
      } catch (installErr) {
        return NextResponse.json({ ok: false, error: installErr?.message || 'Failed to install repricer function' }, { status: 500 })
      }
    }

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      message: pricesHasCycle ? `Price updated to ₦${price} for ${sku} in ${branchCode} (cycle_id=${cycleId})` : `Price updated to ₦${price} for ${sku} in ${branchCode}`
    })
  } catch (error) {
    console.error('Markups PATCH error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

// Remove a markup for branch_code + sku
export async function DELETE(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const body = await request.json()
    const branchCodeRes = validateBranchCode(body.branch_code)
    const skuRes = validateSku(body.sku)
    const cycleIdParam = body.cycle_id != null ? Number(body.cycle_id) : null

    if (!branchCodeRes.isValid) return NextResponse.json({ ok: false, error: branchCodeRes.error }, { status: 400 })
    if (!skuRes.isValid)        return NextResponse.json({ ok: false, error: skuRes.error }, { status: 400 })
    if (cycleIdParam != null && !Number.isFinite(cycleIdParam)) {
      return NextResponse.json({ ok: false, error: 'Invalid cycle_id' }, { status: 400 })
    }

    const branchCode = branchCodeRes.sanitized
    const sku = skuRes.sanitized

    const markupsHasCycle = await hasColumn(supabase, 'branch_item_markups', 'cycle_id')
    let cycleId = null
    if (markupsHasCycle) {
      try {
        cycleId = await resolveCycleId(supabase, cycleIdParam)
      } catch (e) {
        return NextResponse.json({ ok: false, error: e?.message || 'Failed to resolve cycle' }, { status: 400 })
      }
    }

    const { data: branch, error: brErr } = await supabase
      .from('branches')
      .select('id, code')
      .eq('code', branchCode)
      .single()
    if (brErr || !branch) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

    const { data: item, error: iErr } = await supabase
      .from('items')
      .select('item_id, sku')
      .eq('sku', sku)
      .single()
    if (iErr || !item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 })

    let delQuery = supabase
      .from('branch_item_markups')
      .delete()
      .eq('branch_id', branch.id)
      .eq('item_id', item.item_id)
    if (markupsHasCycle) delQuery = delQuery.eq('cycle_id', cycleId)
    const { error: delErr } = await delQuery

    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      message: markupsHasCycle ? `Markup removed for ${sku} in ${branchCode} (cycle_id=${cycleId})` : `Markup removed for ${sku} in ${branchCode}`
    })
  } catch (error) {
    console.error('Markups DELETE error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
