-- An invoice belongs to the account the money went into, so each account can
-- be paid (and audited) on its own. Food already works this way.
alter table ram_vendor_invoices
  add column if not exists bank_account_id bigint references ram_vendor_bank_accounts(id) on delete set null;

alter table exhibition_vendor_invoices
  add column if not exists bank_account_id bigint references exhibition_vendor_bank_accounts(id) on delete set null;

create index if not exists ram_vendor_invoices_bank_account_idx
  on ram_vendor_invoices (bank_account_id);

create index if not exists exhibition_vendor_invoices_bank_account_idx
  on exhibition_vendor_invoices (bank_account_id);
