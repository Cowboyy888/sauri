/** Rows every environment needs (production included). Idempotent. */
import type { DbOrTx } from "./client";
import { categories, customerTags, inventoryLocations, loyaltyTiers, roles, salesChannels, settings, shippingMethods } from "./schema";
import { STORE } from "../config";

export const ROLE_ROWS = [
  { key: "OWNER" as const, name: "Owner", description: "Everything, including staff roles and system settings" },
  { key: "ADMIN" as const, name: "Admin", description: "Products, orders, customers, inventory, analytics, reports, discounts, content" },
  { key: "SALES" as const, name: "Sales", description: "Orders, customers and sales analytics" },
  { key: "INVENTORY" as const, name: "Inventory", description: "Products, inventory and stock movements" },
  { key: "VIEWER" as const, name: "Viewer", description: "Read-only dashboard" },
];

export const CHANNEL_ROWS = [
  { code: "WEBSITE", name: "Website", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { code: "INSTAGRAM", name: "Instagram", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { code: "FACEBOOK", name: "Facebook", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { code: "TIKTOK", name: "TikTok", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { code: "PHYSICAL_STORE", name: "Physical store", feePercentBp: 260, feeFixedCents: 10, shipsOrders: false, chargesShipping: false },
  { code: "WHOLESALE", name: "Wholesale", feePercentBp: 0, feeFixedCents: 0, shipsOrders: true, chargesShipping: false },
  { code: "MANUAL_ORDER", name: "Manual order", feePercentBp: 0, feeFixedCents: 0, shipsOrders: false, chargesShipping: false },
  { code: "OTHER", name: "Other", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
] as const;
export type ChannelCode = (typeof CHANNEL_ROWS)[number]["code"];

export const CATEGORY_ROWS = [
  { slug: "rings", name: "Rings", skuPrefix: "RNG", position: 1 },
  { slug: "earrings", name: "Earrings", skuPrefix: "EAR", position: 2 },
  { slug: "necklaces", name: "Necklaces", skuPrefix: "NCK", position: 3 },
  { slug: "bracelets", name: "Bracelets", skuPrefix: "BRC", position: 4 },
];

export const SHIPPING_METHOD_ROWS = [
  { name: "Standard Shipping", description: "Delivered in 3–6 business days.", priceCents: STORE.standardShippingCents, estimatedMinDays: 3, estimatedMaxDays: 6, waivableAboveThreshold: true, carrierCostCents: STORE.carrierCostStandardCents, position: 1 },
  { name: "Express Shipping", description: "Delivered in 1–2 business days.", priceCents: STORE.expressShippingCents, estimatedMinDays: 1, estimatedMaxDays: 2, waivableAboveThreshold: false, carrierCostCents: STORE.carrierCostExpressCents, position: 2 },
] as const;

export const INVENTORY_LOCATION_ROWS = [
  { name: "Main Warehouse", code: "MAIN", description: "Primary sellable stock.", position: 1 },
  { name: "Display", code: "DISPLAY", description: "On display in the physical store.", position: 2 },
  { name: "Packing Station", code: "PACKING", description: "Picked and staged for packing.", position: 3 },
  { name: "Damaged", code: "DAMAGED", description: "Damaged stock, not sellable.", position: 4 },
  { name: "Returns", code: "RETURNS", description: "Received returns awaiting inspection.", position: 5 },
] as const;

/** Defaults for /admin/settings/returns (brief §28) — always configurable after seeding, never re-forced. */
export const DEFAULT_RETURN_POLICY = {
  returnWindowDays: 30, exchangeEnabled: true, refundEnabled: true,
  returnShippingPolicy: "customer" as "customer" | "company" | "free",
  finalSaleTags: ["final-sale"], eligibleCategorySlugs: null as string[] | null, // null = all categories eligible
};

/** Defaults for /admin/loyalty (brief §26) — configurable after seeding, never re-forced. */
export const LOYALTY_TIER_ROWS = [
  { name: "Member", minSpendCents: 0, benefits: {}, position: 1 },
  { name: "Silver", minSpendCents: 50_000, benefits: { bonusPointsMultiplier: 1.25 }, position: 2 },
  { name: "Gold", minSpendCents: 150_000, benefits: { bonusPointsMultiplier: 1.5, earlyAccess: true }, position: 3 },
  { name: "Platinum", minSpendCents: 300_000, benefits: { bonusPointsMultiplier: 2, earlyAccess: true, freeShipping: true }, position: 4 },
] as const;

/** Configurable tag vocabulary (brief §10) — a starting set, editable/extendable by an admin. */
export const CUSTOMER_TAG_ROWS = [
  { name: "VIP", color: "#a9832f" },
  { name: "Wholesale", color: "#5b6f8c" },
  { name: "Gift Buyer", color: "#8a6ba8" },
  { name: "Frequent Buyer", color: "#4f8a63" },
  { name: "High Value", color: "#a9832f" },
  { name: "Needs Follow Up", color: "#b8703f" },
];

/** Segment/RFM thresholds (brief §4, §5) — configurable via /admin/customers/segments, never hardcoded
 *  in a query. See docs/CUSTOMER_SEGMENTS.md and docs/RFM.md for exactly how each threshold is used. */
export const DEFAULT_CRM_SETTINGS = {
  newCustomerDays: 30, inactiveDays: 180, highValueThresholdCents: 100_000, recentPurchaserDays: 30,
  frequentBuyerDays: 90, frequentBuyerMinOrders: 2,
  rfm: { recencyRecentMaxDays: 30, recencyAtRiskMinDays: 90, recencyInactiveMinDays: 180, frequencyFrequentMinOrders: 4, monetaryHighValueCents: 100_000 },
};

/** Earning rule (brief §24) — configurable via /admin/loyalty, never assumed final. */
export const DEFAULT_LOYALTY_SETTINGS = { enabled: true, pointsPerDollar: 1 };

export async function upsertReferenceData(db: DbOrTx) {
  await db.insert(roles).values(ROLE_ROWS).onConflictDoNothing();
  for (const c of CHANNEL_ROWS) await db.insert(salesChannels).values(c).onConflictDoUpdate({ target: salesChannels.code, set: c });
  await db.insert(categories).values(CATEGORY_ROWS).onConflictDoNothing();
  for (const m of SHIPPING_METHOD_ROWS) await db.insert(shippingMethods).values(m).onConflictDoUpdate({ target: shippingMethods.name, set: m });
  for (const l of INVENTORY_LOCATION_ROWS) await db.insert(inventoryLocations).values(l).onConflictDoUpdate({ target: inventoryLocations.code, set: l });
  for (const t of LOYALTY_TIER_ROWS) await db.insert(loyaltyTiers).values(t).onConflictDoUpdate({ target: loyaltyTiers.name, set: t });
  await db.insert(customerTags).values(CUSTOMER_TAG_ROWS).onConflictDoNothing();
  await db.insert(settings).values([
    { key: "store", value: { currency: STORE.currency, timezone: STORE.timezone, taxRateBp: STORE.taxRateBp, freeShippingThresholdCents: STORE.freeShippingThresholdCents } },
    { key: "content", value: { announce: "Complimentary shipping on orders over $150", heroTitle: "Jewelry for every moment", heroLede: "Solid gold, lab-grown diamonds and freshwater pearls, designed in our studio to be worn every day and kept for years." } },
    { key: "returns", value: DEFAULT_RETURN_POLICY },
    { key: "crm", value: DEFAULT_CRM_SETTINGS },
    { key: "loyalty", value: DEFAULT_LOYALTY_SETTINGS },
  ]).onConflictDoNothing();
}
