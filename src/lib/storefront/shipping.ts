import "server-only";
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { shippingMethods } from "../db/schema";
import { STORE } from "../config";

export type ShippingMethodOption = {
  id: string; name: string; description: string; priceCents: number; estimatedMinDays: number; estimatedMaxDays: number;
  waivableAboveThreshold: boolean;
};

export async function getActiveShippingMethods(db: DbOrTx): Promise<ShippingMethodOption[]> {
  return db.select({
    id: shippingMethods.id, name: shippingMethods.name, description: shippingMethods.description,
    priceCents: shippingMethods.priceCents, estimatedMinDays: shippingMethods.estimatedMinDays, estimatedMaxDays: shippingMethods.estimatedMaxDays,
    waivableAboveThreshold: shippingMethods.waivableAboveThreshold,
  }).from(shippingMethods).where(eq(shippingMethods.active, true)).orderBy(asc(shippingMethods.position));
}

export type ShippingCalcInput = { subtotalCents: number; countryCode?: string | null; region?: string | null };
export type ShippingCalcResult = { shippingMethod: ShippingMethodOption; shippingPriceCents: number; estimatedDeliveryDays: [number, number] };

/**
 * Centralized shipping calculation (brief §17) — the only place that decides which methods a shopper may
 * even choose from, given their address and order value. The final "is it free" decision (an order over
 * the threshold, or a free-shipping discount code) still happens once, in `lib/orders/pricing.ts`
 * `computeTotals()`, so there is exactly one place total money math happens — this only narrows the menu.
 */
export async function getEligibleShippingMethods(db: DbOrTx, input: { subtotalCents: number; countryCode?: string | null; region?: string | null }): Promise<ShippingMethodOption[]> {
  const all = await db.select({
    id: shippingMethods.id, name: shippingMethods.name, description: shippingMethods.description,
    priceCents: shippingMethods.priceCents, estimatedMinDays: shippingMethods.estimatedMinDays, estimatedMaxDays: shippingMethods.estimatedMaxDays,
    waivableAboveThreshold: shippingMethods.waivableAboveThreshold, countryCode: shippingMethods.countryCode, region: shippingMethods.region,
    minOrderCents: shippingMethods.minOrderCents, maxOrderCents: shippingMethods.maxOrderCents,
  }).from(shippingMethods).where(eq(shippingMethods.active, true)).orderBy(asc(shippingMethods.position));

  return all.filter((m) => {
    if (m.countryCode && input.countryCode && m.countryCode !== input.countryCode) return false;
    if (m.region && input.region && m.region !== input.region) return false;
    if (m.minOrderCents != null && input.subtotalCents < m.minOrderCents) return false;
    if (m.maxOrderCents != null && input.subtotalCents > m.maxOrderCents) return false;
    return true;
  });
}

/** Resolves one chosen method into a shopper-facing price/estimate (server-side only — brief §17). */
export async function calculateShipping(db: DbOrTx, input: ShippingCalcInput & { shippingMethodId: string }): Promise<ShippingCalcResult | null> {
  const eligible = await getEligibleShippingMethods(db, input);
  const method = eligible.find((m) => m.id === input.shippingMethodId);
  if (!method) return null;
  const waived = method.waivableAboveThreshold && input.subtotalCents >= STORE.freeShippingThresholdCents;
  return { shippingMethod: method, shippingPriceCents: waived ? 0 : method.priceCents, estimatedDeliveryDays: [method.estimatedMinDays, method.estimatedMaxDays] };
}
