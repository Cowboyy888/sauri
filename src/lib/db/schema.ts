/**
 * SAURI database schema (Drizzle ORM, PostgreSQL / Supabase). See docs/DATABASE_SCHEMA.md.
 *
 * Conventions
 * - Money is integer cents; column names end in `_cents`. Never floats.
 * - Stock lives in `inventory` (1:1 with a variant) and is only written by lib/inventory,
 *   in the same transaction as its `inventory_movements` row.
 * - Order items snapshot name, SKU, variant, price and cost at the moment of sale.
 */
import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, jsonb, numeric, pgEnum, pgSequence, pgTable, primaryKey, serial,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ------------------------------------------------------------------ enums */
export const roleKey = pgEnum("role_key", ["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const variantStatus = pgEnum("variant_status", ["active", "inactive"]);
export const orderStatus = pgEnum("order_status", ["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "paid", "refunded", "failed"]);
export const fulfillmentStatus = pgEnum("fulfillment_status", ["unfulfilled", "processing", "shipped", "delivered", "returned", "cancelled"]);
export const movementType = pgEnum("movement_type", ["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "MANUAL", "RESTOCK"]);
export const movementReference = pgEnum("movement_reference", ["order", "refund", "purchase_order", "stock_count", "opening_balance", "transfer"]);
export const discountType = pgEnum("discount_type", ["percent", "fixed", "free_shipping"]);
export const paymentRecordStatus = pgEnum("payment_record_status", ["pending", "succeeded", "failed", "refunded"]);
export const notificationType = pgEnum("notification_type", ["new_order", "large_order", "low_stock", "out_of_stock", "refund", "payment_failed", "review", "system"]);
export const reviewStatus = pgEnum("review_status", ["pending", "published", "hidden"]);
export const addressType = pgEnum("address_type", ["shipping", "billing"]);

export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 10001 });

/* ------------------------------------------------------------ staff & auth */
export const roles = pgTable("roles", {
  key: roleKey("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
});

export const users = pgTable("users", {
  id: id(),
  authUserId: uuid("auth_user_id").unique(), // Supabase auth.users.id
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: roleKey("role").notNull().references(() => roles.key),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email), check("users_email_lower", sql`${t.email} = lower(${t.email})`)]);

/* --------------------------------------------------------------- customers */
export const customers = pgTable("customers", {
  id: id(),
  userId: uuid("user_id").unique(), // Supabase auth.users.id once the customer registers; guests have none
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("customers_email_uq").on(t.email), check("customers_email_lower", sql`${t.email} = lower(${t.email})`)]);

export const customerAddresses = pgTable("customer_addresses", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  type: addressType("type").notNull().default("shipping"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull(),
  phone: text("phone"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("customer_addresses_customer_idx").on(t.customerId)]);

/* ----------------------------------------------------------------- catalog */
export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  skuPrefix: text("sku_prefix").notNull(),
  position: integer("position").notNull().default(0),
});

export const collections = pgTable("collections", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
});

export const products = pgTable("products", {
  id: id(),
  slug: text("slug").notNull().unique(),
  code: text("code").notNull().unique(), // middle part of every SKU, e.g. AUR
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull().default(""),
  description: text("description").notNull().default(""),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
  status: productStatus("status").notNull().default("draft"),
  featured: boolean("featured").notNull().default(false),
  bestSeller: boolean("best_seller").notNull().default(false),
  newArrival: boolean("new_arrival").notNull().default(false),
  badge: text("badge"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  details: jsonb("details").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("products_category_idx").on(t.categoryId),
  index("products_collection_idx").on(t.collectionId),
  index("products_status_idx").on(t.status),
]);

export const productImages = pgTable("product_images", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  url: text("url").notNull(), // Supabase Storage public URL
  alt: text("alt").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_images_product_idx").on(t.productId, t.position)]);

export const productVariants = pgTable("product_variants", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sku: text("sku").notNull().unique(),
  barcode: text("barcode"),
  material: text("material").notNull(), // yg | wg | vm | ss
  color: text("color"),
  size: text("size"),
  gemstone: text("gemstone"),
  costPriceCents: integer("cost_price_cents").notNull(),
  sellingPriceCents: integer("selling_price_cents").notNull(),
  compareAtPriceCents: integer("compare_at_price_cents"),
  weightMg: integer("weight_mg").notNull().default(0),
  status: variantStatus("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("variants_product_idx").on(t.productId),
  index("variants_barcode_idx").on(t.barcode),
  check("variant_price_positive", sql`${t.sellingPriceCents} > 0`),
  check("variant_cost_non_negative", sql`${t.costPriceCents} >= 0`),
  check("variant_compare_at_above_price", sql`${t.compareAtPriceCents} IS NULL OR ${t.compareAtPriceCents} > ${t.sellingPriceCents}`),
]);

/* --------------------------------------------------------------- inventory */
/** 1:1 with product_variants. Separate table so catalog edits never contend with checkout row locks. */
export const inventory = pgTable("inventory", {
  variantId: uuid("variant_id").primaryKey().references(() => productVariants.id, { onDelete: "cascade" }),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(5),
  updatedAt: updatedAt(),
}, (t) => [
  // The database refuses impossible stock even if application code has a bug.
  check("inventory_stock_non_negative", sql`${t.stockQuantity} >= 0`),
  check("inventory_reserved_valid", sql`${t.reservedQuantity} >= 0 AND ${t.reservedQuantity} <= ${t.stockQuantity}`),
  check("inventory_reorder_non_negative", sql`${t.reorderLevel} >= 0`),
  // "Inventory status" index: finds low/out-of-stock rows without scanning healthy ones.
  index("inventory_needs_attention_idx").on(t.variantId).where(sql`${t.stockQuantity} - ${t.reservedQuantity} <= ${t.reorderLevel}`),
]);

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull().unique(),
  email: text("email"),
  phone: text("phone"),
  createdAt: createdAt(),
});

export const inventoryMovements = pgTable("inventory_movements", {
  id: serial("id").primaryKey(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id),
  movementType: movementType("movement_type").notNull(),
  quantity: integer("quantity").notNull(), // signed: -2 for a sale of 2
  stockBefore: integer("stock_before").notNull(),
  stockAfter: integer("stock_after").notNull(),
  referenceType: movementReference("reference_type"),
  referenceId: text("reference_id"), // ORD-10024, PO-4210, …
  orderId: uuid("order_id").references(() => orders.id), // FK kept for integrity and fast joins
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  unitCostCents: integer("unit_cost_cents"),
  userId: uuid("user_id").references(() => users.id),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [
  index("movements_variant_idx").on(t.variantId, t.createdAt),
  index("movements_created_idx").on(t.createdAt),
  index("movements_order_idx").on(t.orderId),
  index("movements_reference_idx").on(t.referenceType, t.referenceId),
  check("movement_math", sql`${t.stockAfter} = ${t.stockBefore} + ${t.quantity}`),
  check("movement_non_zero", sql`${t.quantity} <> 0`),
]);

/* ------------------------------------------------------------------ orders */
export const salesChannels = pgTable("sales_channels", {
  id: id(),
  code: text("code").notNull().unique(), // WEBSITE, INSTAGRAM, FACEBOOK, TIKTOK, PHYSICAL_STORE, WHOLESALE, MANUAL_ORDER, OTHER
  name: text("name").notNull(),
  feePercentBp: integer("fee_percent_bp").notNull().default(0), // 290 = 2.9%
  feeFixedCents: integer("fee_fixed_cents").notNull().default(0),
  shipsOrders: boolean("ships_orders").notNull().default(true), // we pay a carrier
  chargesShipping: boolean("charges_shipping").notNull().default(true), // customer pays shipping
  active: boolean("active").notNull().default(true),
});

export const orders = pgTable("orders", {
  id: id(),
  orderNumber: text("order_number").notNull().unique().default(sql`'ORD-' || nextval('order_number_seq')`),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  channelId: uuid("channel_id").notNull().references(() => salesChannels.id),
  status: orderStatus("status").notNull().default("pending"),
  paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
  fulfillmentStatus: fulfillmentStatus("fulfillment_status").notNull().default("unfulfilled"),
  currency: text("currency").notNull().default("USD"),
  // Customer-facing amounts
  subtotalCents: integer("subtotal_cents").notNull(), // Σ quantity × unit price, before discounts
  discountTotalCents: integer("discount_total_cents").notNull().default(0),
  shippingTotalCents: integer("shipping_total_cents").notNull().default(0), // charged to the customer
  taxTotalCents: integer("tax_total_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  refundTotalCents: integer("refund_total_cents").notNull().default(0),
  // Profit snapshot, maintained by lib/orders (see docs/BUSINESS_LOGIC.md)
  costTotalCents: integer("cost_total_cents").notNull().default(0), // COGS recognized for this order
  grossProfitCents: integer("gross_profit_cents").notNull().default(0), // net revenue − COGS
  grossMargin: numeric("gross_margin", { precision: 7, scale: 2, mode: "number" }).notNull().default(0), // percent
  // Internal costs (not charged to the customer) used for contribution profit
  paymentFeeCents: integer("payment_fee_cents").notNull().default(0),
  shippingCostCents: integer("shipping_cost_cents").notNull().default(0),
  discountCode: text("discount_code"),
  expressShipping: boolean("express_shipping").notNull().default(false),
  shippingAddress: jsonb("shipping_address").$type<Record<string, string>>(),
  billingAddress: jsonb("billing_address").$type<Record<string, string>>(),
  notes: text("notes"),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("orders_paid_at_idx").on(t.paidAt),
  index("orders_placed_at_idx").on(t.placedAt),
  index("orders_status_idx").on(t.status),
  index("orders_payment_status_idx").on(t.paymentStatus),
  index("orders_customer_idx").on(t.customerId),
  index("orders_channel_paid_idx").on(t.channelId, t.paidAt),
  check("order_total_math", sql`${t.totalCents} = ${t.subtotalCents} - ${t.discountTotalCents} + ${t.shippingTotalCents} + ${t.taxTotalCents}`),
  check("order_profit_math", sql`${t.grossProfitCents} = ${t.subtotalCents} - ${t.discountTotalCents} - ${t.refundTotalCents} - ${t.costTotalCents}`),
  check("order_refund_bounds", sql`${t.refundTotalCents} >= 0 AND ${t.refundTotalCents} <= ${t.subtotalCents} - ${t.discountTotalCents}`),
]);

export type VariantSnapshot = { material: string; size: string | null; color: string | null; gemstone: string | null; label: string };

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  skuSnapshot: text("sku_snapshot").notNull(),
  variantSnapshot: jsonb("variant_snapshot").$type<VariantSnapshot>().notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0), // this line's share of the order discount
  lineTotalCents: integer("line_total_cents").notNull(), // quantity × unit price − discount
  lineCostCents: integer("line_cost_cents").notNull(), // quantity × unit cost
  lineProfitCents: integer("line_profit_cents").notNull(), // line total − line cost
  personalization: jsonb("personalization").$type<{ initial?: string; engraving?: string }>(),
  createdAt: createdAt(),
}, (t) => [
  index("order_items_order_idx").on(t.orderId),
  index("order_items_variant_idx").on(t.variantId),
  index("order_items_product_idx").on(t.productId),
  check("order_item_qty_positive", sql`${t.quantity} > 0`),
  check("order_item_line_math", sql`${t.lineTotalCents} = ${t.quantity} * ${t.unitPriceCents} - ${t.discountCents} AND ${t.lineCostCents} = ${t.quantity} * ${t.unitCostCents} AND ${t.lineProfitCents} = ${t.lineTotalCents} - ${t.lineCostCents}`),
]);

export const orderEvents = pgTable("order_events", {
  id: serial("id").primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status: orderStatus("status").notNull(),
  note: text("note"),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("order_events_order_idx").on(t.orderId)]);

export const payments = pgTable("payments", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // stripe | cash | card_terminal | bank_transfer | manual
  providerRef: text("provider_ref"), // e.g. Stripe PaymentIntent id. Never card data.
  status: paymentRecordStatus("status").notNull().default("pending"),
  amountCents: integer("amount_cents").notNull(),
  feeCents: integer("fee_cents").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("payments_order_idx").on(t.orderId), uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef)]);

export const refunds = pgTable("refunds", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").references(() => payments.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  restocked: boolean("restocked").notNull().default(true),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("refunds_order_idx").on(t.orderId), index("refunds_created_idx").on(t.createdAt), check("refund_positive", sql`${t.amountCents} > 0`)]);

/* --------------------------------------------------------------- discounts */
export const discounts = pgTable("discounts", {
  id: id(),
  code: text("code").notNull(),
  type: discountType("type").notNull(),
  value: integer("value").notNull().default(0), // percent (10 = 10%) or cents
  categoryId: uuid("category_id").references(() => categories.id),
  productId: uuid("product_id").references(() => products.id),
  minSubtotalCents: integer("min_subtotal_cents").notNull().default(0),
  maxDiscountCents: integer("max_discount_cents"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  usageLimit: integer("usage_limit"),
  perCustomerLimit: integer("per_customer_limit"),
  usedCount: integer("used_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("discounts_code_uq").on(sql`upper(${t.code})`),
  check("discount_percent_range", sql`${t.type} <> 'percent' OR (${t.value} > 0 AND ${t.value} <= 100)`),
]);

export const discountUsages = pgTable("discount_usages", {
  id: id(),
  discountId: uuid("discount_id").notNull().references(() => discounts.id),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  amountCents: integer("amount_cents").notNull(),
  createdAt: createdAt(),
}, (t) => [index("discount_usages_discount_customer_idx").on(t.discountId, t.customerId)]);

/* ------------------------------------------------ wishlists, reviews, etc. */
export const wishlists = pgTable("wishlists", {
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.customerId, t.productId] })]);

export const reviews = pgTable("reviews", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id),
  orderId: uuid("order_id").references(() => orders.id),
  rating: integer("rating").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorName: text("author_name").notNull(),
  status: reviewStatus("status").notNull().default("pending"),
  createdAt: createdAt(),
}, (t) => [index("reviews_product_idx").on(t.productId, t.status), check("review_rating_range", sql`${t.rating} BETWEEN 1 AND 5`)]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  type: notificationType("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  reference: text("reference"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notifications_created_idx").on(t.createdAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  actor: text("actor").notNull(), // display name, kept if the user is later removed
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  createdAt: createdAt(),
}, (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entity, t.entityId)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
