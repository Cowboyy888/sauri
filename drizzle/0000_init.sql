CREATE TYPE "public"."discount_type" AS ENUM('percent', 'fixed', 'free_shipping');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGED', 'LOST', 'TRANSFER', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_order', 'large_order', 'low_stock', 'out_of_stock', 'refund', 'payment_failed', 'review', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'published', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('OWNER', 'ADMIN', 'SALES', 'INVENTORY', 'VIEWER');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"day" text NOT NULL,
	"channel" text NOT NULL,
	"orders" integer NOT NULL,
	"units" integer NOT NULL,
	"gross_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"refund_cents" integer NOT NULL,
	"cogs_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"shipping_cost_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_snapshots_day_channel_pk" PRIMARY KEY("day","channel")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sku_prefix" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"auth_user_id" uuid,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_lower" CHECK ("customers"."email" = lower("customers"."email"))
);
--> statement-breakpoint
CREATE TABLE "discount_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discount_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "discount_type" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"category_id" uuid,
	"product_id" uuid,
	"min_subtotal_cents" integer DEFAULT 0 NOT NULL,
	"max_discount_cents" integer,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_percent_range" CHECK ("discounts"."type" <> 'percent' OR ("discounts"."value" > 0 AND "discounts"."value" <= 100))
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_on_hand_non_negative" CHECK ("inventory"."on_hand" >= 0),
	CONSTRAINT "inventory_reserved_valid" CHECK ("inventory"."reserved" >= 0 AND "inventory"."reserved" <= "inventory"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"before" integer NOT NULL,
	"after" integer NOT NULL,
	"unit_cost_cents" integer,
	"reference" text,
	"order_id" uuid,
	"supplier_id" uuid,
	"user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_math" CHECK ("inventory_movements"."after" = "inventory_movements"."before" + "inventory_movements"."quantity"),
	CONSTRAINT "movement_non_zero" CHECK ("inventory_movements"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reference" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"variant_label" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"personalization" jsonb,
	CONSTRAINT "order_item_qty_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"shipping_charged_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cost_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_fee_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"discount_code" text,
	"express_shipping" boolean DEFAULT false NOT NULL,
	"shipping_address" jsonb,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "order_total_math" CHECK ("orders"."total_cents" = "orders"."subtotal_cents" - "orders"."discount_cents" + "orders"."shipping_charged_cents" + "orders"."tax_cents")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_collections" (
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	CONSTRAINT "product_collections_product_id_collection_id_pk" PRIMARY KEY("product_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"material" text NOT NULL,
	"size" text,
	"color" text,
	"gemstone" text,
	"price_cents" integer NOT NULL,
	"cost_cents" integer NOT NULL,
	"weight_mg" integer DEFAULT 0 NOT NULL,
	"barcode" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "variant_price_positive" CHECK ("product_variants"."price_cents" > 0),
	CONSTRAINT "variant_cost_non_negative" CHECK ("product_variants"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"badge" text,
	"compare_at_cents" integer,
	"is_new" boolean DEFAULT false NOT NULL,
	"is_best_seller" boolean DEFAULT false NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"restocked" boolean DEFAULT true NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"rating" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_name" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rating_range" CHECK ("reviews"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" "role_key" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_channels" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fee_percent_bp" integer DEFAULT 0 NOT NULL,
	"fee_fixed_cents" integer DEFAULT 0 NOT NULL,
	"ships_orders" boolean DEFAULT true NOT NULL,
	"charges_shipping" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role_key" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlists_customer_id_product_id_pk" PRIMARY KEY("customer_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_sales_channels_key_fk" FOREIGN KEY ("channel") REFERENCES "public"."sales_channels"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_customer_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_uq" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "discount_usages_discount_customer_idx" ON "discount_usages" USING btree ("discount_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discounts_code_uq" ON "discounts" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "movements_variant_idx" ON "inventory_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "movements_created_idx" ON "inventory_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "movements_order_idx" ON "inventory_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_paid_at_idx" ON "orders" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_channel_paid_idx" ON "orders" USING btree ("channel","paid_at");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_created_idx" ON "refunds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));