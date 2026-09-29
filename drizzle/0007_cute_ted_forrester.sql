CREATE TYPE "public"."pick_status" AS ENUM('pending', 'picked', 'missing', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."return_condition" AS ENUM('new', 'like_new', 'used', 'damaged', 'defective', 'unsellable');--> statement-breakpoint
CREATE TYPE "public"."return_disposition" AS ENUM('restock', 'repair', 'damaged', 'dispose', 'return_to_customer');--> statement-breakpoint
CREATE TYPE "public"."return_reason" AS ENUM('wrong_size', 'changed_mind', 'damaged', 'defective', 'wrong_item', 'not_as_expected', 'other');--> statement-breakpoint
CREATE TYPE "public"."return_shipping_paid_by" AS ENUM('customer', 'company', 'free');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'under_review', 'approved', 'rejected', 'return_shipped', 'received', 'inspecting', 'approved_for_refund', 'refunded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('label_created', 'ready_to_ship', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'return_to_sender');--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'picking' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'packing' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'ready_to_ship' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'partially_shipped' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'in_transit' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'completed' BEFORE 'returned';--> statement-breakpoint
ALTER TYPE "public"."movement_reference" ADD VALUE 'return_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'ready_for_fulfillment';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'return_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'return_received';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'refund_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'delivery_failed';--> statement-breakpoint
CREATE TABLE "fulfillment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "fulfillment_status" NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"pick_status" "pick_status" DEFAULT 'pending' NOT NULL,
	"picked_quantity" integer DEFAULT 0 NOT NULL,
	"location_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_items_order_item_id_unique" UNIQUE("order_item_id"),
	CONSTRAINT "fulfillment_item_picked_qty_valid" CHECK ("fulfillment_items"."picked_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "package_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "package_item_qty_positive" CHECK ("package_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"package_number" integer NOT NULL,
	"weight_grams" integer,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"carrier" text,
	"service" text,
	"tracking_number" text,
	"tracking_url" text,
	"label_url" text,
	"status" "shipment_status" DEFAULT 'label_created' NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_request_id" uuid NOT NULL,
	"status" "return_status" NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_item_id" uuid NOT NULL,
	"condition" "return_condition" NOT NULL,
	"disposition" "return_disposition" NOT NULL,
	"notes" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inspected_by_user_id" uuid,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_inspections_return_item_id_unique" UNIQUE("return_item_id")
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_request_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" "return_reason" NOT NULL,
	"description" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exchange_requested" boolean DEFAULT false NOT NULL,
	"replacement_variant_id" uuid,
	"refund_amount_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_item_qty_positive" CHECK ("return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "return_status" DEFAULT 'requested' NOT NULL,
	"customer_notes" text,
	"internal_notes" text,
	"return_shipping_cost_cents" integer DEFAULT 0 NOT NULL,
	"return_shipping_paid_by" "return_shipping_paid_by" DEFAULT 'customer' NOT NULL,
	"return_tracking_number" text,
	"return_carrier" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_shipping_cost_non_negative" CHECK ("return_requests"."return_shipping_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" uuid NOT NULL,
	"status" "shipment_status" NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "return_request_id" uuid;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD COLUMN "min_order_cents" integer;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD COLUMN "max_order_cents" integer;--> statement-breakpoint
ALTER TABLE "fulfillment_events" ADD CONSTRAINT "fulfillment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_events" ADD CONSTRAINT "fulfillment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_events" ADD CONSTRAINT "return_events_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_events" ADD CONSTRAINT "return_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_return_item_id_return_items_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "public"."return_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_inspected_by_user_id_users_id_fk" FOREIGN KEY ("inspected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_replacement_variant_id_product_variants_id_fk" FOREIGN KEY ("replacement_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_events" ADD CONSTRAINT "shipping_events_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_events" ADD CONSTRAINT "shipping_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillment_events_order_idx" ON "fulfillment_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "package_items_package_idx" ON "package_items" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_items_order_item_idx" ON "package_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "packages_order_number_uq" ON "packages" USING btree ("order_id","package_number");--> statement-breakpoint
CREATE INDEX "packages_order_idx" ON "packages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "packages_tracking_idx" ON "packages" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "return_events_request_idx" ON "return_events" USING btree ("return_request_id");--> statement-breakpoint
CREATE INDEX "return_items_request_idx" ON "return_items" USING btree ("return_request_id");--> statement-breakpoint
CREATE INDEX "return_items_order_item_idx" ON "return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "return_requests_order_idx" ON "return_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "return_requests_customer_idx" ON "return_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "return_requests_status_idx" ON "return_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipping_events_package_idx" ON "shipping_events" USING btree ("package_id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_method_order_bounds_valid" CHECK ("shipping_methods"."min_order_cents" IS NULL OR "shipping_methods"."max_order_cents" IS NULL OR "shipping_methods"."min_order_cents" <= "shipping_methods"."max_order_cents");