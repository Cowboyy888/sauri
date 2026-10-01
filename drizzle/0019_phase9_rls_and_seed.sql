-- Phase 9: RLS for every new table (a test fails if any public-schema table lacks it). All four are
-- internal/staff-only, same treatment as every prior phase's own tables — RLS enabled, no policies, so
-- anon/authenticated see nothing.

ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_report_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
