-- Seed data for the local Coop Exhibition smoke test.
-- Branch ABJ, member ABJ/001, active exhibition cycle, one vendor, one
-- category, two products (one with a negotiated member price), minimal pin.

INSERT INTO branches (id, code, name, address) VALUES
  (1, 'ABJ', 'Abuja Branch', 'Central Area, Abuja'),
  (2, 'LAG', 'Lagos Branch', 'Victoria Island, Lagos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO departments (id, name) VALUES
  (1, 'IT') ON CONFLICT (id) DO NOTHING;

INSERT INTO members (member_id, branch_id, department_id, first_name, last_name, full_name,
                     phone, savings, loans, global_limit, pin, status)
VALUES
  ('ABJ-001', 1, 1, 'Ada', 'Test', 'Ada Test', '08012345678', 1000000, 0, 1000000, '1234', 'active'),
  ('LAG-001', 2, 1, 'Bola', 'Test', 'Bola Test', '08087654321', 800000, 0, 800000, '1234', 'active')
ON CONFLICT (member_id) DO NOTHING;

-- ── Exhibition module ────────────────────────────────────────────────
INSERT INTO exhibition_cycles (id, branch_id, name, code, status, starts_at, ends_at,
                               vendor_deduction_rate_pct, loan_interest_rate_pct)
VALUES (1, 1, 'Exhibition 2026', 'EXH-2026-ABJ', 'active', NOW() - INTERVAL '7 days', NOW() + INTERVAL '30 days', 6, 13)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_vendors (id, cycle_id, branch_id, name, code, passcode, phone, address, status)
VALUES
  (1, 1, 1, 'Gold Standard Goods', 'VND1', '1234', '08090000001', 'Stand 12, Central Market', 'active'),
  (2, 1, 1, 'Blue Ribbon Beverages', 'VND2', '1234', '08090000002', 'Stand 14, Central Market', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_categories (id, cycle_id, name, sort_order)
VALUES (1, 1, 'Appliances', 1), (2, 1, 'Beverages', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_products (id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit,
                                 vendor_price, admin_markup, qty, status)
VALUES
  (1, 1, 1, 1, 1, 'Solar Panel 100W', 'SOLAR-100', 'each', 40000, 5000, 50, 'active'),
  (2, 1, 1, 1, 2, 'Palm Wine 5L', 'PALM-5L', 'bottle', 9000, 1000, 200, 'active'),
  (3, 1, 2, 1, 2, 'Honey 1L', 'HONEY-1L', 'bottle', 15000, 2000, 150, 'active'),
  (5, 1, 2, 1, 2, 'Festive Gift Basket', 'GIFT-1', 'each', 25000, 5000, 2, 'active')
ON CONFLICT (id) DO NOTHING;

-- Negotiated price for Ada on product 2: catalog 10,000 → member pays 8,000.
INSERT INTO exhibition_member_prices (cycle_id, product_id, member_id, price, set_by, note)
VALUES (1, 2, 'ABJ-001', 8000, 'vendor', 'Beat the price for Ada')
ON CONFLICT (cycle_id, product_id, member_id) DO NOTHING;

-- ── Lagos branch: its own active cycle, vendor + catalog ─────────────
INSERT INTO exhibition_cycles (id, branch_id, name, code, status, starts_at, ends_at,
                               vendor_deduction_rate_pct, loan_interest_rate_pct)
VALUES (2, 2, 'Exhibition 2026 Lagos', 'EXH-2026-LAG', 'active', NOW() - INTERVAL '7 days', NOW() + INTERVAL '30 days', 6, 13)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_vendors (id, cycle_id, branch_id, name, code, passcode, phone, address, status)
VALUES (3, 2, 2, 'Lagoon Foods', 'VND3', '1234', '08090000003', 'Stand 3, Island Market', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_categories (id, cycle_id, name, sort_order)
VALUES (3, 2, 'Beverages', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_products (id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit,
                                 vendor_price, admin_markup, qty, status)
VALUES (4, 2, 3, 2, 3, 'Zobo Mix 1L', 'ZOBO-1L', 'bottle', 6000, 1000, 300, 'active')
ON CONFLICT (id) DO NOTHING;

-- Keep local cycles schema in sync with the app routes (admin cycles CRUD expects code/starts_at/ends_at)
ALTER TABLE public.cycles
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS cycles_code_uidx
  ON public.cycles(code) WHERE code IS NOT NULL AND code <> '';

-- Give the active food cycle a code so admin cycles CRUD can round-trip it
UPDATE public.cycles SET code = 'CYCLE-2026' WHERE code IS NULL AND is_active = TRUE;

-- Orders carry the department the member chose at checkout (reports group by it)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES public.departments(id);

CREATE INDEX IF NOT EXISTS idx_orders_branch_department_status
  ON public.orders(branch_id, department_id, status);

-- Reports views used by /api/admin/reports/summary
CREATE OR REPLACE VIEW public.v_applications_by_branch AS
SELECT
  b.name AS branch_name,
  COALESCE(SUM(CASE WHEN o.status = 'Pending'  THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN o.status = 'Posted'   THEN 1 ELSE 0 END), 0) AS posted,
  COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered
FROM public.branches b
LEFT JOIN public.orders o ON b.id = o.branch_id
GROUP BY b.id, b.name
ORDER BY b.name;

CREATE OR REPLACE VIEW public.v_applications_by_branch_department AS
SELECT
  b.name AS branch_name,
  d.name AS department_name,
  COALESCE(SUM(CASE WHEN o.status = 'Pending'  THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN o.status = 'Posted'   THEN 1 ELSE 0 END), 0) AS posted,
  COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered
FROM public.branches b
CROSS JOIN public.departments d
LEFT JOIN public.orders o
  ON o.branch_id     = b.id
 AND o.department_id = d.id
GROUP BY b.id, b.name, d.id, d.name
ORDER BY b.name, d.name;

-- Order listing snapshots member identity/category at checkout time (food orders list)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS member_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS member_category_snapshot TEXT;

-- Ram delivery locations carry vendor contact info + ordering (delivery-locations API)
ALTER TABLE public.ram_delivery_locations
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ── Extra ABJ stands for hub-browsing tests ───────────────────────────
-- 10 more stands (ids 4–13) each listing 10 products, so the member shop
-- exercises the hub slideshow, View-all search and pagination with a real
-- multi-vendor market. Idempotent (ON CONFLICT DO NOTHING) like the rest.

INSERT INTO exhibition_categories (id, cycle_id, name, sort_order)
VALUES
  (4, 1, 'Fashion', 3),
  (5, 1, 'Groceries', 4),
  (6, 1, 'Home & Kitchen', 5),
  (7, 1, 'Electronics', 6),
  (8, 1, 'Beauty & Care', 7),
  (9, 1, 'Books & Stationery', 8)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exhibition_vendors (id, cycle_id, branch_id, name, code, passcode, phone, address, status)
VALUES
  (4, 1, 1, 'Ade Fresh Produce', 'VND4', '1234', '08090000004', 'Stand 4, Central Market', 'active'),
  (5, 1, 1, 'Summit Electronics', 'VND5', '1234', '08090000005', 'Stand 5, Central Market', 'active'),
  (6, 1, 1, 'Kingsway Fabrics', 'VND6', '1234', '08090000006', 'Stand 6, Central Market', 'active'),
  (7, 1, 1, 'Daro Kitchenware', 'VND7', '1234', '08090000007', 'Stand 7, Central Market', 'active'),
  (8, 1, 1, 'Nature Organic Foods', 'VND8', '1234', '08090000008', 'Stand 8, Central Market', 'active'),
  (9, 1, 1, 'Bright Beauty', 'VND9', '1234', '08090000009', 'Stand 9, Central Market', 'active'),
  (10, 1, 1, 'Eagle Hardware', 'VND10', '1234', '08090000010', 'Stand 10, Central Market', 'active'),
  (11, 1, 1, 'Sterling Stationery', 'VND11', '1234', '08090000011', 'Stand 11, Central Market', 'active'),
  (12, 1, 1, 'Pearl Jewellery', 'VND12', '1234', '08090000012', 'Stand 12, Central Market', 'active'),
  (13, 1, 1, 'Prime Fashions', 'VND13', '1234', '08090000013', 'Stand 13, Central Market', 'active')
ON CONFLICT (id) DO NOTHING;

-- 10 products per new stand (idempotent via the sku unique constraint).
INSERT INTO exhibition_products (cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, status)
SELECT
  1,
  v.id,
  1,
  v.category_id,
  v.item_names[n],
  'SKU-' || v.id || '-' || LPAD(n::text, 2, '0'),
  'each',
  1500 + (n * 900) + (v.id * 41),
  300 + (n * 90),
  25 + (n * 5),
  'active'
FROM (
  VALUES
    (4, 5, ARRAY['Fresh Tomatoes 1kg', 'Onions 1kg', 'Plantain Bunch', 'Yam Tuber', 'Pepper Mix 500g', 'Garri 5kg', 'Rice 10kg', 'Beans 1kg', 'Groundnut Oil 5L', 'Eggs (crate)']),
    (5, 7, ARRAY['LED TV 32in', 'Bluetooth Speaker', 'Power Bank 20000mAh', 'Phone Charger', 'Extension Board', 'Electric Kettle', 'Standing Fan', 'Rice Cooker', 'Steam Iron', 'Rechargeable Torch']),
    (6, 4, ARRAY['Ankara Print 6yd', 'Lace Fabric', 'Adire Gown', 'Aso-Oke', 'Senator Wear', 'Kaftan', 'Headwrap (Gele)', 'Shirt Material', 'Dress Material', 'Child Outfit']),
    (7, 6, ARRAY['Nonstick Pot Set', 'Frying Pan', 'Cutlery Set', 'Mixing Bowls', 'Blender', 'Chopping Board', 'Food Flask', 'Water Dispenser', 'Colander', 'Knife Set']),
    (8, 5, ARRAY['Organic Honey 500g', 'Brown Rice 5kg', 'Oats 1kg', 'Chia Seeds', 'Almonds 250g', 'Coconut Oil 1L', 'Dried Mango', 'Cassava Flour 2kg', 'Tiger Nuts', 'Organic Tea']),
    (9, 8, ARRAY['Shea Butter 500g', 'Black Soap', 'Body Lotion 400ml', 'Hair Oil', 'Perfume 100ml', 'Nail Polish Set', 'Face Mask', 'Lipstick', 'Bath Set', 'Beard Oil']),
    (10, 1, ARRAY['Power Drill', 'Hammer Set', 'Screwdriver Kit', 'Measuring Tape', 'Padlock', 'LED Bulb Pack', 'Paint Roller', 'Toolbox', 'Socket Wrench', 'Door Hinge']),
    (11, 9, ARRAY['A4 Paper Ream', 'Ballpoint Pen Pack', 'Exercise Books', 'Stapler', 'Calculator', 'Whiteboard Markers', 'Desk Organizer', 'Notebook', 'Scissors Pack', 'Folders']),
    (12, 4, ARRAY['Gold Chain', 'Pearl Necklace', 'Stud Earrings', 'Bracelet Set', 'Nose Ring', 'Anklet', 'Brooch', 'Cufflinks', 'Beaded Necklace', 'Ring Set']),
    (13, 4, ARRAY['Mens Suit', 'Ladies Gown', 'Office Shirt', 'Trousers', 'Skirt Set', 'Agbada', 'Blouse', 'Native Wear', 'Casual Tee', 'Joggers'])
) AS v(id, category_id, item_names)
CROSS JOIN LATERAL generate_series(1, array_length(v.item_names, 1)) AS n
ON CONFLICT (cycle_id, vendor_id, sku) DO NOTHING;

-- Keep the serial sequences ahead of the explicit ids above so the app can
-- keep inserting (admin adds a vendor/product) without duplicate-key errors.
SELECT setval(pg_get_serial_sequence('exhibition_vendors', 'id'), (SELECT COALESCE(MAX(id), 1) FROM exhibition_vendors));
SELECT setval(pg_get_serial_sequence('exhibition_categories', 'id'), (SELECT COALESCE(MAX(id), 1) FROM exhibition_categories));
SELECT setval(pg_get_serial_sequence('exhibition_products', 'id'), (SELECT COALESCE(MAX(id), 1) FROM exhibition_products));
