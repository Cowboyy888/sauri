/** Rows every environment needs (production included). Idempotent. */
import type { DbOrTx } from "./client";
import { categories, roles, salesChannels, settings } from "./schema";
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

export async function upsertReferenceData(db: DbOrTx) {
  await db.insert(roles).values(ROLE_ROWS).onConflictDoNothing();
  for (const c of CHANNEL_ROWS) await db.insert(salesChannels).values(c).onConflictDoUpdate({ target: salesChannels.code, set: c });
  await db.insert(categories).values(CATEGORY_ROWS).onConflictDoNothing();
  await db.insert(settings).values([
    { key: "store", value: { currency: STORE.currency, timezone: STORE.timezone, taxRateBp: STORE.taxRateBp, freeShippingThresholdCents: STORE.freeShippingThresholdCents } },
    { key: "content", value: { announce: "Complimentary shipping on orders over $150", heroTitle: "Jewelry for every moment", heroLede: "Solid gold, lab-grown diamonds and freshwater pearls, designed in our studio to be worn every day and kept for years." } },
  ]).onConflictDoNothing();
}
