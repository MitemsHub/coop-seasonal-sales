-- Each bank account is a payment destination in its own right: it has a
-- purpose, the invoices filed against it, and its own paid status. There is no
-- "primary" account any more, so new rows no longer default to current and the
-- existing flags are cleared (the column is kept for older code paths).
alter table food_vendor_bank_accounts
  add column if not exists purpose text,
  add column if not exists is_paid boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text;

alter table ram_vendor_bank_accounts
  add column if not exists purpose text,
  add column if not exists is_paid boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text;

alter table exhibition_vendor_bank_accounts
  add column if not exists purpose text,
  add column if not exists is_paid boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text;

alter table food_vendor_bank_accounts alter column is_current set default false;
alter table ram_vendor_bank_accounts alter column is_current set default false;
alter table exhibition_vendor_bank_accounts alter column is_current set default false;

update food_vendor_bank_accounts set is_current = false where is_current;
update ram_vendor_bank_accounts set is_current = false where is_current;
update exhibition_vendor_bank_accounts set is_current = false where is_current;
