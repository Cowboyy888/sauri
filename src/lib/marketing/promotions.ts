/**
 * Promotions and coupons (brief §13-17) — both are the same `discounts` row (see docs/PHASE_7_AUDIT.md,
 * "Promotions and coupons are one system, not two"). This module is the richer authoring/analytics layer
 * on top of the Phase 1/2 `discounts` table and `lib/discounts/service.ts`'s validation (still the only
 * place a code is checked at checkout — never duplicated here). Gated on the new `marketing` permission
 * area, not the legacy OWNER-only `discounts` area (docs/ROLES_AND_PERMISSIONS.md).
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { discounts, marketingCampaigns } from "../db/schema";
import { ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { n, rows } from "../admin/sql";
import { SEGMENT_KEYS } from "../crm/segments";

export type PromotionRow = typeof discounts.$inferSelect;

export type PromotionInput = {
  name?: string; code: string; type: "percent" | "fixed" | "free_shipping"; value?: number;
  categoryId?: string | null; productId?: string | null;
  eligibleProductIds?: string[]; excludedProductIds?: string[]; eligibleCollectionIds?: string[]; excludedCollectionIds?: string[];
  eligibleSegments?: string[]; firstOrderOnly?: boolean;
  minSubtotalCents?: number; maxDiscountCents?: number | null;
  startsAt?: Date; endsAt?: Date | null; usageLimit?: number | null; perCustomerLimit?: number | null;
  campaignId?: string | null;
};

function validateCommon(input: Partial<Omit<PromotionInput, "code">>) {
  if (input.type === "percent" && input.value != null && !(input.value > 0 && input.value <= 100)) throw new ValidationError("Percentage must be between 1 and 100.");
  if (input.type === "fixed" && input.value != null && !(input.value > 0)) throw new ValidationError("Enter an amount above zero.");
  if (input.endsAt && input.startsAt && input.endsAt < input.startsAt) throw new ValidationError("The end date must be after the start date.");
  if (input.eligibleSegments?.some((s) => !(SEGMENT_KEYS as readonly string[]).includes(s))) throw new ValidationError("Unknown customer segment.");
  if (input.minSubtotalCents != null && input.minSubtotalCents < 0) throw new ValidationError("Minimum order can't be negative.");
  if (input.maxDiscountCents != null && input.maxDiscountCents < 0) throw new ValidationError("Maximum discount can't be negative.");
}

export async function createPromotion(db: Db, actor: Actor, input: PromotionInput): Promise<PromotionRow> {
  assertCan(actor, "marketing:write");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new ValidationError("Use 3 to 20 letters or numbers for the code.");
  const value = input.value ?? 0;
  if (input.type === "percent" && !(value > 0 && value <= 100)) throw new ValidationError("Percentage must be between 1 and 100.");
  if (input.type === "fixed" && !(value > 0)) throw new ValidationError("Enter an amount above zero.");
  validateCommon(input);
  return db.transaction(async (tx) => {
    if (input.campaignId) {
      const [c] = await tx.select({ id: marketingCampaigns.id }).from(marketingCampaigns).where(eq(marketingCampaigns.id, input.campaignId));
      if (!c) throw new ValidationError("Campaign not found.");
    }
    const [row] = await tx.insert(discounts).values({
      code, name: input.name?.trim() || null, type: input.type, value: input.value ?? 0,
      categoryId: input.categoryId ?? null, productId: input.productId ?? null,
      eligibleProductIds: input.eligibleProductIds ?? [], excludedProductIds: input.excludedProductIds ?? [],
      eligibleCollectionIds: input.eligibleCollectionIds ?? [], excludedCollectionIds: input.excludedCollectionIds ?? [],
      eligibleSegments: input.eligibleSegments ?? [], firstOrderOnly: input.firstOrderOnly ?? false,
      minSubtotalCents: input.minSubtotalCents ?? 0, maxDiscountCents: input.maxDiscountCents ?? null,
      startsAt: input.startsAt ?? new Date(), endsAt: input.endsAt ?? null,
      usageLimit: input.usageLimit ?? null, perCustomerLimit: input.perCustomerLimit ?? null,
      campaignId: input.campaignId ?? null,
    }).onConflictDoNothing().returning();
    if (!row) throw new ValidationError("That code already exists.");
    await audit(tx, actor, "Created promotion", "discount", row.code, undefined, { type: row.type, value: row.value, name: row.name });
    return row;
  });
}

export type PromotionPatch = Partial<Omit<PromotionInput, "code">>;
export async function updatePromotion(db: Db, actor: Actor, id: string, patch: PromotionPatch): Promise<PromotionRow> {
  assertCan(actor, "marketing:write");
  validateCommon(patch);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(discounts).where(eq(discounts.id, id));
    if (!before) throw new ValidationError("Promotion not found.");
    const [row] = await tx.update(discounts).set({ ...patch, name: patch.name?.trim() }).where(eq(discounts.id, id)).returning();
    await audit(tx, actor, "Updated promotion", "discount", before.code, before, row);
    return row!;
  });
}

export async function setPromotionActive(db: Db, actor: Actor, id: string, active: boolean) {
  assertCan(actor, "marketing:write");
  const [d] = await db.update(discounts).set({ active }).where(eq(discounts.id, id)).returning();
  if (!d) throw new ValidationError("Promotion not found.");
  await audit(db, actor, active ? "Activated promotion" : "Paused promotion", "discount", d.code, { active: !active }, { active });
  return d;
}

export async function deletePromotion(db: Db, actor: Actor, id: string) {
  assertCan(actor, "marketing:write");
  const [d] = await db.select({ code: discounts.code, usedCount: discounts.usedCount }).from(discounts).where(eq(discounts.id, id));
  if (!d) throw new ValidationError("Promotion not found.");
  if (d.usedCount > 0) throw new ValidationError("This code has been used and can't be deleted — pause it instead.");
  await db.delete(discounts).where(eq(discounts.id, id));
  await audit(db, actor, "Deleted promotion", "discount", d.code, d, undefined);
}

const stateOf = (d: { active: boolean; startsAt: Date; endsAt: Date | null; usageLimit: number | null; usedCount: number }, now = Date.now()) =>
  !d.active ? "paused" : d.endsAt && d.endsAt.getTime() < now ? "expired" : d.startsAt.getTime() > now ? "scheduled" : d.usageLimit != null && d.usedCount >= d.usageLimit ? "expired" : "active";

export type PromotionListRow = PromotionRow & { categoryName: string | null; productName: string | null; campaignSlug: string | null; state: ReturnType<typeof stateOf> };
export async function listPromotions(db: DbOrTx): Promise<PromotionListRow[]> {
  const res = await db.select({
    d: discounts,
    categoryName: sql<string | null>`(select name from categories where id = ${discounts.categoryId})`,
    productName: sql<string | null>`(select name from products where id = ${discounts.productId})`,
    campaignSlug: sql<string | null>`(select slug from marketing_campaigns where id = ${discounts.campaignId})`,
  }).from(discounts).orderBy(sql`${discounts.createdAt} desc`);
  return res.map((r) => ({ ...r.d, categoryName: r.categoryName, productName: r.productName, campaignSlug: r.campaignSlug, state: stateOf(r.d) }));
}

/** Coupon analytics (brief §16): usage, orders, revenue, discount cost, AOV, new vs. returning customers —
 *  all from the same discount_usages ⋈ orders join every other money figure in this codebase uses. */
export type CouponAnalytics = {
  usageCount: number; orders: number; revenueCents: number; discountCostCents: number; averageOrderValueCents: number;
  newCustomers: number; returningCustomers: number;
};
export async function getCouponAnalytics(db: DbOrTx, discountId: string): Promise<CouponAnalytics> {
  const [row] = await rows<Record<string, string | null>>(db, sql`
    select count(*) as usage_count, count(distinct u.order_id) as orders,
      coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents), 0) as revenue,
      coalesce(sum(u.amount_cents), 0) as discount_cost,
      count(distinct u.customer_id) filter (where (select count(*) from orders fo where fo.customer_id = u.customer_id and fo.paid_at is not null and fo.paid_at < o.paid_at) = 0) as new_customers,
      count(distinct u.customer_id) filter (where (select count(*) from orders fo where fo.customer_id = u.customer_id and fo.paid_at is not null and fo.paid_at < o.paid_at) > 0) as returning_customers
    from discount_usages u join orders o on o.id = u.order_id and o.paid_at is not null
    where u.discount_id = ${discountId}`);
  const orders = n(row?.orders), revenue = n(row?.revenue);
  return {
    usageCount: n(row?.usage_count), orders, revenueCents: revenue, discountCostCents: n(row?.discount_cost),
    averageOrderValueCents: orders ? Math.round(revenue / orders) : 0,
    newCustomers: n(row?.new_customers), returningCustomers: n(row?.returning_customers),
  };
}

export async function listCouponUsages(db: DbOrTx, discountId: string) {
  const res = await rows<Record<string, string | null>>(db, sql`
    select o.order_number, o.paid_at, o.total_cents, u.amount_cents, c.name as customer, c.email
    from discount_usages u join orders o on o.id = u.order_id join customers c on c.id = u.customer_id
    where u.discount_id = ${discountId} order by u.created_at desc limit 500`);
  return res.map((r) => ({ orderNumber: r.order_number!, paidAt: r.paid_at ? new Date(r.paid_at) : null, totalCents: n(r.total_cents), amountCents: n(r.amount_cents), customer: r.customer!, email: r.email! }));
}
