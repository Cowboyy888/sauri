-- Views and row-level security. See docs/DATABASE_SCHEMA.md and docs/ROLES_AND_PERMISSIONS.md.
--
-- Access model
--   * The Next.js server connects as the database owner and enforces staff roles in lib/ (assertCan).
--   * RLS protects everything reachable through Supabase's public API (roles anon / authenticated):
--       - catalog (active products, variants, images, categories, collections, published reviews): readable,
--         with cost prices hidden through column privileges;
--       - a signed-in customer can read only their own customer row, addresses, orders, order items and wishlist,
--         never the store's costs or margins;
--       - staff, inventory, movements, payments, refunds, discounts, audit, notifications, settings: no access.

-- Supabase compatibility: these exist on Supabase already; created here so plain Postgres (CI, local) behaves the same.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS auth;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'uid') THEN
    EXECUTE $f$CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $b$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $b$ $f$;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO anon, authenticated;--> statement-breakpoint

-- Views. security_invoker makes the caller's RLS apply to the underlying tables.
CREATE VIEW "variant_stock" WITH (security_invoker = true) AS
SELECT v.id AS variant_id, v.product_id, p.name AS product_name, p.status AS product_status, c.name AS category_name,
       v.sku, v.barcode, v.status AS variant_status,
       concat_ws(' / ', m.name, CASE WHEN strpos(m.name, v.color) > 0 THEN NULL ELSE v.color END,
         v.gemstone, CASE WHEN v.size ~ '^[0-9]+$' THEN 'Size ' || v.size ELSE v.size END) AS variant_label,
       v.cost_price_cents, v.selling_price_cents,
       i.stock_quantity, i.reserved_quantity, i.stock_quantity - i.reserved_quantity AS available_stock, i.reorder_level,
       CASE WHEN i.stock_quantity - i.reserved_quantity <= 0 THEN 'OUT_OF_STOCK'
            WHEN i.stock_quantity - i.reserved_quantity <= i.reorder_level THEN 'LOW_STOCK'
            ELSE 'IN_STOCK' END AS stock_status,
       i.stock_quantity::bigint * v.cost_price_cents AS inventory_value_cents
FROM product_variants v
CROSS JOIN LATERAL (SELECT CASE v.material WHEN 'yg' THEN '14K Yellow Gold' WHEN 'wg' THEN '14K White Gold' WHEN 'vm' THEN '18K Gold Vermeil' WHEN 'ss' THEN 'Sterling Silver' ELSE v.material END AS name) m
JOIN products p ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
JOIN inventory i ON i.variant_id = v.id;--> statement-breakpoint

-- Customer statistics are derived from orders, not stored twice (brief §15).
CREATE VIEW "customer_stats" WITH (security_invoker = true) AS
SELECT c.id AS customer_id, c.user_id, c.name, c.email, c.created_at AS customer_since,
       count(o.id) AS total_orders,
       coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents), 0)::bigint AS total_spent_cents,
       coalesce(sum(o.gross_profit_cents), 0)::bigint AS gross_profit_cents,
       CASE WHEN count(o.id) > 0 THEN round(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents)::numeric / count(o.id))::bigint ELSE 0 END AS average_order_value_cents,
       min(o.paid_at) AS first_order_at, max(o.paid_at) AS last_order_at
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.paid_at IS NOT NULL
GROUP BY c.id;--> statement-breakpoint

-- RLS on every table: with no policy, a role sees nothing.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discount_usages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wishlists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO anon, authenticated;--> statement-breakpoint

-- Public catalog
GRANT SELECT ON categories, collections, products, product_images TO anon, authenticated;--> statement-breakpoint
GRANT SELECT (id, product_id, sku, barcode, material, color, size, gemstone, selling_price_cents, compare_at_price_cents, weight_mg, status, created_at, updated_at) ON product_variants TO anon, authenticated;--> statement-breakpoint
GRANT SELECT (id, product_id, rating, title, body, author_name, status, created_at) ON reviews TO anon, authenticated;--> statement-breakpoint
CREATE POLICY "catalog_categories_read" ON categories FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY "catalog_collections_read" ON collections FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY "catalog_products_read" ON products FOR SELECT TO anon, authenticated USING (status = 'active');--> statement-breakpoint
CREATE POLICY "catalog_images_read" ON product_images FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.status = 'active'));--> statement-breakpoint
CREATE POLICY "catalog_variants_read" ON product_variants FOR SELECT TO anon, authenticated USING (status = 'active' AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.status = 'active'));--> statement-breakpoint
CREATE POLICY "catalog_reviews_read" ON reviews FOR SELECT TO anon, authenticated USING (status = 'published');--> statement-breakpoint

-- A signed-in customer's own data (no costs, margins or internal fees)
GRANT SELECT (id, user_id, email, name, phone, marketing_opt_in, created_at, updated_at) ON customers TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_addresses, wishlists TO authenticated;--> statement-breakpoint
GRANT SELECT (id, order_number, customer_id, status, payment_status, fulfillment_status, currency, subtotal_cents, discount_total_cents, shipping_total_cents, tax_total_cents, total_cents, refund_total_cents, discount_code, express_shipping, shipping_address, billing_address, placed_at, paid_at, created_at, updated_at) ON orders TO authenticated;--> statement-breakpoint
GRANT SELECT (id, order_id, product_id, variant_id, product_name_snapshot, sku_snapshot, variant_snapshot, quantity, unit_price_cents, discount_cents, line_total_cents, personalization, created_at) ON order_items TO authenticated;--> statement-breakpoint
CREATE POLICY "customers_own_read" ON customers FOR SELECT TO authenticated USING (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "addresses_own_all" ON customer_addresses FOR ALL TO authenticated
  USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()))
  WITH CHECK (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "wishlists_own_all" ON wishlists FOR ALL TO authenticated
  USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()))
  WITH CHECK (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "orders_own_read" ON orders FOR SELECT TO authenticated USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "order_items_own_read" ON order_items FOR SELECT TO authenticated USING (order_id IN (SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.user_id = auth.uid()));
