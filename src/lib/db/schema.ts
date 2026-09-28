/**
 * SAURI database schema (Drizzle ORM, PostgreSQL / Supabase).
 *
 * Conventions
 * - Money is stored as integer cents. Never floats.
 * - Every inventory change goes through `inventory_movements`; `inventory.on_hand`
 *   is only ever written by lib/inventory in the same transaction as the movement.
 * - Order lines snapshot the price AND the unit cost at the moment of sale, so
 *   later cost changes never rewrite historical profit.
 */
import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, serial,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ------------------------------------------------------------------ enums */
export const roleKey = pgEnum("role_key", ["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const orderStatus = pgEnum("order_status", ["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"]);
export const movementType = pgEnum("movement_type", ["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "MANUAL"]);
export const discountType = pgEnum("discount_type", ["percent", "fixed", "free_shipping"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded"]);
export const notificationType = pgEnum("notification_type", ["new_order", "large_order", "low_stock", "out_of_stock", "refund", "payment_failed", "review", "system"]);
export const reviewStatus = pgEnum("review_status", ["pending", "published", "hidden"]);

/* ------------------------------------------------------------ staff & auth */
export const roles = pgTable("roles", {
  key: roleKey("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: roleKey("role").notNull().references(() => roles.key),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

/* --------------------------------------------------------------- customers */
export const customers = pgTable("customers", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  authUserId: uuid("auth_user_id"), // Supabase auth.users id once registered
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("customers_email_uq").on(t.email),
  // Emails are stored lower-cased by the service layer; the DB enforces it.
  check("customers_email_lower", sql`${t.email} = lower(${t.email})`),
]);

export const addresses = pgTable("addresses", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
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
}, (t) => [index("addresses_customer_idx").on(t.customerId)]);

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
  status: productStatus("status").notNull().default("draft"),
  badge: text("badge"),
  compareAtCents: integer("compare_at_cents"),
  isNew: boolean("is_new").notNull().default(false),
  isBestSeller: boolean("is_best_seller").notNull().default(false),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  details: jsonb("details").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("products_category_idx").on(t.categoryId), index("products_status_idx").on(t.status)]);

export const productCollections = pgTable("product_collections", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.productId, t.collectionId] })]);

export const productImages = pgTable("product_images", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  alt: text("alt").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_images_product_idx").on(t.productId)]);

export const productVariants = pgTable("product_variants", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sku: text("sku").notNull().unique(),
  material: text("material").notNull(), // yg | wg | vm | ss
  size: text("size"),
  color: text("color"),
  gemstone: text("gemstone"),
  priceCents: integer("price_cents").notNull(),
  costCents: integer("cost_cents").notNull(),
  weightMg: integer("weight_mg").notNull().default(0), // milligrams, integer
  barcode: text("barcode"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("variants_product_idx").on(t.productId),
  check("variant_price_positive", sql`${t.priceCents} > 0`),
  check("variant_cost_non_negative", sql`${t.costCents} >= 0`),
]);

/* --------------------------------------------------------------- inventory */
export const inventory = pgTable("inventory", {
  variantId: uuid("variant_id").primaryKey().references(() => productVariants.id, { onDelete: "cascade" }),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(5),
  updatedAt: updatedAt(),
}, (t) => [
  // The database itself refuses negative stock, even if application code has a bug.
  check("inventory_on_hand_non_negative", sql`${t.onHand} >= 0`),
  check("inventory_reserved_valid", sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`),
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
  type: movementType("type").notNull(),
  quantity: integer("quantity").notNull(), // signed: -2 for a sale of 2
  before: integer("before").notNull(),
  after: integer("after").notNull(),
  unitCostCents: integer("unit_cost_cents"),
  reference: text("reference"), // ORD-10024, PO-4210
  orderId: uuid("order_id").references(() => orders.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  userId: uuid("user_id").references(() => users.id),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [
  index("movements_variant_idx").on(t.variantId, t.createdAt),
  index("movements_created_idx").on(t.createdAt),
  index("movements_order_idx").on(t.orderId),
  check("movement_math", sql`${t.after} = ${t.before} + ${t.quantity}`),
  check("movement_non_zero", sql`${t.quantity} <> 0`),
]);

/* ------------------------------------------------------------------ orders */
export const salesChannels = pgTable("sales_channels", {
  key: text("key").primaryKey(), // web, instagram, facebook, tiktok, store, wholesale, manual, other
  name: text("name").notNull(),
  feePercentBp: integer("fee_percent_bp").notNull().default(0), // basis points: 290 = 2.9%
  feeFixedCents: integer("fee_fixed_cents").notNull().default(0),
  shipsOrders: boolean("ships_orders").notNull().default(true), // we pay a carrier
  chargesShipping: boolean("charges_shipping").notNull().default(true), // customer pays shipping
});

export const orders = pgTable("orders", {
  id: id(),
  number: serial("number").notNull().unique(), // shown as ORD-10001
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  channel: text("channel").notNull().references(() => salesChannels.key),
  status: orderStatus("status").notNull().default("pending"),
  currency: text("currency").notNull().default("USD"),
  subtotalCents: integer("subtotal_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  shippingChargedCents: integer("shipping_charged_cents").notNull().default(0),
  shippingCostCents: integer("shipping_cost_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  paymentFeeCents: integer("payment_fee_cents").notNull().default(0),
  refundedCents: integer("refunded_cents").notNull().default(0),
  discountCode: text("discount_code"),
  expressShipping: boolean("express_shipping").notNull().default(false),
  shippingAddress: jsonb("shipping_address").$type<Record<string, string>>(),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  updatedAt: updatedAt(),
}, (t) => [
  index("orders_paid_at_idx").on(t.paidAt),
  index("orders_status_idx").on(t.status),
  index("orders_customer_idx").on(t.customerId),
  index("orders_channel_paid_idx").on(t.channel, t.paidAt),
  check("order_total_math", sql`${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} + ${t.shippingChargedCents} + ${t.taxCents}`),
]);

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  variantLabel: text("variant_label").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  personalization: jsonb("personalization").$type<{ initial?: string; engraving?: string }>(),
}, (t) => [
  index("order_items_order_idx").on(t.orderId),
  index("order_items_variant_idx").on(t.variantId),
  check("order_item_qty_positive", sql`${t.quantity} > 0`),
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
  providerRef: text("provider_ref"), // Stripe PaymentIntent id; never card data
  status: paymentStatus("status").notNull().default("pending"),
  amountCents: integer("amount_cents").notNull(),
  feeCents: integer("fee_cents").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("payments_order_idx").on(t.orderId), uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef)]);

export const refunds = pgTable("refunds", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  restocked: boolean("restocked").notNull().default(true),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("refunds_order_idx").on(t.orderId), index("refunds_created_idx").on(t.createdAt)]);

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

export const analyticsSnapshots = pgTable("analytics_snapshots", {
  day: text("day").notNull(), // YYYY-MM-DD in store time zone
  channel: text("channel").notNull(),
  orders: integer("orders").notNull(),
  units: integer("units").notNull(),
  grossCents: integer("gross_cents").notNull(),
  discountCents: integer("discount_cents").notNull(),
  refundCents: integer("refund_cents").notNull(),
  cogsCents: integer("cogs_cents").notNull(),
  feeCents: integer("fee_cents").notNull(),
  shippingCostCents: integer("shipping_cost_cents").notNull(),
  computedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.day, t.channel] })]);

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
  actor: text("actor").notNull(), // denormalized display name, kept if the user is removed
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
}, (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entity, t.entityId)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
