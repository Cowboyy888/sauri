-- Phase 4: RLS for the two new tables, the orders grant extended for the three new columns, and the
-- initial shipping methods (replacing the old hardcoded standard/express constants as the source of truth).

ALTER TABLE "shipping_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Shipping methods are public catalog data (shown at checkout), same access as products/categories.
GRANT SELECT ON shipping_methods TO anon, authenticated;--> statement-breakpoint
CREATE POLICY "shipping_methods_read" ON shipping_methods FOR SELECT TO anon, authenticated USING (active = true);--> statement-breakpoint

-- payment_events is internal (webhook idempotency ledger): no grants, no policies — same as payments/refunds.

-- The three new order columns a signed-in customer may read on their own orders (tracking info).
GRANT SELECT (shipping_method_id, tracking_number, carrier) ON orders TO authenticated;--> statement-breakpoint

INSERT INTO shipping_methods (name, description, price_cents, estimated_min_days, estimated_max_days, waivable_above_threshold, carrier_cost_cents, position)
VALUES
  ('Standard Shipping', 'Delivered in 3–6 business days.', 800, 3, 6, true, 650, 1),
  ('Express Shipping', 'Delivered in 1–2 business days.', 2000, 1, 2, false, 1400, 2)
ON CONFLICT DO NOTHING;
