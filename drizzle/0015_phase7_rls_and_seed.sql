-- Phase 7: RLS for every new table (a test fails if any public-schema table lacks it). All six are
-- internal/staff-only, same treatment as inventory_movements/payments/refunds and Phase 5/6's own
-- staff-only tables (fulfillment_items, review_moderation_events, ...) — RLS enabled, no policies, so
-- anon/authenticated see nothing. marketing_events is written by the storefront's own server route
-- (/api/marketing/events), which connects as the database owner like every other route, not through the
-- RLS-restricted anon/authenticated roles — a shopper's browser never talks to Postgres directly.

ALTER TABLE "marketing_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ENABLE ROW LEVEL SECURITY;
