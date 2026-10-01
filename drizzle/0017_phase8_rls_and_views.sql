-- Phase 8: RLS for every new table (a test fails if any public-schema table lacks it). All eleven are
-- internal/staff-only, same treatment as `suppliers`/`inventory_movements` and every other Phase 5-7
-- staff-only table — RLS enabled, no policies, so anon/authenticated see nothing.

ALTER TABLE "supplier_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_price_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stocktakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stocktake_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Phase 8 (brief §8): the "inventory" export report and the low-stock/reorder read models gain a
-- collection column — `variant_stock` never had one (collections weren't joined at all). Additive only:
-- every existing selected column keeps its name, position and meaning.
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
       i.stock_quantity::bigint * v.cost_price_cents AS on_hand_value_cents,
       col.name AS collection_name,
       col.slug AS collection_slug
FROM product_variants v
CROSS JOIN LATERAL (SELECT CASE v.material WHEN 'yg' THEN '14K Yellow Gold' WHEN 'wg' THEN '14K White Gold' WHEN 'vm' THEN '18K Gold Vermeil' WHEN 'ss' THEN 'Sterling Silver' ELSE v.material END AS name) m
JOIN products p ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN collections col ON col.id = p.collection_id
JOIN inventory i ON i.variant_id = v.id;
