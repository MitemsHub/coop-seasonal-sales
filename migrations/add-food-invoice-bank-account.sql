-- Food Distribution: file each invoice against the bank account it was paid into.
--
-- A branch can hold several accounts per cycle, so an invoice is only
-- meaningful next to the account it belongs to. The column is nullable: rows
-- created before this change (and rows uploaded by an admin who did not pick an
-- account) stay unassigned rather than disappearing.

ALTER TABLE public.food_vendor_invoices
ADD COLUMN IF NOT EXISTS bank_account_id BIGINT
REFERENCES public.food_vendor_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS food_vendor_invoices_bank_account_idx
ON public.food_vendor_invoices(bank_account_id);

-- Attach existing invoices to the branch's current account for the same cycle,
-- so the account cards do not start out showing zero.
UPDATE public.food_vendor_invoices i
SET bank_account_id = b.id
FROM public.food_vendor_bank_accounts b
WHERE i.bank_account_id IS NULL
  AND b.branch_id = i.branch_id
  AND b.cycle_id = i.cycle_id
  AND b.is_current = TRUE;
