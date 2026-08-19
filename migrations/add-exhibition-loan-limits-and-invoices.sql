-- migrations/add-exhibition-loan-limits-and-invoices.sql
-- Per-cycle exhibition loan caps (Eligible vs Non-Eligible/Grace) by member
-- category — mirrors the Food module's food_loan_* columns on the cycles table.
alter table exhibition_cycles
  add column if not exists exh_loan_eligible_amount_cap_pensioner numeric not null default 0,
  add column if not exists exh_loan_eligible_amount_cap_retiree numeric not null default 0,
  add column if not exists exh_loan_eligible_amount_cap_active numeric not null default 0,
  add column if not exists exh_loan_grace_amount_cap_pensioner numeric not null default 0,
  add column if not exists exh_loan_grace_amount_cap_retiree numeric not null default 0,
  add column if not exists exh_loan_grace_amount_cap_active numeric not null default 0,
  add column if not exists exh_loan_cap_include_interest boolean not null default true;

-- Grace-once flag on exhibition orders (mirrors orders.food_loan_grace_used)
alter table exhibition_orders
  add column if not exists exh_loan_grace_used boolean not null default false;

-- Vendor invoice uploads for exhibition payouts (mirrors ram_vendor_invoices)
create table if not exists exhibition_vendor_invoices (
  id bigserial primary key,
  vendor_id bigint not null references exhibition_vendors(id) on delete cascade,
  cycle_id bigint,
  invoice_ref text,
  invoice_date date,
  amount numeric,
  notes text,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null default 0,
  created_by_role text,
  created_by_code text,
  created_at timestamptz not null default now()
);

create index if not exists exhibition_vendor_invoices_vendor_idx
  on exhibition_vendor_invoices (vendor_id, created_at desc);

create index if not exists exhibition_vendor_invoices_cycle_idx
  on exhibition_vendor_invoices (cycle_id);
