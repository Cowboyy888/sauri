CREATE TYPE "public"."attribution_model" AS ENUM('FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR', 'POSITION_BASED');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."email_campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."marketing_event_type" AS ENUM('page_view', 'product_viewed', 'collection_viewed', 'search', 'wishlist_added', 'cart_added', 'cart_removed', 'checkout_started', 'shipping_added', 'payment_started', 'purchase_completed', 'coupon_applied', 'coupon_failed', 'promotion_viewed', 'email_clicked');--> statement-breakpoint
ALTER TYPE "public"."acquisition_source" ADD VALUE 'EMAIL' BEFORE 'OTHER';--> statement-breakpoint
CREATE TABLE "campaign_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"incurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_cost_positive" CHECK ("campaign_costs"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "email_campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"audience" jsonb NOT NULL,
	"subject" text NOT NULL,
	"preview_text" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" "email_campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"campaign_id" uuid,
	"sent_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"first_touch_source" "acquisition_source",
	"first_touch_details" jsonb,
	"first_touch_campaign_id" uuid,
	"last_touch_source" "acquisition_source",
	"last_touch_details" jsonb,
	"last_touch_campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_attributions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"budget_cents" integer,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaign_budget_non_negative" CHECK ("marketing_campaigns"."budget_cents" IS NULL OR "marketing_campaigns"."budget_cents" >= 0),
	CONSTRAINT "marketing_campaign_dates_valid" CHECK ("marketing_campaigns"."start_date" IS NULL OR "marketing_campaigns"."end_date" IS NULL OR "marketing_campaigns"."start_date" <= "marketing_campaigns"."end_date")
);
--> statement-breakpoint
CREATE TABLE "marketing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text,
	"session_id" text NOT NULL,
	"customer_id" uuid,
	"type" "marketing_event_type" NOT NULL,
	"path" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"campaign_id" uuid,
	"product_id" uuid,
	"collection_id" uuid,
	"order_id" uuid,
	"search_query" text,
	"results_count" integer,
	"device" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "eligible_product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "excluded_product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "eligible_collection_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "excluded_collection_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "eligible_segments" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "first_order_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_email_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("email_campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_first_touch_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("first_touch_campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_last_touch_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("last_touch_campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_costs_campaign_idx" ON "campaign_costs" USING btree ("campaign_id","incurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_recipients_uq" ON "email_campaign_recipients" USING btree ("email_campaign_id","customer_id");--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_customer_idx" ON "email_campaign_recipients" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "marketing_attributions_first_campaign_idx" ON "marketing_attributions" USING btree ("first_touch_campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_attributions_last_campaign_idx" ON "marketing_attributions" USING btree ("last_touch_campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_attributions_customer_idx" ON "marketing_attributions" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_campaigns_slug_uq" ON "marketing_campaigns" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "marketing_campaigns_status_idx" ON "marketing_campaigns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_events_event_id_uq" ON "marketing_events" USING btree ("event_id") WHERE "marketing_events"."event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_events_purchase_order_uq" ON "marketing_events" USING btree ("order_id") WHERE "marketing_events"."type" = 'purchase_completed';--> statement-breakpoint
CREATE INDEX "marketing_events_type_created_idx" ON "marketing_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "marketing_events_session_idx" ON "marketing_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "marketing_events_campaign_idx" ON "marketing_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "marketing_events_product_idx" ON "marketing_events" USING btree ("product_id","type");--> statement-breakpoint
CREATE INDEX "marketing_events_collection_idx" ON "marketing_events" USING btree ("collection_id","type");--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE no action ON UPDATE no action;