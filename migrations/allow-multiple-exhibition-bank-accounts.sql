-- A vendor stand can keep more than one bank account for a season; only one is
-- used for payouts. The original index made (vendor_id, cycle_id) unique
-- outright, which blocked a second account even when it was not current.
-- Replace it with the same shape food and ram already use.
drop index if exists exhibition_vendor_bank_accounts_one_current_cycle;

create unique index if not exists exhibition_vendor_bank_accounts_one_current_cycle
  on exhibition_vendor_bank_accounts (vendor_id, cycle_id)
  where is_current;

create index if not exists exhibition_vendor_bank_accounts_vendor_cycle_idx
  on exhibition_vendor_bank_accounts (vendor_id, cycle_id);
