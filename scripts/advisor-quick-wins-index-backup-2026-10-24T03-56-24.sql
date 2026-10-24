-- Restore script for indexes dropped by apply-advisor-quick-wins 2026-10-24T03-56-24
-- restore: idx_branch_item_prices_item_performance
CREATE INDEX idx_branch_item_prices_item_performance ON public.branch_item_prices USING btree (item_id);

-- restore: idx_bip_branch_item
CREATE INDEX idx_bip_branch_item ON public.branch_item_prices USING btree (branch_id, item_id);

-- restore: idx_v_inventory_status_branch_item
CREATE INDEX idx_v_inventory_status_branch_item ON public.branch_item_prices USING btree (branch_id, item_id);

-- restore: idx_branch_item_prices_branch_item_performance
CREATE INDEX idx_branch_item_prices_branch_item_performance ON public.branch_item_prices USING btree (branch_id, item_id);

-- restore: idx_branch_item_prices_branch_item_cycle
CREATE UNIQUE INDEX idx_branch_item_prices_branch_item_cycle ON public.branch_item_prices USING btree (branch_id, item_id, cycle_id);

-- restore: idx_items_sku_performance
CREATE INDEX idx_items_sku_performance ON public.items USING btree (sku);

-- restore: idx_items_category_performance
CREATE INDEX idx_items_category_performance ON public.items USING btree (category);

-- restore: idx_order_lines_item_id_performance
CREATE INDEX idx_order_lines_item_id_performance ON public.order_lines USING btree (item_id);

-- restore: idx_order_lines_order
CREATE INDEX idx_order_lines_order ON public.order_lines USING btree (order_id);

-- restore: idx_order_lines_order_id_performance
CREATE INDEX idx_order_lines_order_id_performance ON public.order_lines USING btree (order_id);

-- restore: idx_orders_member
CREATE INDEX idx_orders_member ON public.orders USING btree (member_id);

-- restore: idx_orders_member_id_performance
CREATE INDEX idx_orders_member_id_performance ON public.orders USING btree (member_id);

-- restore: idx_orders_branch_status_performance
CREATE INDEX idx_orders_branch_status_performance ON public.orders USING btree (branch_id, status);
