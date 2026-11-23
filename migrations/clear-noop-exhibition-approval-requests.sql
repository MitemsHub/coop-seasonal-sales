-- migrations/clear-noop-exhibition-approval-requests.sql
-- One-off repair for approval requests that ask for nothing.
--
-- Saving a product's photos used to submit the price and discount the form had
-- loaded, and the vendor route treated any submitted price/discount as a change
-- request. Products already on sale therefore went back to "Pending approval"
-- (usually with "Awaiting approval: -0%" or the discount they were already
-- selling at) even though nothing about their terms had changed. The route now
-- compares against the approved terms, so this cannot happen again.
--
-- This clears the requests already created by that bug: an active product whose
-- pending price/discount are exactly its approved ones is not waiting on a
-- decision. Draft products (first-time approvals) are left untouched.
-- Safe to run more than once.

DO $$
DECLARE
  has_pending_discount BOOLEAN;
  has_discount BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'exhibition_products'
       AND column_name = 'pending_discount_pct'
  ) INTO has_pending_discount;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'exhibition_products'
       AND column_name = 'discount_pct'
  ) INTO has_discount;

  IF has_pending_discount AND has_discount THEN
    UPDATE exhibition_products
       SET approval_status = 'approved',
           pending_vendor_price = NULL,
           pending_discount_pct = NULL,
           approval_requested_at = NULL,
           approval_note = ''
     WHERE status = 'active'
       AND approval_status = 'pending'
       AND (pending_vendor_price IS NULL OR pending_vendor_price = vendor_price)
       AND (pending_discount_pct IS NULL OR pending_discount_pct = discount_pct);
  ELSIF has_pending_discount THEN
    UPDATE exhibition_products
       SET approval_status = 'approved',
           pending_vendor_price = NULL,
           pending_discount_pct = NULL,
           approval_requested_at = NULL,
           approval_note = ''
     WHERE status = 'active'
       AND approval_status = 'pending'
       AND (pending_vendor_price IS NULL OR pending_vendor_price = vendor_price);
  ELSE
    UPDATE exhibition_products
       SET approval_status = 'approved',
           pending_vendor_price = NULL,
           approval_requested_at = NULL,
           approval_note = ''
     WHERE status = 'active'
       AND approval_status = 'pending'
       AND (pending_vendor_price IS NULL OR pending_vendor_price = vendor_price);
  END IF;
END $$;
