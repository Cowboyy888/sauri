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
export const acquisitionSource = pgEnum("acquisition_source", ["WEBSITE", "INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE", "REFERRAL", "PHYSICAL_STORE", "WHOLESALE", "DIRECT", "EMAIL", "OTHER"]);
export const communicationType = pgEnum("communication_type", ["email", "sms", "call", "whatsapp", "telegram", "note"]);
export const consentType = pgEnum("consent_type", ["email_marketing", "sms_marketing"]);
export const abandonedCartStatus = pgEnum("abandoned_cart_status", ["active", "abandoned", "recovered", "expired"]);
export const loyaltyTransactionType = pgEnum("loyalty_transaction_type", ["EARN", "REDEEM", "REFUND_REVERSAL", "ADJUSTMENT", "EXPIRATION", "BONUS"]);
export const loyaltyRedemptionStatus = pgEnum("loyalty_redemption_status", ["issued", "used", "expired", "cancelled"]);

/* ------------------------------------------------------------ Phase 7 enums */
export const campaignStatus = pgEnum("campaign_status", ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
/** FIRST_TOUCH and LAST_TOUCH are computed today (see docs/ATTRIBUTION.md). LINEAR and POSITION_BASED are
 *  carried in the enum so the schema won't need to change again, but nothing computes them yet — they need
 *  a customer's whole touch history (marketing_events), not just first/last. */
export const attributionModel = pgEnum("attribution_model", ["FIRST_TOUCH", "LAST_TOUCH", "LINEAR", "POSITION_BASED"]);
export const marketingEventType = pgEnum("marketing_event_type", [
  "page_view", "product_viewed", "collection_viewed", "search", "wishlist_added", "cart_added", "cart_removed",
  "checkout_started", "shipping_added", "payment_started", "purchase_completed", "coupon_applied", "coupon_failed",
  "promotion_viewed", "email_clicked",
]);
export const emailCampaignStatus = pgEnum("email_campaign_status", ["DRAFT", "SCHEDULED", "SENDING", "SENT", "CANCELLED"]);

/* ------------------------------------------------------------ Phase 8 enums */
export const supplierStatus = pgEnum("supplier_status", ["ACTIVE", "INACTIVE", "BLOCKED"]);
export const purchaseOrderStatus = pgEnum("purchase_order_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]);
/** "OVERDUE" is never stored — it's derived at read time (due_date passed and not fully paid) so it can
 *  never drift out of sync with the date; see docs/PURCHASING.md. */
export const purchasePaymentStatus = pgEnum("purchase_payment_status", ["UNPAID", "PARTIALLY_PAID", "PAID"]);
export const purchaseDocumentType = pgEnum("purchase_document_type", ["quotation", "invoice", "packing_list", "receiving_document", "other"]);
export const stocktakeStatus = pgEnum("stocktake_status", ["in_progress", "pending_approval", "completed", "cancelled"]);

/** Phase 9 (brief §7-8). DRAFT never counts anywhere. PENDING_APPROVAL never counts anywhere (not yet
 *  posted). APPROVED and PAID both count as "posted" for the accrual P&L (brief §4: "SUM approved/posted
 *  operating expenses") — only PAID counts as an actual cash outflow. REJECTED and CANCELLED never count;
 *  neither is ever hard-deleted once it has affected reporting (brief §8), matching the void/reversal
 *  posture of a refund rather than a row deletion. */
export const expenseStatus = pgEnum("expense_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID", "CANCELLED"]);
/** Phase 9 (brief §15). A payment with no electronic provider to check against (cash, manual, bank
 *  transfer with no statement yet) is IGNORED, not UNMATCHED — UNMATCHED means a provider *was* checked and
 *  no matching record was found there. */
export const reconciliationStatus = pgEnum("reconciliation_status", ["MATCHED", "UNMATCHED", "PARTIAL", "DISCREPANCY", "IGNORED"]);

export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 10001 });
export const poNumberSeq = pgSequence("po_number_seq", { startWith: 1 });
export const expenseNumberSeq = pgSequence("expense_number_seq", { startWith: 1 });

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
  // Phase 8 (brief §3): canonicalUrl lets a duplicate/variant listing point SEO credit at the primary one.
  canonicalUrl: text("canonical_url"),
  brand: text("brand"),
  careInstructions: text("care_instructions"),
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
  style: text("style"),
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
  /** Phase 8 (brief §31): the level a reorder should bring available stock back up to. Null = no target set
   *  yet; the reorder-suggestion formula falls back to reorderLevel × 5 in that case — see docs/REORDERING.md. */
  targetStockLevel: integer("target_stock_level"),
  updatedAt: updatedAt(),
}, (t) => [
  // The database refuses impossible stock even if application code has a bug.
  check("inventory_stock_non_negative", sql`${t.stockQuantity} >= 0`),
  check("inventory_reserved_valid", sql`${t.reservedQuantity} >= 0 AND ${t.reservedQuantity} <= ${t.stockQuantity}`),
  check("inventory_reorder_non_negative", sql`${t.reorderLevel} >= 0`),
  check("inventory_target_stock_non_negative", sql`${t.targetStockLevel} IS NULL OR ${t.targetStockLevel} >= 0`),
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

/** Phase 1 had only name/email/phone (populated lazily by restock()'s free-text supplier field). Phase 8
 *  adds the rest (brief §11) — the same rows, one supplier system, not two. */
export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull().unique(),
  company: text("company"),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  postalCode: text("postal_code"),
  country: text("country"),
  website: text("website"),
  paymentTerms: text("payment_terms"),
  currency: text("currency").notNull().default("USD"),
  leadTimeDays: integer("lead_time_days"),
  minimumOrderCents: integer("minimum_order_cents"),
  notes: text("notes"),
  status: supplierStatus("status").notNull().default("ACTIVE"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check("supplier_lead_time_non_negative", sql`${t.leadTimeDays} IS NULL OR ${t.leadTimeDays} >= 0`), check("supplier_min_order_non_negative", sql`${t.minimumOrderCents} IS NULL OR ${t.minimumOrderCents} >= 0`)]);

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
  /* ---------------------------------------------------------------- Phase 7 */
  // Internal label (brief §6 "Campaign Name" reused here for a promotion's own name) — distinct from
  // `code`, which is what the customer types. Null for pre-Phase-7 rows.
  name: text("name"),
  // Richer eligibility (brief §14) alongside the pre-existing single categoryId/productId (kept for
  // backward compatibility with the Phase 2 /admin/discounts page). eligible() in orders/pricing.ts unions
  // both mechanisms. Empty array = no restriction of that kind.
  eligibleProductIds: uuid("eligible_product_ids").array().notNull().default(sql`'{}'::uuid[]`),
  excludedProductIds: uuid("excluded_product_ids").array().notNull().default(sql`'{}'::uuid[]`),
  eligibleCollectionIds: uuid("eligible_collection_ids").array().notNull().default(sql`'{}'::uuid[]`),
  excludedCollectionIds: uuid("excluded_collection_ids").array().notNull().default(sql`'{}'::uuid[]`),
  // Segment keys from lib/crm/segments.ts's SEGMENT_KEYS — reused, never redefined here (brief §13).
  eligibleSegments: text("eligible_segments").array().notNull().default(sql`'{}'::text[]`),
  // First-order promotion (brief §18) — validated server-side in validateDiscount against paid order history.
  firstOrderOnly: boolean("first_order_only").notNull().default(false),
  // Optional link to the campaign this coupon belongs to, so a campaign's "Discounts" cost line and a
  // coupon's revenue figures can both be read from the same discount_usages ⋈ orders join (brief §8, §28).
  campaignId: uuid("campaign_id").references((): AnyPgColumn => marketingCampaigns.id),
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

/* ---------------------------------------------------------- Marketing (Phase 7) */
/** A campaign's `slug` IS the exact `utm_campaign` value used to match traffic and orders to it (brief §6
 *  calls this both "Campaign ID" and "Campaign" — they are the same string here); `name` is the separate
 *  human label. See docs/CAMPAIGNS.md. */
export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(), // matched case-insensitively against utm_campaign
  source: text("source").notNull(), // free text, matches utm_source (not the fixed acquisition_source enum — campaigns can target any platform)
  medium: text("medium").notNull(), // matches utm_medium
  budgetCents: integer("budget_cents"), // planned spend; null = not budgeted. Actual spend is sum(campaign_costs).
  status: campaignStatus("status").notNull().default("DRAFT"),
  description: text("description").notNull().default(""),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("marketing_campaigns_slug_uq").on(sql`lower(${t.slug})`),
  index("marketing_campaigns_status_idx").on(t.status),
  check("marketing_campaign_budget_non_negative", sql`${t.budgetCents} IS NULL OR ${t.budgetCents} >= 0`),
  check("marketing_campaign_dates_valid", sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
]);

/** Manually-entered spend (brief §28), one or more dated rows per campaign rather than a single mutable
 *  "actual spend" column — auditable, and matches the brief's own table list (§45). */
export const campaignCosts = pgTable("campaign_costs", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => marketingCampaigns.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("campaign_costs_campaign_idx").on(t.campaignId, t.incurredAt),
  check("campaign_cost_positive", sql`${t.amountCents} > 0`),
]);

/**
 * One immutable snapshot per order (brief §4-5, §8), written inside the same transaction as `placeOrder`.
 * `customers.first_touch_*`/`last_touch_*` (Phase 6) keep changing as a customer keeps visiting — this row
 * freezes exactly what they were at the moment THIS order was placed, so campaign revenue for an old order
 * can never silently change later. campaignId is resolved once, at write time, from utm_campaign; storing
 * it (rather than re-matching by string at every query) keeps every campaign-analytics query a plain join.
 */
export const marketingAttributions = pgTable("marketing_attributions", {
  id: id(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  firstTouchSource: acquisitionSource("first_touch_source"),
  firstTouchDetails: jsonb("first_touch_details").$type<{ utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string; referrer?: string }>(),
  firstTouchCampaignId: uuid("first_touch_campaign_id").references(() => marketingCampaigns.id),
  lastTouchSource: acquisitionSource("last_touch_source"),
  lastTouchDetails: jsonb("last_touch_details").$type<{ utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string; referrer?: string }>(),
  lastTouchCampaignId: uuid("last_touch_campaign_id").references(() => marketingCampaigns.id),
  createdAt: createdAt(),
}, (t) => [
  index("marketing_attributions_first_campaign_idx").on(t.firstTouchCampaignId),
  index("marketing_attributions_last_campaign_idx").on(t.lastTouchCampaignId),
  index("marketing_attributions_customer_idx").on(t.customerId),
]);

/**
 * Centralized event log (brief §46-47) — one table for every tracked interaction, never a separate table
 * per event type. `eventId` is a client-generated idempotency key (deduplicates a retried client request);
 * `purchase_completed` additionally gets a partial unique index on `order_id` since that one is written
 * server-side and must never double-count regardless of how it's triggered. Money is deliberately NOT
 * stored here — revenue always comes from `orders`/`order_items` (joined through `marketing_attributions`
 * for campaign grouping), so there is exactly one source of truth for financial figures (docs/ANALYTICS.md).
 */
export const marketingEvents = pgTable("marketing_events", {
  id: id(),
  eventId: text("event_id"), // client-supplied idempotency key; null for server-written events (see partial unique index below)
  sessionId: text("session_id").notNull(),
  customerId: uuid("customer_id").references(() => customers.id),
  type: marketingEventType("type").notNull(),
  path: text("path"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  searchQuery: text("search_query"),
  resultsCount: integer("results_count"),
  device: text("device"), // "desktop" | "mobile" | "tablet" | null — never the raw user-agent (brief §48)
  metadata: jsonb("metadata"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("marketing_events_event_id_uq").on(t.eventId).where(sql`${t.eventId} is not null`),
  uniqueIndex("marketing_events_purchase_order_uq").on(t.orderId).where(sql`${t.type} = 'purchase_completed'`),
  index("marketing_events_type_created_idx").on(t.type, t.createdAt),
  index("marketing_events_session_idx").on(t.sessionId),
  index("marketing_events_campaign_idx").on(t.campaignId, t.createdAt),
  index("marketing_events_product_idx").on(t.productId, t.type),
  index("marketing_events_collection_idx").on(t.collectionId, t.type),
]);

/** Campaign URL builder + email/other architecture (brief §22-25). Not a full enterprise email provider —
 *  reuses lib/email/provider.ts's send() (currently a logging stub, same as every transactional email). */
export const emailCampaigns = pgTable("email_campaigns", {
  id: id(),
  name: text("name").notNull(),
  audience: jsonb("audience").$type<{ type: "segment" | "loyalty_members" | "bought_category" | "has_wishlist_items"; segmentKey?: string; categoryId?: string }>().notNull(),
  subject: text("subject").notNull(),
  previewText: text("preview_text").notNull().default(""),
  content: text("content").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: emailCampaignStatus("status").notNull().default("DRAFT"),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id), // optional link for revenue/orders attribution
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const emailCampaignRecipients = pgTable("email_campaign_recipients", {
  id: id(),
  emailCampaignId: uuid("email_campaign_id").notNull().references(() => emailCampaigns.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("email_campaign_recipients_uq").on(t.emailCampaignId, t.customerId),
  index("email_campaign_recipients_customer_idx").on(t.customerId),
]);

/* ---------------------------------------------------------- Purchasing (Phase 8) */
/** Which suppliers can provide a given variant, and on what terms (brief §12). A variant can have several
 *  suppliers; `preferred_supplier` marks the default without ever auto-selecting it for a PO — see
 *  docs/SUPPLIERS.md. `last_purchase_price_cents`/`last_purchase_date` are updated when a PO against this
 *  pairing is received; never overwritten retroactively (brief §26). */
export const supplierProducts = pgTable("supplier_products", {
  id: id(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  supplierSku: text("supplier_sku"),
  purchasePriceCents: integer("purchase_price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  minimumOrderQuantity: integer("minimum_order_quantity"),
  leadTimeDays: integer("lead_time_days"),
  preferredSupplier: boolean("preferred_supplier").notNull().default(false),
  lastPurchasePriceCents: integer("last_purchase_price_cents"),
  lastPurchaseDate: timestamp("last_purchase_date", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("supplier_products_uq").on(t.supplierId, t.variantId),
  index("supplier_products_variant_idx").on(t.variantId),
  check("supplier_product_price_non_negative", sql`${t.purchasePriceCents} >= 0`),
  check("supplier_product_moq_positive", sql`${t.minimumOrderQuantity} IS NULL OR ${t.minimumOrderQuantity} > 0`),
]);

/**
 * One purchase order (brief §13-15). `po_number` reuses the exact pattern `orders.order_number` already
 * uses — a sequence-backed default expression — with the year embedded per the brief's own example
 * (PO-2026-000001). Money columns mirror `orders`' own convention (integer cents, a total-math CHECK).
 */
export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  poNumber: text("po_number").notNull().unique().default(sql`'PO-' || extract(year from now()) || '-' || lpad(nextval('po_number_seq')::text, 6, '0')`),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: purchaseOrderStatus("status").notNull().default("DRAFT"),
  paymentStatus: purchasePaymentStatus("payment_status").notNull().default("UNPAID"),
  orderDate: timestamp("order_date", { withTimezone: true }).notNull().defaultNow(),
  expectedDeliveryDate: timestamp("expected_delivery_date", { withTimezone: true }),
  currency: text("currency").notNull().default("USD"),
  paymentTerms: text("payment_terms"),
  notes: text("notes").notNull().default(""),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  shippingCents: integer("shipping_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  amountPaidCents: integer("amount_paid_cents").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("purchase_orders_supplier_idx").on(t.supplierId),
  index("purchase_orders_status_idx").on(t.status),
  check("purchase_order_total_math", sql`${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} + ${t.shippingCents} + ${t.taxCents}`),
  check("purchase_order_amounts_non_negative", sql`${t.subtotalCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.shippingCents} >= 0 AND ${t.taxCents} >= 0 AND ${t.amountPaidCents} >= 0`),
]);

/** One line of a PO. `received_quantity` is a cached running total (updated only by the receiving
 *  transaction, same pattern as `discounts.used_count`) so "ordered / received / remaining" never needs to
 *  sum every receipt on every page load. */
export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: id(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id),
  supplierSku: text("supplier_sku"),
  quantity: integer("quantity").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  lineTotalCents: integer("line_total_cents").notNull(),
  receivedQuantity: integer("received_quantity").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  index("purchase_order_items_po_idx").on(t.purchaseOrderId),
  index("purchase_order_items_variant_idx").on(t.variantId),
  check("purchase_order_item_qty_positive", sql`${t.quantity} > 0`),
  check("purchase_order_item_cost_non_negative", sql`${t.unitCostCents} >= 0`),
  check("purchase_order_item_line_math", sql`${t.lineTotalCents} = ${t.quantity} * ${t.unitCostCents} - ${t.discountCents}`),
  check("purchase_order_item_received_valid", sql`${t.receivedQuantity} >= 0 AND ${t.receivedQuantity} <= ${t.quantity}`),
]);

/** One goods-receiving event against a PO — a PO can have several (partial receiving, brief §23). */
export const purchaseReceipts = pgTable("purchase_receipts", {
  id: id(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  receivedByUserId: uuid("received_by_user_id").references(() => users.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("purchase_receipts_po_idx").on(t.purchaseOrderId, t.receivedAt)]);

/** Per-line quality-control breakdown for one receipt (brief §24-25). Only `accepted_quantity` ever becomes
 *  sellable stock — damaged/rejected units never touch `inventory.stock_quantity` at all, since they never
 *  entered it (see docs/PURCHASING.md's "Quality control" section for why this isn't a DAMAGED movement). */
export const purchaseReceiptItems = pgTable("purchase_receipt_items", {
  id: id(),
  purchaseReceiptId: uuid("purchase_receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "cascade" }),
  purchaseOrderItemId: uuid("purchase_order_item_id").notNull().references(() => purchaseOrderItems.id),
  acceptedQuantity: integer("accepted_quantity").notNull().default(0),
  damagedQuantity: integer("damaged_quantity").notNull().default(0),
  rejectedQuantity: integer("rejected_quantity").notNull().default(0),
  unitCostCents: integer("unit_cost_cents").notNull(), // snapshot — never overwritten if the supplier's price later changes
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [
  index("purchase_receipt_items_receipt_idx").on(t.purchaseReceiptId),
  index("purchase_receipt_items_po_item_idx").on(t.purchaseOrderItemId),
  check("purchase_receipt_item_quantities_non_negative", sql`${t.acceptedQuantity} >= 0 AND ${t.damagedQuantity} >= 0 AND ${t.rejectedQuantity} >= 0`),
  check("purchase_receipt_item_has_quantity", sql`${t.acceptedQuantity} + ${t.damagedQuantity} + ${t.rejectedQuantity} > 0`),
]);

/** PO attachments (brief §42) — a URL text field, same convention as product images and Phase 5's return
 *  photos: this project has no binary file-upload provider configured, so attachments are added by URL. */
export const purchaseDocuments = pgTable("purchase_documents", {
  id: id(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  type: purchaseDocumentType("type").notNull().default("other"),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("purchase_documents_po_idx").on(t.purchaseOrderId)]);

/** A log of PO-email attempts (brief §18) — never sent automatically; always an explicit staff action. */
export const purchaseOrderSends = pgTable("purchase_order_sends", {
  id: id(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  sentByUserId: uuid("sent_by_user_id").references(() => users.id),
  recipientEmail: text("recipient_email").notNull(),
  succeeded: boolean("succeeded").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
}, (t) => [index("purchase_order_sends_po_idx").on(t.purchaseOrderId, t.createdAt)]);

/** A minimal payment log (brief §41) — deliberately not a general ledger. `purchase_orders.payment_status`
 *  and `amount_paid_cents` are derived from these rows by `recordPurchasePayment()`, never set directly. */
export const purchasePayments = pgTable("purchase_payments", {
  id: id(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
  // Phase 9 (brief §9): additive — recordPurchasePayment() stays the only write path (docs/FINANCE_AUDIT.md §1).
  paymentMethod: text("payment_method"),
  referenceNumber: text("reference_number"),
  attachmentUrl: text("attachment_url"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("purchase_payments_po_idx").on(t.purchaseOrderId, t.paidAt), check("purchase_payment_positive", sql`${t.amountCents} > 0`)]);

/** Selling-price history (brief §38) — genuinely new; Phase 2 only ever overwrote the current price in
 *  place. Written from inside the existing `updateVariant()` whenever price/compare-at actually changes —
 *  one write path, not two. Never updated or deleted once written. */
export const productPriceHistory = pgTable("product_price_history", {
  id: id(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  sellingPriceCents: integer("selling_price_cents").notNull(),
  compareAtPriceCents: integer("compare_at_price_cents"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("product_price_history_variant_idx").on(t.variantId, t.effectiveAt)]);

/** A cycle count (brief §46-48). `location_id` reuses Phase 5's `inventory_locations` — no new location
 *  concept. Significant discrepancies require a manager to approve before the adjustment is applied. */
export const stocktakes = pgTable("stocktakes", {
  id: id(),
  locationId: uuid("location_id").references(() => inventoryLocations.id),
  status: stocktakeStatus("status").notNull().default("in_progress"),
  startedByUserId: uuid("started_by_user_id").references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("stocktakes_location_idx").on(t.locationId, t.startedAt)]);

export const stocktakeItems = pgTable("stocktake_items", {
  id: id(),
  stocktakeId: uuid("stocktake_id").notNull().references(() => stocktakes.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id),
  expectedQuantity: integer("expected_quantity").notNull(),
  countedQuantity: integer("counted_quantity"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("stocktake_items_uq").on(t.stocktakeId, t.variantId),
  check("stocktake_item_expected_non_negative", sql`${t.expectedQuantity} >= 0`),
  check("stocktake_item_counted_non_negative", sql`${t.countedQuantity} IS NULL OR ${t.countedQuantity} >= 0`),
]);

/* ================================================================ Phase 9: finance ================= */

/** Configurable expense category vocabulary (brief §6) — same shape as Phase 6's `customer_tags`, so a
 *  second bespoke "configurable list" mechanism doesn't get invented for this one purpose. */
export const expenseCategories = pgTable("expense_categories", {
  id: id(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * An operating expense (brief §6-8). `expense_date` is the accrual date (when the cost was incurred) —
 * the Management P&L's "operating expenses" line sums APPROVED+PAID rows by this date (brief §4: "SUM
 * approved/posted"). `paid_at` is the cash date — cash flow only ever sums PAID rows by this date (brief
 * §12: expense ≠ cash paid until actually paid). Never hard-deleted once APPROVED or PAID (brief §8) —
 * only DRAFT/PENDING_APPROVAL/REJECTED rows may be deleted, since those never affected a report.
 */
export const expenses = pgTable("expenses", {
  id: id(),
  expenseNumber: text("expense_number").notNull().unique().default(sql`'EXP-' || lpad(nextval('expense_number_seq')::text, 6, '0')`),
  categoryId: uuid("category_id").notNull().references(() => expenseCategories.id),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  paymentMethod: text("payment_method"), // cash | bank_transfer | card | cheque | other — free text, same convention as payments.provider
  supplierId: uuid("supplier_id").references(() => suppliers.id), // optional — reuses Phase 8 suppliers, never a second vendor list
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"), // URL, same convention as purchase_documents / return photos — no binary upload provider configured
  status: expenseStatus("status").notNull().default("DRAFT"),
  expenseDate: timestamp("expense_date", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("expenses_status_idx").on(t.status),
  index("expenses_category_idx").on(t.categoryId),
  index("expenses_date_idx").on(t.expenseDate),
  index("expenses_paid_idx").on(t.paidAt),
  check("expense_amount_positive", sql`${t.amountCents} > 0`),
]);

/**
 * One reconciliation record per customer payment (brief §15) — the current state of comparing our record
 * against the payment provider's own record. `external_amount_cents` is null until checked (live against
 * Stripe for `provider = 'stripe'` rows, or entered manually for everything else — see
 * docs/RECONCILIATION.md). Re-checking overwrites the same row rather than appending a new one: this is a
 * current-state comparison, not a transaction ledger — its own `updated_at` plus the audit log are the history.
 */
export const reconciliationRecords = pgTable("reconciliation_records", {
  id: id(),
  paymentId: uuid("payment_id").notNull().unique().references(() => payments.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  internalAmountCents: integer("internal_amount_cents").notNull(),
  externalAmountCents: integer("external_amount_cents"),
  transactionRef: text("transaction_ref"),
  status: reconciliationStatus("status").notNull().default("UNMATCHED"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("reconciliation_records_status_idx").on(t.status),
  index("reconciliation_records_order_idx").on(t.orderId),
  check("reconciliation_internal_amount_non_negative", sql`${t.internalAmountCents} >= 0`),
  check("reconciliation_external_amount_non_negative", sql`${t.externalAmountCents} IS NULL OR ${t.externalAmountCents} >= 0`),
]);

/** A saved, reproducible report (brief §24) — stores the already-computed figures (`values`), so it reads
 *  back identically even after later orders/expenses change the live numbers. */
export const financialReportSnapshots = pgTable("financial_report_snapshots", {
  id: id(),
  reportType: text("report_type").notNull(),
  label: text("label").notNull(),
  rangeFrom: timestamp("range_from", { withTimezone: true }).notNull(),
  rangeTo: timestamp("range_to", { withTimezone: true }).notNull(),
  filters: jsonb("filters"),
  values: jsonb("values").notNull(),
  reportVersion: integer("report_version").notNull().default(1),
  generatedByUserId: uuid("generated_by_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("financial_report_snapshots_type_idx").on(t.reportType, t.createdAt)]);
