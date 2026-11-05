-- migrations/add-exhibition-product-addons.sql
-- Optional services sold with a product (e.g. solar panel + installation).
-- A service has no stock of its own: it is priced per unit and can only be
-- bought while adding the product it belongs to, the same way Jumia/PricePally
-- treat installation as an option of the item rather than a shelf product.
create table if not exists exhibition_product_addons (
  id bigserial primary key,
  cycle_id bigint not null references exhibition_cycles(id) on delete cascade,
  product_id bigint not null references exhibition_products(id) on delete cascade,
  vendor_id bigint not null references exhibition_vendors(id) on delete cascade,
  name text not null default '',
  price bigint not null default 0,
  unit text not null default 'service',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exhibition_product_addons_price_check check (price >= 0)
);

create index if not exists exhibition_product_addons_product_idx
  on exhibition_product_addons (product_id)
  where active;
