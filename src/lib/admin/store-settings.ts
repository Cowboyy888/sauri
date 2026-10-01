/** Company/letterhead details (Phase 8 brief §17) — so the purchase-order PDF never hardcodes them. Not a
 *  general "store settings" system beyond what's needed here; `settings.key = 'store'` already existed
 *  (seeded, previously never read) and just gained these fields. */
import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";

export type StoreSettings = { currency: string; timezone: string; taxRateBp: number; freeShippingThresholdCents: number; companyName: string; companyAddress: string; companyEmail: string; companyPhone: string };
const DEFAULTS: StoreSettings = { currency: "USD", timezone: "Asia/Phnom_Penh", taxRateBp: 800, freeShippingThresholdCents: 15_000, companyName: "SAURI", companyAddress: "", companyEmail: "", companyPhone: "" };

export async function getStoreSettings(db: DbOrTx): Promise<StoreSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "store"));
  return { ...DEFAULTS, ...(row?.value as Partial<StoreSettings> | undefined) };
}

export async function setStoreSettings(db: Db, actor: Actor, patch: Partial<Pick<StoreSettings, "companyName" | "companyAddress" | "companyEmail" | "companyPhone">>) {
  assertCan(actor, "settings:write");
  const before = await getStoreSettings(db);
  const next = { ...before, ...patch };
  await db.insert(settings).values({ key: "store", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Updated company details", "settings", "store", before, next);
  return next;
}
