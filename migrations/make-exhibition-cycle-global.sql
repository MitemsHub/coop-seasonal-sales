-- migrations/make-exhibition-cycle-global.sql
-- The exhibition season becomes org-wide, matching Food (cycles) and RAM
-- (ram_cycles): one active cycle for the whole co-op, with the branch living on
-- exhibition_vendors, exhibition_products and exhibition_orders.
--
-- Safe to re-run. The existing per-branch row keeps its branch_id as history;
-- new rows simply leave it null, so the column stays for backward compatibility.

alter table exhibition_cycles alter column branch_id drop not null;

-- One active season per branch is no longer the rule (and would block the
-- single global season as soon as a second row exists).
drop index if exists exhibition_cycles_one_active_per_branch;

-- Exactly one active cycle, enforced by the database — the same guarantee the
-- food module gets from cycles.uq_cycle_active.
create unique index if not exists exhibition_cycles_one_active
  on exhibition_cycles (status)
  where status = 'active';
