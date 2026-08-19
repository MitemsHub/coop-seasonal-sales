-- Reset the Coop Exhibition transactional tables before a smoke-test run.
-- Keeps the seed (branches, cycles, vendors, products, member prices) intact
-- while clearing every order, line, payment-status row and audit entry so the
-- smoke test's exact-total assertions start from a known state. Stock is also
-- restored to its seed values (checkout now decrements exhibition_products.qty).
-- Usage: docker exec -i coop-pg psql -U postgres -v ON_ERROR_STOP=1 < scripts/reset-exhibition.sql
TRUNCATE exhibition_orders CASCADE;
-- Exhibition audit events now live in the shared audit_log table (module='exhibition').
DELETE FROM audit_log WHERE module = 'exhibition';
TRUNCATE exhibition_vendor_payment_status CASCADE;

-- Restore seed stock levels (kept in sync with local-db-seed.sql)
UPDATE exhibition_products SET qty = CASE id
  WHEN 1 THEN 50
  WHEN 2 THEN 200
  WHEN 3 THEN 150
  WHEN 4 THEN 300
  WHEN 5 THEN 2
  ELSE qty
END
WHERE id IN (1, 2, 3, 4, 5);
