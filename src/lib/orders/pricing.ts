/**
 * Pure order math. The ONLY place totals, line discounts, fees and shipping are calculated.
 * No database access, so it is trivially unit-testable.
 */
import { STORE } from "../config";
import { pct } from "../money";
import { calculateTax } from "./tax";

export type PricedLine = { unitPriceCents: number; unitCostCents: number; quantity: number; productId: string; categoryId: string; collectionId: string | null };
export type AppliedDiscount = {
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  categoryId: string | null;
  productId: string | null;
  maxDiscountCents: number | null;
  /** Phase 7 (brief §14): richer scope alongside the legacy single categoryId/productId above. Empty/absent
   *  array = no restriction of that kind. */
  eligibleProductIds?: string[];
  excludedProductIds?: string[];
  eligibleCollectionIds?: string[];
  excludedCollectionIds?: string[];
};
export type ChannelRules = { feePercentBp: number; feeFixedCents: number; shipsOrders: boolean; chargesShipping: boolean };
/** A resolved row from `shipping_methods`. When passed to computeTotals, it replaces the legacy
 *  standard/express flat-rate logic; when omitted, that legacy logic (and every existing caller/test) is
 *  unchanged. */
export type ResolvedShippingMethod = { id: string; priceCents: number; carrierCostCents: number; waivableAboveThreshold: boolean };

export type LineAmounts = { discountCents: number; lineTotalCents: number; lineCostCents: number; lineProfitCents: number };
export type Totals = {
  subtotalCents: number;
  discountTotalCents: number;
  shippingTotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  costTotalCents: number;
  grossProfitCents: number;
  grossMargin: number;
  paymentFeeCents: number;
  shippingCostCents: number;
  lineAmounts: LineAmounts[];
};

const eligible = (l: PricedLine, d: AppliedDiscount) => {
  const productAllow = d.productId ? [d.productId] : (d.eligibleProductIds ?? []);
  const collectionAllow = d.eligibleCollectionIds ?? [];
  const isEligibleProduct = productAllow.length === 0 || productAllow.includes(l.productId);
  const isEligibleCategory = !d.categoryId || l.categoryId === d.categoryId;
  const isEligibleCollection = collectionAllow.length === 0 || (l.collectionId != null && collectionAllow.includes(l.collectionId));
  const isExcludedProduct = (d.excludedProductIds ?? []).includes(l.productId);
  const isExcludedCollection = l.collectionId != null && (d.excludedCollectionIds ?? []).includes(l.collectionId);
  return isEligibleProduct && isEligibleCategory && isEligibleCollection && !isExcludedProduct && !isExcludedCollection;
};

export function eligibleSubtotal(lines: PricedLine[], d: AppliedDiscount): number {
  return lines.filter((l) => eligible(l, d)).reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
}

/** Split an order discount across eligible lines pro rata. Largest remainder, so the parts always sum exactly. */
export function allocateDiscount(lines: PricedLine[], d: AppliedDiscount | null, discountCents: number): number[] {
  const out = lines.map(() => 0);
  if (!d || discountCents <= 0) return out;
  const idx = lines.map((l, i) => i).filter((i) => eligible(lines[i]!, d));
  const base = idx.reduce((a, i) => a + lines[i]!.unitPriceCents * lines[i]!.quantity, 0);
  if (!base) return out;
  const exact = idx.map((i) => (discountCents * lines[i]!.unitPriceCents * lines[i]!.quantity) / base);
  idx.forEach((i, k) => (out[i] = Math.floor(exact[k]!)));
  let left = discountCents - idx.reduce((a, i) => a + out[i]!, 0);
  const order = idx.map((i, k) => ({ i, r: exact[k]! - Math.floor(exact[k]!) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]!.i]! += 1;
  return out;
}

export const marginPct = (profit: number, revenue: number) => (revenue ? Math.round((profit / revenue) * 10_000) / 100 : 0);

export function computeTotals(lines: PricedLine[], discount: AppliedDiscount | null, channel: ChannelRules, express: boolean, shippingMethod?: ResolvedShippingMethod | null): Totals {
  const subtotalCents = lines.reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
  let discountTotalCents = 0;
  let freeShipping = false;
  if (discount) {
    const elig = eligibleSubtotal(lines, discount);
    if (discount.type === "percent") discountTotalCents = Math.round((elig * discount.value) / 100);
    else if (discount.type === "fixed") discountTotalCents = Math.min(discount.value, elig);
    else freeShipping = true;
    if (discount.maxDiscountCents != null) discountTotalCents = Math.min(discountTotalCents, discount.maxDiscountCents);
  }
  const shares = allocateDiscount(lines, discount, discountTotalCents);
  const lineAmounts = lines.map((l, i) => {
    const lineTotalCents = l.unitPriceCents * l.quantity - shares[i]!;
    const lineCostCents = l.unitCostCents * l.quantity;
    return { discountCents: shares[i]!, lineTotalCents, lineCostCents, lineProfitCents: lineTotalCents - lineCostCents };
  });
  const net = subtotalCents - discountTotalCents;
  const costTotalCents = lineAmounts.reduce((a, l) => a + l.lineCostCents, 0);
  let shippingTotalCents = 0;
  if (channel.chargesShipping && subtotalCents > 0) {
    if (shippingMethod) shippingTotalCents = freeShipping || (shippingMethod.waivableAboveThreshold && net >= STORE.freeShippingThresholdCents) ? 0 : shippingMethod.priceCents;
    else shippingTotalCents = express ? STORE.expressShippingCents : freeShipping || net >= STORE.freeShippingThresholdCents ? 0 : STORE.standardShippingCents;
  }
  const shippingCostCents = channel.shipsOrders && subtotalCents > 0
    ? (shippingMethod ? shippingMethod.carrierCostCents : express ? STORE.carrierCostExpressCents : STORE.carrierCostStandardCents)
    : 0;
  const taxTotalCents = calculateTax({ subtotalCents: net, shippingCents: shippingTotalCents }).taxAmountCents;
  const totalCents = net + shippingTotalCents + taxTotalCents;
  const paymentFeeCents = channel.feePercentBp || channel.feeFixedCents ? pct(totalCents, channel.feePercentBp) + channel.feeFixedCents : 0;
  const grossProfitCents = net - costTotalCents;
  return {
    subtotalCents, discountTotalCents, shippingTotalCents, taxTotalCents, totalCents, costTotalCents,
    grossProfitCents, grossMargin: marginPct(grossProfitCents, net), paymentFeeCents, shippingCostCents, lineAmounts,
  };
}
