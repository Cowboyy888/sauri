CREATE TYPE "public"."purchase_document_type" AS ENUM('quotation', 'invoice', 'packing_list', 'receiving_document', 'other');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_payment_status" AS ENUM('UNPAID', 'PARTIALLY_PAID', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."stocktake_status" AS ENUM('in_progress', 'pending_approval', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('ACTIVE', 'INACTIVE', 'BLOCKED');--> statement-breakpoint
CREATE SEQUENCE "public"."po_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "product_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"selling_price_cents" integer NOT NULL,
	"compare_at_price_cents" integer,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"url" text NOT NULL,
	"type" "purchase_document_type" DEFAULT 'other' NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"supplier_sku" text,
	"quantity" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"line_total_cents" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_item_qty_positive" CHECK ("purchase_order_items"."quantity" > 0),
	CONSTRAINT "purchase_order_item_cost_non_negative" CHECK ("purchase_order_items"."unit_cost_cents" >= 0),
	CONSTRAINT "purchase_order_item_line_math" CHECK ("purchase_order_items"."line_total_cents" = "purchase_order_items"."quantity" * "purchase_order_items"."unit_cost_cents" - "purchase_order_items"."discount_cents"),
	CONSTRAINT "purchase_order_item_received_valid" CHECK ("purchase_order_items"."received_quantity" >= 0 AND "purchase_order_items"."received_quantity" <= "purchase_order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"sent_by_user_id" uuid,
	"recipient_email" text NOT NULL,
	"succeeded" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text DEFAULT 'PO-' || extract(year from now()) || '-' || lpad(nextval('po_number_seq')::text, 6, '0') NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"payment_status" "purchase_payment_status" DEFAULT 'UNPAID' NOT NULL,
	"order_date" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_delivery_date" timestamp with time zone,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_terms" text,
	"notes" text DEFAULT '' NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"ordered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number"),
	CONSTRAINT "purchase_order_total_math" CHECK ("purchase_orders"."total_cents" = "purchase_orders"."subtotal_cents" - "purchase_orders"."discount_cents" + "purchase_orders"."shipping_cents" + "purchase_orders"."tax_cents"),
	CONSTRAINT "purchase_order_amounts_non_negative" CHECK ("purchase_orders"."subtotal_cents" >= 0 AND "purchase_orders"."discount_cents" >= 0 AND "purchase_orders"."shipping_cents" >= 0 AND "purchase_orders"."tax_cents" >= 0 AND "purchase_orders"."amount_paid_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_payment_positive" CHECK ("purchase_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"accepted_quantity" integer DEFAULT 0 NOT NULL,
	"damaged_quantity" integer DEFAULT 0 NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_item_quantities_non_negative" CHECK ("purchase_receipt_items"."accepted_quantity" >= 0 AND "purchase_receipt_items"."damaged_quantity" >= 0 AND "purchase_receipt_items"."rejected_quantity" >= 0),
	CONSTRAINT "purchase_receipt_item_has_quantity" CHECK ("purchase_receipt_items"."accepted_quantity" + "purchase_receipt_items"."damaged_quantity" + "purchase_receipt_items"."rejected_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"received_by_user_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"expected_quantity" integer NOT NULL,
	"counted_quantity" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktake_item_expected_non_negative" CHECK ("stocktake_items"."expected_quantity" >= 0),
	CONSTRAINT "stocktake_item_counted_non_negative" CHECK ("stocktake_items"."counted_quantity" IS NULL OR "stocktake_items"."counted_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"status" "stocktake_status" DEFAULT 'in_progress' NOT NULL,
	"started_by_user_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"supplier_sku" text,
	"purchase_price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"minimum_order_quantity" integer,
	"lead_time_days" integer,
	"preferred_supplier" boolean DEFAULT false NOT NULL,
	"last_purchase_price_cents" integer,
	"last_purchase_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_product_price_non_negative" CHECK ("supplier_products"."purchase_price_cents" >= 0),
	CONSTRAINT "supplier_product_moq_positive" CHECK ("supplier_products"."minimum_order_quantity" IS NULL OR "supplier_products"."minimum_order_quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "target_stock_level" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "style" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "canonical_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "care_instructions" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "contact_person" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "payment_terms" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "minimum_order_cents" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "status" "supplier_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_sends" ADD CONSTRAINT "purchase_order_sends_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_sends" ADD CONSTRAINT "purchase_order_sends_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_price_history_variant_idx" ON "product_price_history" USING btree ("variant_id","effective_at");--> statement-breakpoint
CREATE INDEX "purchase_documents_po_idx" ON "purchase_documents" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_po_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_variant_idx" ON "purchase_order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "purchase_order_sends_po_idx" ON "purchase_order_sends" USING btree ("purchase_order_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_payments_po_idx" ON "purchase_payments" USING btree ("purchase_order_id","paid_at");--> statement-breakpoint
CREATE INDEX "purchase_receipt_items_receipt_idx" ON "purchase_receipt_items" USING btree ("purchase_receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_items_po_item_idx" ON "purchase_receipt_items" USING btree ("purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_po_idx" ON "purchase_receipts" USING btree ("purchase_order_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_items_uq" ON "stocktake_items" USING btree ("stocktake_id","variant_id");--> statement-breakpoint
CREATE INDEX "stocktakes_location_idx" ON "stocktakes" USING btree ("location_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_products_uq" ON "supplier_products" USING btree ("supplier_id","variant_id");--> statement-breakpoint
CREATE INDEX "supplier_products_variant_idx" ON "supplier_products" USING btree ("variant_id");--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_target_stock_non_negative" CHECK ("inventory"."target_stock_level" IS NULL OR "inventory"."target_stock_level" >= 0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "supplier_lead_time_non_negative" CHECK ("suppliers"."lead_time_days" IS NULL OR "suppliers"."lead_time_days" >= 0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "supplier_min_order_non_negative" CHECK ("suppliers"."minimum_order_cents" IS NULL OR "suppliers"."minimum_order_cents" >= 0);