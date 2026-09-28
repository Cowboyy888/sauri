-- Phase 2: dashboard support. No table changes.

-- Brief §18: inventory value = AVAILABLE stock × cost price.
-- On-hand value (stock × cost, which still counts units reserved by unpaid checkouts) is kept as its own column.
CREATE OR REPLACE VIEW "variant_stock" WITH (security_invoker = true) AS
SELECT v.id AS variant_id, v.product_id, p.name AS product_name, p.status AS product_status, c.name AS category_name,
       v.sku, v.barcode, v.status AS variant_status,
       concat_ws(' / ', m.name, CASE WHEN strpos(m.name, v.color) > 0 THEN NULL ELSE v.color END,
         v.gemstone, CASE WHEN v.size ~ '^[0-9]+$' THEN 'Size ' || v.size ELSE v.size END) AS variant_label,
       v.cost_price_cents, v.selling_price_cents,
       i.stock_quantity, i.reserved_quantity, i.stock_quantity - i.reserved_quantity AS available_stock, i.reorder_level,
       CASE WHEN i.stock_quantity - i.reserved_quantity <= 0 THEN 'OUT_OF_STOCK'
            WHEN i.stock_quantity - i.reserved_quantity <= i.reorder_level THEN 'LOW_STOCK'
            ELSE 'IN_STOCK' END AS stock_status,
       greatest(i.stock_quantity - i.reserved_quantity, 0)::bigint * v.cost_price_cents AS inventory_value_cents,
       c.slug AS category_slug,
       i.stock_quantity::bigint * v.cost_price_cents AS on_hand_value_cents
FROM product_variants v
CROSS JOIN LATERAL (SELECT CASE v.material WHEN 'yg' THEN '14K Yellow Gold' WHEN 'wg' THEN '14K White Gold' WHEN 'vm' THEN '18K Gold Vermeil' WHEN 'ss' THEN 'Sterling Silver' ELSE v.material END AS name) m
JOIN products p ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
JOIN inventory i ON i.variant_id = v.id;--> statement-breakpoint

-- Brief §24: fast "contains" search on name, SKU, barcode, customers and order numbers without loading everything.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variants_sku_trgm" ON "product_variants" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_name_trgm" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_email_trgm" ON "customers" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_number_trgm" ON "orders" USING gin ("order_number" gin_trgm_ops);--> statement-breakpoint
-- Dashboard "last sold" and per-product trends read order_items by variant/product with the order's paid_at.
CREATE INDEX IF NOT EXISTS "orders_paid_recent_idx" ON "orders" ("paid_at" DESC) WHERE "paid_at" IS NOT NULL;
