/** Rows every environment needs (production included). Idempotent. */
import type { DbOrTx } from "./client";
import { categories, roles, salesChannels, settings } from "./schema";
import { STORE } from "../config";

export const ROLE_ROWS = [
  { key: "OWNER" as const, name: "Owner", description: "Everything, including roles and system settings" },
  { key: "ADMIN" as const, name: "Admin", description: "Everything except sensitive system settings" },
  { key: "SALES" as const, name: "Sales", description: "Orders, customers and sales figures" },
  { key: "INVENTORY" as const, name: "Inventory", description: "Inventory, products and stock movements" },
  { key: "VIEWER" as const, name: "Viewer", description: "Read-only dashboard" },
];

export const CHANNEL_ROWS = [
  { key: "web", name: "Website", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { key: "instagram", name: "Instagram", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { key: "facebook", name: "Facebook", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { key: "tiktok", name: "TikTok", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
  { key: "store", name: "Physical store", feePercentBp: 260, feeFixedCents: 10, shipsOrders: false, chargesShipping: false },
  { key: "wholesale", name: "Wholesale", feePercentBp: 0, feeFixedCents: 0, shipsOrders: true, chargesShipping: false },
  { key: "manual", name: "Manual order", feePercentBp: 0, feeFixedCents: 0, shipsOrders: false, chargesShipping: false },
  { key: "other", name: "Other", feePercentBp: 290, feeFixedCents: 30, shipsOrders: true, chargesShipping: true },
];

export const CATEGORY_ROWS = [
  { slug: "rings", name: "Rings", skuPrefix: "RNG", position: 1 },
  { slug: "earrings", name: "Earrings", skuPrefix: "EAR", position: 2 },
  { slug: "necklaces", name: "Necklaces", skuPrefix: "NCK", position: 3 },
  { slug: "bracelets", name: "Bracelets", skuPrefix: "BRC", position: 4 },
];

export async function upsertReferenceData(db: DbOrTx) {
  await db.insert(roles).values(ROLE_ROWS).onConflictDoNothing();
  for (const c of CHANNEL_ROWS) await db.insert(salesChannels).values(c).onConflictDoUpdate({ target: salesChannels.key, set: c });
  await db.insert(categories).values(CATEGORY_ROWS).onConflictDoNothing();
  await db.insert(settings).values([
    { key: "store", value: { currency: STORE.currency, timezone: STORE.timezone, taxRateBp: STORE.taxRateBp, freeShippingThresholdCents: STORE.freeShippingThresholdCents } },
    { key: "content", value: { announce: "Complimentary shipping on orders over $150", heroTitle: "Jewelry for every moment", heroLede: "Solid gold, lab-grown diamonds and freshwater pearls, designed in our studio to be worn every day and kept for years." } },
  ]).onConflictDoNothing();
}
