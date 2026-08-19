-- Coop Exhibition: vendor bank accounts (per vendor, per cycle)
-- One current account per vendor per exhibition season. Bank details are set
-- by admins (all cycles) and reps (their branch's vendors) so the co-op can
-- pay vendors after the season — the exhibition equivalent of the food and
-- ram vendor-bank tables.
create table if not exists public.exhibition_vendor_bank_accounts (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.exhibition_vendors(id) on delete cascade,
  cycle_id bigint not null references public.exhibition_cycles(id) on delete cascade,
  branch_id bigint not null references public.branches(id) on delete cascade,
  bank_name text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  is_current boolean not null default true,
  created_by_role text not null default 'admin',
  created_by_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists exhibition_vendor_bank_accounts_one_current_cycle
  on public.exhibition_vendor_bank_accounts(vendor_id, cycle_id);

create index if not exists exhibition_vendor_bank_accounts_cycle_branch_idx
  on public.exhibition_vendor_bank_accounts(cycle_id, branch_id);
