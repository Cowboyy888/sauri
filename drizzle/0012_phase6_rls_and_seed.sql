-- Phase 6: RLS for every new table (a test fails if any public-schema table lacks it), grants for the
-- tables a signed-in customer legitimately needs (their own loyalty account/transactions/redemptions,
-- their own consent history, and read-only visibility into active loyalty tiers/rewards), the new
-- customer-facing columns on `customers`, and the initial loyalty tiers + customer tags.

ALTER TABLE "customer_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_tag_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_communications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wishlist_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "abandoned_carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_moderation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_tiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- customer_tags, customer_tag_assignments, customer_notes, customer_communications, wishlist_events,
-- abandoned_carts, stock_notifications, review_moderation_events: internal/staff-only, same as
-- inventory_movements/payments/refunds — RLS enabled, no policies, so anon/authenticated see nothing.

-- Loyalty tiers and rewards are public program information (no PII), same treatment as shipping_methods.
GRANT SELECT (id, name, min_spend_cents, benefits, position) ON loyalty_tiers TO anon, authenticated;--> statement-breakpoint
CREATE POLICY "loyalty_tiers_active_read" ON loyalty_tiers FOR SELECT TO anon, authenticated USING (active = true);--> statement-breakpoint
GRANT SELECT (id, name, description, points_cost, reward_type, reward_value) ON loyalty_rewards TO anon, authenticated;--> statement-breakpoint
CREATE POLICY "loyalty_rewards_active_read" ON loyalty_rewards FOR SELECT TO anon, authenticated USING (active = true);--> statement-breakpoint

-- A signed-in customer reads (never writes directly) their own loyalty account, transaction history and
-- redemptions — the balance only ever changes through the server's transaction-writing service.
GRANT SELECT (id, customer_id, points_balance, lifetime_points_earned, lifetime_points_redeemed, created_at, updated_at) ON loyalty_accounts TO authenticated;--> statement-breakpoint
CREATE POLICY "loyalty_accounts_own_read" ON loyalty_accounts FOR SELECT TO authenticated USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint

GRANT SELECT (id, account_id, type, points, balance_before, balance_after, reference_type, reason, created_at) ON loyalty_transactions TO authenticated;--> statement-breakpoint
CREATE POLICY "loyalty_transactions_own_read" ON loyalty_transactions FOR SELECT TO authenticated
  USING (account_id IN (SELECT la.id FROM loyalty_accounts la JOIN customers c ON c.id = la.customer_id WHERE c.user_id = auth.uid()));--> statement-breakpoint

GRANT SELECT (id, customer_id, reward_id, points_spent, status, created_at, used_at) ON loyalty_redemptions TO authenticated;--> statement-breakpoint
CREATE POLICY "loyalty_redemptions_own_read" ON loyalty_redemptions FOR SELECT TO authenticated USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint

-- A customer may read their own consent history (never another customer's, never write it directly —
-- consent changes go through the account-settings server action, which logs this table itself).
GRANT SELECT (id, customer_id, type, consent, source, created_at) ON customer_consents TO authenticated;--> statement-breakpoint
CREATE POLICY "customer_consents_own_read" ON customer_consents FOR SELECT TO authenticated USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));--> statement-breakpoint

-- New customer-facing columns (brief §9, §15-17): consent, email preferences and acquisition attribution
-- are all things a customer may see about their own account. `anonymized_at`/`merged_into_customer_id` are
-- internal privacy/merge mechanics and are deliberately left out of this grant.
GRANT SELECT (sms_marketing_consent, consent_updated_at, email_preferences, first_touch_source, last_touch_source, first_visit_at) ON customers TO authenticated;--> statement-breakpoint

INSERT INTO loyalty_tiers (name, min_spend_cents, benefits, position)
VALUES ('Member', 0, '{}'::jsonb, 1),
       ('Silver', 50000, '{"bonusPointsMultiplier":1.25}'::jsonb, 2),
       ('Gold', 150000, '{"bonusPointsMultiplier":1.5,"earlyAccess":true}'::jsonb, 3),
       ('Platinum', 300000, '{"bonusPointsMultiplier":2,"earlyAccess":true,"freeShipping":true}'::jsonb, 4)
ON CONFLICT (name) DO NOTHING;--> statement-breakpoint

INSERT INTO customer_tags (name, color)
VALUES ('VIP', '#a9832f'),
       ('Wholesale', '#5b6f8c'),
       ('Gift Buyer', '#8a6ba8'),
       ('Frequent Buyer', '#4f8a63'),
       ('High Value', '#a9832f'),
       ('Needs Follow Up', '#b8703f')
ON CONFLICT DO NOTHING;
