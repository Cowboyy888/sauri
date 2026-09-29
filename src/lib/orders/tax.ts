/**
 * Tax calculation as its own seam (brief §27), so checkout never hardcodes a rate inline. This wraps the
 * same flat rate `computeTotals` already applies and has always tested against (`STORE.taxRateBp`) — it
 * does not invent a new rate, and it does not enable Stripe Tax (`automatic_tax`), which requires an
 * active tax registration in the customer's jurisdiction that this business does not have configured.
 * Swapping in real jurisdiction-based tax (Stripe Tax, Avalara, …) means implementing this one function.
 */
import { STORE } from "../config";
import { pct } from "../money";

export type TaxInput = { subtotalCents: number; shippingCents: number; customerAddress?: { country?: string; postalCode?: string } | null };
export type TaxResult = { taxEnabled: boolean; taxAmountCents: number; taxRateBp: number; breakdown: { label: string; amountCents: number }[] };

export function calculateTax(input: TaxInput): TaxResult {
  if (!STORE.taxEnabled) return { taxEnabled: false, taxAmountCents: 0, taxRateBp: 0, breakdown: [] };
  const taxAmountCents = pct(input.subtotalCents, STORE.taxRateBp);
  return {
    taxEnabled: true, taxAmountCents, taxRateBp: STORE.taxRateBp,
    breakdown: [{ label: `Sales tax (${(STORE.taxRateBp / 100).toFixed(2)}%)`, amountCents: taxAmountCents }],
  };
}
