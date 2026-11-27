-- migrations/add-exhibition-raffle-draws.sql
-- Audit trail for the exhibition raffle.
--
-- A spin used to live only in the browser tab: once the page was reloaded there
-- was no way to prove who was on the wheel or who won. Each draw is now stored
-- with the season, the qualifying amount in force, the finalists that were
-- actually on the wheel, the winner and the time.
--
-- Idempotent: safe to re-run.
create table if not exists exhibition_raffle_draws (
  id bigserial primary key,
  cycle_id bigint not null references exhibition_cycles(id) on delete cascade,
  cycle_name text not null default '',
  min_amount numeric not null default 0,
  finalist_count integer not null default 0,
  -- [{ member_id, member_name, amount, orders }] exactly as drawn.
  finalists jsonb not null default '[]'::jsonb,
  winner_member_id text not null,
  winner_name text not null default '',
  winner_amount numeric not null default 0,
  winner_orders integer not null default 0,
  drawn_by text not null default '',
  drawn_at timestamptz not null default now()
);

create index if not exists idx_exhibition_raffle_draws_recent
  on exhibition_raffle_draws (cycle_id, drawn_at desc);

-- Reads and writes go through the admin API with the service role; the browser
-- never touches this table, so no policy is granted (deny-all, like the rest of
-- the locked-down tables).
alter table exhibition_raffle_draws enable row level security;
