-- Sequential display IDs for exhibition invoices.
-- order_id is what the vendor, admin, rep and member see; exhibition_orders.id
-- stays the internal primary key. Existing numeric IDs are respected, so this
-- is safe to re-run after data has been captured.
create sequence if not exists exhibition_order_number_seq start 1;

select setval(
  'exhibition_order_number_seq',
  greatest(
    coalesce((select max(order_id::bigint) from exhibition_orders where order_id ~ '^[0-9]+$'), 0) + 1,
    1
  ),
  false
);

alter table exhibition_orders
  alter column order_id set default (nextval('exhibition_order_number_seq')::text);
