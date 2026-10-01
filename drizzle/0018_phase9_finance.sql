CREATE TYPE "public"."expense_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('MATCHED', 'UNMATCHED', 'PARTIAL', 'DISCREPANCY', 'IGNORED');--> statement-breakpoint
CREATE SEQUENCE "public"."expense_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_number" text DEFAULT 'EXP-' || lpad(nextval('expense_number_seq')::text, 6, '0') NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_method" text,
	"supplier_id" uuid,
	"reference_number" text,
	"notes" text,
	"attachment_url" text,
	"status" "expense_status" DEFAULT 'DRAFT' NOT NULL,
	"expense_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_expense_number_unique" UNIQUE("expense_number"),
	CONSTRAINT "expense_amount_positive" CHECK ("expenses"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "financial_report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_type" text NOT NULL,
	"label" text NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"filters" jsonb,
	"values" jsonb NOT NULL,
	"report_version" integer DEFAULT 1 NOT NULL,
	"generated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"internal_amount_cents" integer NOT NULL,
	"external_amount_cents" integer,
	"transaction_ref" text,
	"status" "reconciliation_status" DEFAULT 'UNMATCHED' NOT NULL,
	"checked_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_records_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "reconciliation_internal_amount_non_negative" CHECK ("reconciliation_records"."internal_amount_cents" >= 0),
	CONSTRAINT "reconciliation_external_amount_non_negative" CHECK ("reconciliation_records"."external_amount_cents" IS NULL OR "reconciliation_records"."external_amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD COLUMN "reference_number" text;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD COLUMN "attachment_url" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_report_snapshots" ADD CONSTRAINT "financial_report_snapshots_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_paid_idx" ON "expenses" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "financial_report_snapshots_type_idx" ON "financial_report_snapshots" USING btree ("report_type","created_at");--> statement-breakpoint
CREATE INDEX "reconciliation_records_status_idx" ON "reconciliation_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reconciliation_records_order_idx" ON "reconciliation_records" USING btree ("order_id");