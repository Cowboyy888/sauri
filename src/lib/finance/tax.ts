/**
 * Tax reporting foundation (brief §17). The rate actually applied at checkout (`STORE.taxRateBp`,
 * `lib/orders/tax.ts`) is untouched — this is reporting context plus real, already-collected figures.
 * `settings.key = 'tax'` reuses the existing key/value settings mechanism (docs/FINANCE_AUDIT.md §2) rather
 * than a new table. If the row is ever missing, callers must show "Tax configuration required" — never
 * invent a rate (brief §17) — so `getTaxSettings` returns `null` rather than a fallback default.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import { n, rows } from "../admin/sql";
import type { Range } from "../analytics/service";

export type TaxSettings = { enabled: boolean; taxRateBp: number; label: string };

export async function getTaxSettings(db: DbOrTx): Promise<TaxSettings | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "tax"));
  if (!row) return null;
  return row.value as TaxSettings;
}

export async function setTaxSettings(db: Db, actor: Actor, patch: Partial<TaxSettings>) {
  assertCan(actor, "finance:write");
  if (patch.taxRateBp != null && (!Number.isInteger(patch.taxRateBp) || patch.taxRateBp < 0 || patch.taxRateBp > 10_000)) throw new ValidationError("Tax rate must be between 0% and 100%.");
  const before = (await getTaxSettings(db)) ?? { enabled: true, taxRateBp: 0, label: "Sales tax" };
  const next = { ...before, ...patch };
  await db.insert(settings).values({ key: "tax", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Changed tax configuration", "settings", "tax", before, next);
  return next;
}

export type TaxReport = {
  configured: boolean; ratePercent: number | null; label: string | null;
  taxableSalesCents: number; taxExemptSalesCents: number; taxAmountCents: number; orders: number;
};
/** Every figure here comes from `orders.tax_total_cents`/`subtotal_cents`/`discount_total_cents` — the
 *  actual amount each order was charged, never re-derived from the currently configured rate (a historical
 *  order placed under a different rate must still report its own real number). No exemption concept is
 *  modeled yet (every recognized order is currently taxed), so tax-exempt sales is always 0 — documented,
 *  not fabricated as a nonzero estimate. */
export async function getTaxReport(db: DbOrTx, r: Range): Promise<TaxReport> {
  const cfg = await getTaxSettings(db);
  const [row] = await rows<{ taxable: string; tax: string; orders: string }>(db, sql`
    select coalesce(sum(subtotal_cents - discount_total_cents), 0) as taxable, coalesce(sum(tax_total_cents), 0) as tax, count(*) as orders
    from orders where paid_at is not null and paid_at >= ${r.from.toISOString()} and paid_at < ${r.to.toISOString()}`);
  return {
    configured: cfg != null, ratePercent: cfg ? cfg.taxRateBp / 100 : null, label: cfg?.label ?? null,
    taxableSalesCents: n(row?.taxable), taxExemptSalesCents: 0, taxAmountCents: n(row?.tax), orders: n(row?.orders),
  };
}
