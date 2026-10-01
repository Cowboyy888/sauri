/** Marketing settings (attribution model + discount-stacking policy) — brief §5, §40. See
 *  docs/PHASE_7_AUDIT.md and docs/ATTRIBUTION.md/docs/PROMOTIONS.md for what each field means. */
import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { DEFAULT_MARKETING_SETTINGS } from "../db/reference-data";

export type MarketingSettings = typeof DEFAULT_MARKETING_SETTINGS;

export async function getMarketingSettings(db: DbOrTx): Promise<MarketingSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(sql`${settings.key} = 'marketing'`);
  const v = (row?.value as Partial<MarketingSettings> | undefined) ?? {};
  return { ...DEFAULT_MARKETING_SETTINGS, ...v, stacking: { ...DEFAULT_MARKETING_SETTINGS.stacking, ...(v.stacking ?? {}) }, abandonedCartAutomation: { ...DEFAULT_MARKETING_SETTINGS.abandonedCartAutomation, ...(v.abandonedCartAutomation ?? {}) } };
}

export async function setMarketingSettings(db: Db, actor: Actor, patch: Partial<MarketingSettings>): Promise<MarketingSettings> {
  assertCan(actor, "marketing:write");
  const before = await getMarketingSettings(db);
  const next: MarketingSettings = {
    ...before, ...patch,
    stacking: { ...before.stacking, ...(patch.stacking ?? {}) },
    abandonedCartAutomation: { ...before.abandonedCartAutomation, ...(patch.abandonedCartAutomation ?? {}) },
  };
  await db.insert(settings).values({ key: "marketing", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Updated marketing settings", "settings", "marketing", before, next);
  return next;
}
