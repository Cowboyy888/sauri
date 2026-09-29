-- Phase 5: RLS for every new table (a test fails if any public-schema table lacks it), grants for the
-- tables a signed-in customer legitimately needs (their own packages' tracking info, their own return
-- requests/items), and the initial inventory locations.

ALTER TABLE "inventory_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fulfillment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "package_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipping_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_inspections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- inventory_locations, fulfillment_items, fulfillment_events, package_items, shipping_events,
-- return_inspections, return_events: internal/staff-only, same as inventory_movements/payments/refunds —
-- RLS enabled, no policies, so anon/authenticated see nothing.

-- A signed-in customer may read (not write) their own packages' shipping info — never weight/dimensions
-- or the internal label URL.
GRANT SELECT (id, order_id, package_number, carrier, service, tracking_number, tracking_url, status, shipped_at, delivered_at) ON packages TO authenticated;--> statement-breakpoint
CREATE POLICY "packages_own_read" ON packages FOR SELECT TO authenticated
  USING (order_id IN (SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.user_id = auth.uid()));--> statement-breakpoint

-- A customer creates and reads their own return requests, but never updates one directly (status moves
-- only through staff/admin server actions) — same read/insert-only shape as orders_own_read plus an insert policy.
GRANT SELECT (id, order_id, customer_id, status, customer_notes, return_shipping_cost_cents, return_shipping_paid_by, return_tracking_number, return_carrier, requested_at, created_at, updated_at), INSERT (order_id, customer_id, status, customer_notes) ON return_requests TO authenticated;--> statement-breakpoint
CREATE POLICY "return_requests_own_read" ON return_requests FOR SELECT TO authenticated USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "return_requests_own_insert" ON return_requests FOR INSERT TO authenticated WITH CHECK (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint

GRANT SELECT (id, return_request_id, order_item_id, quantity, reason, description, photo_urls, exchange_requested, replacement_variant_id, created_at), INSERT (return_request_id, order_item_id, quantity, reason, description, photo_urls, exchange_requested, replacement_variant_id) ON return_items TO authenticated;--> statement-breakpoint
CREATE POLICY "return_items_own_read" ON return_items FOR SELECT TO authenticated
  USING (return_request_id IN (SELECT rr.id FROM return_requests rr JOIN customers c ON c.id = rr.customer_id WHERE c.user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "return_items_own_insert" ON return_items FOR INSERT TO authenticated
  WITH CHECK (return_request_id IN (SELECT rr.id FROM return_requests rr JOIN customers c ON c.id = rr.customer_id WHERE c.user_id = auth.uid()));--> statement-breakpoint

INSERT INTO inventory_locations (name, code, description, position)
VALUES ('Main Warehouse', 'MAIN', 'Primary sellable stock.', 1),
       ('Display', 'DISPLAY', 'On display in the physical store.', 2),
       ('Packing Station', 'PACKING', 'Picked and staged for packing.', 3),
       ('Damaged', 'DAMAGED', 'Damaged stock, not sellable.', 4),
       ('Returns', 'RETURNS', 'Received returns awaiting inspection.', 5)
ON CONFLICT (code) DO NOTHING;
