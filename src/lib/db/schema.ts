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
  text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ------------------------------------------------------------------ enums */
export const roleKey = pgEnum("role_key", ["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const variantStatus = pgEnum("variant_status", ["active", "inactive"]);
export const orderStatus = pgEnum("order_status", ["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "paid", "refunded", "failed", "partially_refunded"]);
// Phase 5 adds the operational stages between "processing" and "shipped", plus "partially_shipped" (some
// but not all packages shipped), "in_transit" and "completed" (post-delivery, e.g. return window closed).
export const fulfillmentStatus = pgEnum("fulfillment_status", ["unfulfilled", "processing", "picking", "packing", "ready_to_ship", "partially_shipped", "shipped", "in_transit", "delivered", "completed", "returned", "cancelled"]);
export const movementType = pgEnum("movement_type", ["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "MANUAL", "RESTOCK"]);
export const movementReference = pgEnum("movement_reference", ["order", "refund", "purchase_order", "stock_count", "opening_balance", "transfer", "return_request"]);
export const discountType = pgEnum("discount_type", ["percent", "fixed", "free_shipping"]);
export const paymentRecordStatus = pgEnum("payment_record_status", ["pending", "succeeded", "failed", "refunded"]);
export const notificationType = pgEnum("notification_type", ["new_order", "large_order", "low_stock", "out_of_stock", "refund", "payment_failed", "review", "system", "ready_for_fulfillment", "return_requested", "return_received", "refund_requested", "delivery_failed"]);
// Phase 6 adds "rejected", distinct from "hidden": rejected means a moderator declined it outright (never
// published); hidden means it was published and later taken down. "published" is kept as the name for the
// approved state (renaming a live enum value is unnecessarily risky) — see docs/REVIEWS.md.
export const reviewStatus = pgEnum("review_status", ["pending", "published", "rejected", "hidden"]);
export const addressType = pgEnum("address_type", ["shipping", "billing"]);

/* ------------------------------------------------------------ Phase 5 enums */
export const pickStatus = pgEnum("pick_status", ["pending", "picked", "missing", "damaged"]);
export const shipmentStatus = pgEnum("shipment_status", ["label_created", "ready_to_ship", "shipped", "in_transit", "out_for_delivery", "delivered", "delivery_failed", "return_to_sender"]);
export const returnStatus = pgEnum("return_status", ["requested", "under_review", "approved", "rejected", "return_shipped", "received", "inspecting", "approved_for_refund", "refunded", "closed"]);
export const returnReason = pgEnum("return_reason", ["wrong_size", "changed_mind", "damaged", "defective", "wrong_item", "not_as_expected", "other"]);
export const returnShippingPaidBy = pgEnum("return_shipping_paid_by", ["customer", "company", "free"]);
export const returnCondition = pgEnum("return_condition", ["new", "like_new", "used", "damaged", "defective", "unsellable"]);
export const returnDisposition = pgEnum("return_disposition", ["restock", "repair", "damaged", "dispose", "return_to_customer"]);

/* ------------------------------------------------------------ Phase 6 enums */
/** How a customer found the brand — captured once (first touch) and again on every order (last touch);
 *  see docs/CRM.md. Distinct from `sales_channels`, which describes how an *order* was transacted. */
export const acquisitionSource = pgEnum("acquisition_source", ["WEBSITE", "INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE", "REFERRAL", "PHYSICAL_STORE", "WHOLESALE", "DIRECT", "OTHER"]);
export const communicationType = pgEnum("communication_type", ["email", "sms", "call", "whatsapp", "telegram", "note"]);
export const consentType = pgEnum("consent_type", ["email_marketing", "sms_marketing"]);
export const abandonedCartStatus = pgEnum("abandoned_cart_status", ["active", "abandoned", "recovered", "expired"]);
export const loyaltyTransactionType = pgEnum("loyalty_transaction_type", ["EARN", "REDEEM", "REFUND_REVERSAL", "ADJUSTMENT", "EXPIRATION", "BONUS"]);
export const loyaltyRedemptionStatus = pgEnum("loyalty_redemption_status", ["issued", "used", "expired", "cancelled"]);

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
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false), // email marketing consent — the newsletter signup box sets this; see customer_consents for the audited history
  smsMarketingConsent: boolean("sms_marketing_consent").notNull().default(false),
  consentUpdatedAt: timestamp("consent_updated_at", { withTimezone: true }),
  consentSource: text("consent_source"), // e.g. "newsletter_signup", "checkout", "account_settings"
  /** Category toggles for *marketing* email only (brief §17) — order/shipping/returns confirmations are
   *  transactional and never gated by this. Keys: promotions, newArrivals, backInStock, loyalty. */
  emailPreferences: jsonb("email_preferences").$type<Record<string, boolean>>().notNull().default({}),
  // First-touch is set once and never overwritten; last-touch updates on every order (brief §8).
  firstTouchSource: acquisitionSource("first_touch_source"),
  firstTouchDetails: jsonb("first_touch_details").$type<{ utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; referrer?: string }>(),
  firstVisitAt: timestamp("first_visit_at", { withTimezone: true }),
  lastTouchSource: acquisitionSource("last_touch_source"),
  lastTouchDetails: jsonb("last_touch_details").$type<{ utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; referrer?: string }>(),
  // Privacy (brief §37): anonymizing replaces PII in place and stops the row being treated as a live
  // person, but never deletes it — orders/refunds/audit history must survive. Merging (brief §36) instead
  // points this row at the surviving customer; both are mutually exclusive terminal states.
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  mergedIntoCustomerId: uuid("merged_into_customer_id").references((): AnyPgColumn => customers.id),
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

/** Prepares the system for warehouse locations (brief §6) — a reference table and an optional pick
 *  location on `fulfillment_items`, not a rewrite of the stock model into per-location ledgers. */
export const inventoryLocations = pgTable("inventory_locations", {
  id: id(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(), // MAIN, DISPLAY, PACKING, DAMAGED, RETURNS
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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

/** Configurable shipping options offered at checkout (brief §26). Not wired into a carrier — a flat
 *  price and an estimated window, editable by staff later without a code change. */
export const shippingMethods = pgTable("shipping_methods", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  estimatedMinDays: integer("estimated_min_days").notNull(),
  estimatedMaxDays: integer("estimated_max_days").notNull(),
  /** Waived when the order (after discount) is at or above STORE.freeShippingThresholdCents — matches the
   *  Phase 1 "standard" behavior; express/local/pickup methods are never waived this way. */
  waivableAboveThreshold: boolean("waivable_above_threshold").notNull().default(false),
  carrierCostCents: integer("carrier_cost_cents").notNull().default(0), // what we pay the carrier (internal)
  // Phase 5 (brief §15): restrict a method by geography or order value. Null = no restriction.
  countryCode: text("country_code"), // ISO 3166-1 alpha-2; null = all countries
  region: text("region"), // free-text state/province match; null = all regions within the country
  minOrderCents: integer("min_order_cents"),
  maxOrderCents: integer("max_order_cents"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("shipping_method_price_non_negative", sql`${t.priceCents} >= 0`),
  check("shipping_method_order_bounds_valid", sql`${t.minOrderCents} IS NULL OR ${t.maxOrderCents} IS NULL OR ${t.minOrderCents} <= ${t.maxOrderCents}`),
]);

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
  shippingMethodId: uuid("shipping_method_id").references(() => shippingMethods.id),
  trackingNumber: text("tracking_number"),
  carrier: text("carrier"),
  /** Only set on pending web orders. Past this time, the reservation may be released even though the
   *  customer never explicitly cancelled (brief §30) — checked by the webhook (checkout.session.expired)
   *  and, as a safety net, a sweep that is safe to run repeatedly. */
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
  shippingAddress: jsonb("shipping_address").$type<Record<string, string>>(),
  billingAddress: jsonb("billing_address").$type<Record<string, string>>(),
  notes: text("notes"), // from the customer at checkout
  internalNotes: text("internal_notes"), // staff-only, never shown to the customer
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

/**
 * The fulfillment-status timeline (brief §35) — same shape as `order_events`, for the *other* status
 * dimension (fulfillment_status can move through picking/packing/ready_to_ship without `orders.status`
 * changing at all, so it can't reuse order_events, whose `status` column is typed to the order_status enum).
 */
export const fulfillmentEvents = pgTable("fulfillment_events", {
  id: serial("id").primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status: fulfillmentStatus("status").notNull(),
  note: text("note"),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("fulfillment_events_order_idx").on(t.orderId)]);

/** One row per order_item once fulfillment starts — the picking list (brief §5). Deliberately not columns
 *  on order_items: order_items is an immutable financial snapshot (brief §42); this is mutable operational
 *  state with its own lifecycle. */
export const fulfillmentItems = pgTable("fulfillment_items", {
  id: id(),
  orderItemId: uuid("order_item_id").notNull().unique().references(() => orderItems.id, { onDelete: "cascade" }),
  pickStatus: pickStatus("pick_status").notNull().default("pending"),
  pickedQuantity: integer("picked_quantity").notNull().default(0),
  locationId: uuid("location_id").references(() => inventoryLocations.id),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check("fulfillment_item_picked_qty_valid", sql`${t.pickedQuantity} >= 0`)]);

/** A shippable unit. An order can have more than one (brief §40); `orders.fulfillment_status` becomes
 *  "partially_shipped" until every package for that order reaches "shipped" or later. */
export const packages = pgTable("packages", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  packageNumber: integer("package_number").notNull(), // 1, 2, 3… within the order
  weightGrams: integer("weight_grams"),
  lengthMm: integer("length_mm"),
  widthMm: integer("width_mm"),
  heightMm: integer("height_mm"),
  carrier: text("carrier"),
  service: text("service"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  labelUrl: text("label_url"),
  status: shipmentStatus("status").notNull().default("label_created"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("packages_order_number_uq").on(t.orderId, t.packageNumber),
  index("packages_order_idx").on(t.orderId),
  index("packages_tracking_idx").on(t.trackingNumber),
]);

export const packageItems = pgTable("package_items", {
  id: id(),
  packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
}, (t) => [
  index("package_items_package_idx").on(t.packageId),
  index("package_items_order_item_idx").on(t.orderItemId),
  check("package_item_qty_positive", sql`${t.quantity} > 0`),
]);

/** Per-package carrier-status timeline — the third, genuinely distinct dimension (order lifecycle,
 *  order-level fulfillment stage, and now per-package shipping status each get their own history). */
export const shippingEvents = pgTable("shipping_events", {
  id: serial("id").primaryKey(),
  packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  status: shipmentStatus("status").notNull(),
  note: text("note"),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("shipping_events_package_idx").on(t.packageId)]);

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

/**
 * Webhook idempotency (brief §12). A row here means "this provider event has already been fully
 * processed" — checked with an INSERT ... ON CONFLICT DO NOTHING before any side effect runs, so a
 * redelivered webhook is a no-op at the database level, independent of the order-state idempotency
 * `markOrderPaid` already has (belt and suspenders: either one alone would prevent a duplicate order).
 */
export const paymentEvents = pgTable("payment_events", {
  id: id(),
  provider: text("provider").notNull(), // stripe
  providerEventId: text("provider_event_id").notNull(),
  type: text("type").notNull(), // e.g. checkout.session.completed
  orderId: uuid("order_id").references(() => orders.id),
  payload: jsonb("payload"),
  processedAt: createdAt(),
}, (t) => [uniqueIndex("payment_events_provider_event_uq").on(t.provider, t.providerEventId), index("payment_events_order_idx").on(t.orderId)]);

export const refunds = pgTable("refunds", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").references(() => payments.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  restocked: boolean("restocked").notNull().default(true),
  returnRequestId: uuid("return_request_id").references(() => returnRequests.id), // set when a refund came from an approved return (Phase 5)
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
  // Phase 6: set when this code was issued by redeeming a loyalty reward — only that customer may ever
  // use it (validateDiscount checks this), so a leaked code is useless to anyone else. Null for every
  // ordinary admin-created discount.
  restrictedToCustomerId: uuid("restricted_to_customer_id").references(() => customers.id),
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
}, (t) => [
  index("reviews_product_idx").on(t.productId, t.status),
  check("review_rating_range", sql`${t.rating} BETWEEN 1 AND 5`),
  // One review per product per order (brief §20) — only enforced once a customer/order is actually known;
  // legacy/seeded reviews with no customer or order attached are exempt.
  uniqueIndex("reviews_one_per_order_product_uq").on(t.customerId, t.orderId, t.productId).where(sql`${t.customerId} is not null and ${t.orderId} is not null`),
]);

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

/* ---------------------------------------------------------- returns (Phase 5) */
/** One customer return request, possibly covering several lines of the same order (brief §19). */
export const returnRequests = pgTable("return_requests", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  status: returnStatus("status").notNull().default("requested"),
  customerNotes: text("customer_notes"),
  internalNotes: text("internal_notes"), // staff-only, never shown to the customer — same convention as orders.internal_notes
  returnShippingCostCents: integer("return_shipping_cost_cents").notNull().default(0),
  returnShippingPaidBy: returnShippingPaidBy("return_shipping_paid_by").notNull().default("customer"),
  returnTrackingNumber: text("return_tracking_number"),
  returnCarrier: text("return_carrier"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("return_requests_order_idx").on(t.orderId),
  index("return_requests_customer_idx").on(t.customerId),
  index("return_requests_status_idx").on(t.status),
  check("return_shipping_cost_non_negative", sql`${t.returnShippingCostCents} >= 0`),
]);

/** One line of a return request — a quantity of one order_item, with its own reason and (optionally) an
 *  exchange request. A partial return is just a return_item whose quantity is less than the order_item's. */
export const returnItems = pgTable("return_items", {
  id: id(),
  returnRequestId: uuid("return_request_id").notNull().references(() => returnRequests.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id),
  quantity: integer("quantity").notNull(),
  reason: returnReason("reason").notNull(),
  description: text("description"),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  exchangeRequested: boolean("exchange_requested").notNull().default(false),
  replacementVariantId: uuid("replacement_variant_id").references(() => productVariants.id),
  refundAmountCents: integer("refund_amount_cents"), // set once approved for refund; null until then
  createdAt: createdAt(),
}, (t) => [
  index("return_items_request_idx").on(t.returnRequestId),
  index("return_items_order_item_idx").on(t.orderItemId),
  check("return_item_qty_positive", sql`${t.quantity} > 0`),
]);

/** At most one inspection per return_item — re-inspecting means updating this row, not adding a second. */
export const returnInspections = pgTable("return_inspections", {
  id: id(),
  returnItemId: uuid("return_item_id").notNull().unique().references(() => returnItems.id, { onDelete: "cascade" }),
  condition: returnCondition("condition").notNull(),
  disposition: returnDisposition("disposition").notNull(),
  notes: text("notes"),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  inspectedByUserId: uuid("inspected_by_user_id").references(() => users.id),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

/** The return-status timeline — same shape as order_events/fulfillment_events, for the return dimension. */
export const returnEvents = pgTable("return_events", {
  id: serial("id").primaryKey(),
  returnRequestId: uuid("return_request_id").notNull().references(() => returnRequests.id, { onDelete: "cascade" }),
  status: returnStatus("status").notNull(),
  note: text("note"),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("return_events_request_idx").on(t.returnRequestId)]);

/* ---------------------------------------------------------------- CRM (Phase 6) */
/** Configurable tags (brief §10) — never hardcoded; an admin creates "VIP", "Wholesale", etc. themselves. */
export const customerTags = pgTable("customer_tags", {
  id: id(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("customer_tags_name_uq").on(sql`lower(${t.name})`)]);

export const customerTagAssignments = pgTable("customer_tag_assignments", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => customerTags.id, { onDelete: "cascade" }),
  assignedByUserId: uuid("assigned_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("customer_tag_assignments_uq").on(t.customerId, t.tagId), index("customer_tag_assignments_tag_idx").on(t.tagId)]);

/** Internal, staff-only notes (brief §11) — never shown to the customer, same convention as orders.internal_notes. */
export const customerNotes = pgTable("customer_notes", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").references(() => users.id),
  note: text("note").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("customer_notes_customer_idx").on(t.customerId)]);

/** Manually-logged communication history (brief §12) — never an automated send; each row is staff recording
 *  that a call/email/message happened, or a quick internal note pinned to the timeline. */
export const customerCommunications = pgTable("customer_communications", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  type: communicationType("type").notNull(),
  subject: text("subject"),
  message: text("message").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("customer_communications_customer_idx").on(t.customerId, t.createdAt)]);

/** Append-only consent history (brief §16, §43) — the *current* state lives on `customers` for fast reads
 *  (`marketing_opt_in`, `sms_marketing_consent`); every change is also logged here so consent can be
 *  audited and never silently assumed. */
export const customerConsents = pgTable("customer_consents", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  type: consentType("type").notNull(),
  consent: boolean("consent").notNull(),
  source: text("source").notNull(), // e.g. "newsletter_signup", "checkout", "account_settings", "admin"
  createdAt: createdAt(),
}, (t) => [index("customer_consents_customer_idx").on(t.customerId, t.createdAt)]);

/** A history of wishlist adds/removes (brief §18) — the `wishlists` table itself only ever reflects the
 *  *current* wishlist; this is purely additive logging alongside it, never a second source of truth. */
export const wishlistEvents = pgTable("wishlist_events", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // "added" | "removed"
  createdAt: createdAt(),
}, (t) => [index("wishlist_events_customer_idx").on(t.customerId, t.createdAt), check("wishlist_event_action_valid", sql`${t.action} in ('added','removed')`)]);

/** Abandoned-cart tracking architecture (brief §19). Scoped to signed-in customers only — the cart itself
 *  is client-only (localStorage) and there is no server-side anonymous cart to mirror; see docs/CRM.md. */
export const abandonedCarts = pgTable("abandoned_carts", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  items: jsonb("items").$type<{ variantId: string; quantity: number; unitPriceCents: number; name: string }[]>().notNull(),
  cartValueCents: integer("cart_value_cents").notNull().default(0),
  status: abandonedCartStatus("status").notNull().default("active"),
  recoveredOrderId: uuid("recovered_order_id").references(() => orders.id),
  createdAt: createdAt(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("abandoned_carts_customer_uq").on(t.customerId), index("abandoned_carts_status_idx").on(t.status, t.lastActivityAt)]);

/** "Notify me when available" (brief §40). One subscription per (customer, variant) at a time — a second
 *  request while one is still pending is a no-op (`onConflictDoNothing`), not a duplicate row. */
export const stockNotifications = pgTable("stock_notifications", {
  id: id(),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("stock_notifications_uq").on(t.email, t.variantId), index("stock_notifications_variant_idx").on(t.variantId, t.notifiedAt)]);

/** Structured moderation history for a review (brief §22) — a `status` column alone can't say who changed
 *  it, from what, or why; this is that history, parallel to the generic audit log but queryable per-review. */
export const reviewModerationEvents = pgTable("review_moderation_events", {
  id: id(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  fromStatus: reviewStatus("from_status").notNull(),
  toStatus: reviewStatus("to_status").notNull(),
  note: text("note"),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("review_moderation_events_review_idx").on(t.reviewId)]);

/* ------------------------------------------------------------ Loyalty (Phase 6) */
/** One row per enrolled customer. The balance is a cached total; every change to it is required to also
 *  write a `loyalty_transactions` row in the same transaction — never updated directly (brief §25). */
export const loyaltyAccounts = pgTable("loyalty_accounts", {
  id: id(),
  customerId: uuid("customer_id").notNull().unique().references(() => customers.id, { onDelete: "cascade" }),
  pointsBalance: integer("points_balance").notNull().default(0),
  lifetimePointsEarned: integer("lifetime_points_earned").notNull().default(0),
  lifetimePointsRedeemed: integer("lifetime_points_redeemed").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check("loyalty_balance_non_negative", sql`${t.pointsBalance} >= 0`)]);

export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: id(),
  accountId: uuid("account_id").notNull().references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
  type: loyaltyTransactionType("type").notNull(),
  points: integer("points").notNull(), // signed: positive for EARN/BONUS/REFUND_REVERSAL-that-adds-back, negative for REDEEM/EXPIRATION/adjustments-down
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  referenceType: text("reference_type"), // "order" | "return_request" | "redemption" | "admin"
  referenceId: text("reference_id"),
  reason: text("reason"),
  userId: uuid("user_id").references(() => users.id), // set for a manual ADJUSTMENT; null for system-driven rows
  createdAt: createdAt(),
}, (t) => [
  index("loyalty_transactions_account_idx").on(t.accountId, t.createdAt),
  check("loyalty_transaction_points_non_zero", sql`${t.points} <> 0`),
  check("loyalty_transaction_balance_math", sql`${t.balanceAfter} = ${t.balanceBefore} + ${t.points}`),
]);

/** Configurable tiers (brief §26) — name, minimum spend and benefits are all admin-editable, never hardcoded. */
export const loyaltyTiers = pgTable("loyalty_tiers", {
  id: id(),
  name: text("name").notNull().unique(),
  minSpendCents: integer("min_spend_cents").notNull().default(0),
  benefits: jsonb("benefits").$type<{ bonusPointsMultiplier?: number; earlyAccess?: boolean; freeShipping?: boolean; note?: string }>().notNull().default({}),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Configurable rewards (brief §29) — redeeming one issues a `discounts` row scoped to that customer via
 *  `restricted_to_customer_id`, reusing the existing discount engine rather than a second one. */
export const loyaltyRewards = pgTable("loyalty_rewards", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  pointsCost: integer("points_cost").notNull(),
  rewardType: discountType("reward_type").notNull(), // percent | fixed | free_shipping — the same vocabulary discounts already use
  rewardValue: integer("reward_value").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check("loyalty_reward_points_positive", sql`${t.pointsCost} > 0`)]);

export const loyaltyRedemptions = pgTable("loyalty_redemptions", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  rewardId: uuid("reward_id").notNull().references(() => loyaltyRewards.id),
  pointsSpent: integer("points_spent").notNull(),
  discountId: uuid("discount_id").references(() => discounts.id),
  status: loyaltyRedemptionStatus("status").notNull().default("issued"),
  createdAt: createdAt(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [index("loyalty_redemptions_customer_idx").on(t.customerId, t.createdAt)]);
