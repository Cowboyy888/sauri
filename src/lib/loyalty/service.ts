/**
 * Loyalty: points, tiers, rewards and redemption (brief §23-29). See docs/LOYALTY.md.
 *
 * The balance on `loyalty_accounts` is a cached total; `writeLoyaltyTransaction()` is the *only* place
 * that ever changes it, and it always does so in the same statement as inserting the transaction row that
 * explains the change — there is no path that updates the balance without a transaction record (brief §25).
 *
 * Rewards are redeemed as ordinary `discounts` rows scoped to one customer (`restricted_to_customer_id`),
 * reusing the existing discount engine end to end rather than building a second one (brief §29).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import {
  customers, discounts, loyaltyAccounts, loyaltyRedemptions, loyaltyRewards, loyaltyTiers, loyaltyTransactions, orders, settings,
} from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { DEFAULT_LOYALTY_SETTINGS } from "../db/reference-data";
import { emailProvider, loyaltyRewardIssuedEmail } from "../email/provider";

export async function getLoyaltySettings(db: DbOrTx) {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "loyalty"));
  return { ...DEFAULT_LOYALTY_SETTINGS, ...(row?.value as Partial<typeof DEFAULT_LOYALTY_SETTINGS> | undefined) };
}

export async function setLoyaltySettings(db: Db, actor: Actor, patch: Partial<typeof DEFAULT_LOYALTY_SETTINGS>) {
  assertCan(actor, "loyalty:write");
  const before = await getLoyaltySettings(db);
  const next = { ...before, ...patch };
  if (!Number.isFinite(next.pointsPerDollar) || next.pointsPerDollar < 0) throw new ValidationError("Points per dollar must be zero or more.");
  await db.insert(settings).values({ key: "loyalty", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Updated loyalty settings", "settings", "loyalty", before, next);
  return next;
}

async function getOrCreateAccount(tx: Tx, customerId: string) {
  const [existing] = await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)).for("update");
  if (existing) return existing;
  const [created] = await tx.insert(loyaltyAccounts).values({ customerId }).onConflictDoNothing().returning();
  if (created) return created;
  const [row] = await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)).for("update");
  return row!;
}

/** The single writer of `loyalty_accounts.points_balance` (brief §25). `points` is signed; a reversal or
 *  redemption is clamped so the balance never goes negative — a customer can't be made to owe points for
 *  ones they already spent (docs/LOYALTY.md explains this explicitly). Returns the actual points applied. */
async function writeLoyaltyTransaction(tx: Tx, customerId: string, type: typeof loyaltyTransactions.$inferInsert["type"], points: number, opts: { referenceType?: string; referenceId?: string; reason?: string; userId?: string | null } = {}): Promise<number> {
  const account = await getOrCreateAccount(tx, customerId);
  const applied = points < 0 ? -Math.min(-points, account.pointsBalance) : points;
  if (applied === 0) return 0;
  const balanceAfter = account.pointsBalance + applied;
  await tx.update(loyaltyAccounts).set({
    pointsBalance: balanceAfter,
    lifetimePointsEarned: applied > 0 ? account.lifetimePointsEarned + applied : account.lifetimePointsEarned,
    lifetimePointsRedeemed: applied < 0 && type === "REDEEM" ? account.lifetimePointsRedeemed - applied : account.lifetimePointsRedeemed,
  }).where(eq(loyaltyAccounts.id, account.id));
  await tx.insert(loyaltyTransactions).values({
    accountId: account.id, type, points: applied, balanceBefore: account.pointsBalance, balanceAfter,
    referenceType: opts.referenceType, referenceId: opts.referenceId, reason: opts.reason, userId: opts.userId ?? null,
  });
  return applied;
}

/** Lifetime *net* spend (subtotal − discount − refund) across recognized orders, the same figure
 *  `customer_stats` already reports elsewhere — the single number both tier and points-earning read. */
async function netLifetimeSpend(tx: DbOrTx, customerId: string): Promise<number> {
  const [row] = await tx.select({ v: sql<number>`coalesce(sum(${orders.subtotalCents} - ${orders.discountTotalCents} - ${orders.refundTotalCents}), 0)::int` })
    .from(orders).where(and(eq(orders.customerId, customerId), sql`${orders.paidAt} is not null`, sql`${orders.status} <> 'cancelled'`));
  return row?.v ?? 0;
}

export type LoyaltyTier = typeof loyaltyTiers.$inferSelect;
/** The tier is derived from lifetime spend every time it's read, never stored — a spend threshold change
 *  in settings takes effect immediately for everyone, with nothing to migrate. */
export async function getCustomerTier(db: DbOrTx, customerId: string): Promise<{ tier: LoyaltyTier | null; nextTier: LoyaltyTier | null; netLifetimeSpendCents: number }> {
  const [spend, tiers] = await Promise.all([netLifetimeSpend(db, customerId), db.select().from(loyaltyTiers).where(eq(loyaltyTiers.active, true)).orderBy(loyaltyTiers.minSpendCents)]);
  let tier: LoyaltyTier | null = null, nextTier: LoyaltyTier | null = null;
  for (const t of tiers) { if (spend >= t.minSpendCents) tier = t; else { nextTier = t; break; } }
  return { tier, nextTier, netLifetimeSpendCents: spend };
}

/** Awards points for a just-paid order (brief §24). "Completed order" here means the same "recognized,
 *  paid, not cancelled" order every other financial figure in this codebase already uses (docs/LOYALTY.md
 *  explains why this isn't gated on the Phase 5 fulfillment-completion milestone). Points are earned on net
 *  merchandise revenue (subtotal − discount, excluding tax/shipping), multiplied by the customer's *current*
 *  tier bonus (computed from their spend *before* this order, so the same order can't retroactively bump
 *  itself into a higher-multiplier tier). No-ops if the loyalty program is disabled or this order already
 *  has an EARN transaction (idempotent against a re-run). */
export async function earnPointsForOrder(tx: Tx, order: { id: string; orderNumber: string; customerId: string; subtotalCents: number; discountTotalCents: number }) {
  const cfg = await getLoyaltySettings(tx);
  if (!cfg.enabled || cfg.pointsPerDollar <= 0) return;
  const [already] = await tx.select({ id: loyaltyTransactions.id }).from(loyaltyTransactions)
    .innerJoin(loyaltyAccounts, eq(loyaltyAccounts.id, loyaltyTransactions.accountId))
    .where(and(eq(loyaltyAccounts.customerId, order.customerId), eq(loyaltyTransactions.referenceType, "order"), eq(loyaltyTransactions.referenceId, order.id), eq(loyaltyTransactions.type, "EARN")));
  if (already) return;
  const netCents = order.subtotalCents - order.discountTotalCents;
  if (netCents <= 0) return;
  const { tier } = await getCustomerTier(tx, order.customerId);
  const multiplier = tier?.benefits?.bonusPointsMultiplier ?? 1;
  const points = Math.floor((netCents / 100) * cfg.pointsPerDollar * multiplier);
  if (points <= 0) return;
  await writeLoyaltyTransaction(tx, order.customerId, "EARN", points, { referenceType: "order", referenceId: order.id, reason: `Order ${order.orderNumber}` });
}

/** Reverses the proportional share of an order's earned points when it's refunded (brief §24). Proportional
 *  to how much of the order's net revenue was refunded; clamped so the balance never goes negative if the
 *  points were already spent. No-ops if the order never earned points (program was off, or predates it). */
export async function reversePointsForRefund(tx: Tx, order: { id: string; customerId: string; orderNumber: string; subtotalCents: number; discountTotalCents: number }, refundAmountCents: number) {
  if (refundAmountCents <= 0) return;
  const [earn] = await tx.select({ points: loyaltyTransactions.points }).from(loyaltyTransactions)
    .innerJoin(loyaltyAccounts, eq(loyaltyAccounts.id, loyaltyTransactions.accountId))
    .where(and(eq(loyaltyAccounts.customerId, order.customerId), eq(loyaltyTransactions.referenceType, "order"), eq(loyaltyTransactions.referenceId, order.id), eq(loyaltyTransactions.type, "EARN")));
  if (!earn) return;
  const netCents = order.subtotalCents - order.discountTotalCents;
  if (netCents <= 0) return;
  const share = Math.min(1, refundAmountCents / netCents);
  const reversal = Math.round(earn.points * share);
  if (reversal <= 0) return;
  await writeLoyaltyTransaction(tx, order.customerId, "REFUND_REVERSAL", -reversal, { referenceType: "order", referenceId: order.id, reason: `Refund of ${order.orderNumber}` });
}

export async function adjustPoints(db: Db, actor: Actor, customerId: string, points: number, reason: string) {
  assertCan(actor, "loyalty:write");
  if (!Number.isInteger(points) || points === 0) throw new ValidationError("Enter a non-zero whole number of points.");
  if (!reason.trim()) throw new ValidationError("Enter a reason for this adjustment.");
  return db.transaction(async (tx) => {
    const applied = await writeLoyaltyTransaction(tx, customerId, "ADJUSTMENT", points, { referenceType: "admin", reason: reason.trim(), userId: actor.userId });
    await audit(tx, actor, "Adjusted loyalty points", "customer", customerId, undefined, { points, applied, reason });
    return { applied };
  });
}

export async function getLoyaltySummary(db: DbOrTx, customerId: string) {
  const [[account], tierInfo, recentTx, redemptions] = await Promise.all([
    db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)),
    getCustomerTier(db, customerId),
    db.select().from(loyaltyTransactions).innerJoin(loyaltyAccounts, eq(loyaltyAccounts.id, loyaltyTransactions.accountId)).where(eq(loyaltyAccounts.customerId, customerId)).orderBy(desc(loyaltyTransactions.createdAt)).limit(25),
    db.select().from(loyaltyRedemptions).where(eq(loyaltyRedemptions.customerId, customerId)).orderBy(desc(loyaltyRedemptions.createdAt)),
  ]);
  return {
    pointsBalance: account?.pointsBalance ?? 0, lifetimePointsEarned: account?.lifetimePointsEarned ?? 0,
    tier: tierInfo.tier, nextTier: tierInfo.nextTier, netLifetimeSpendCents: tierInfo.netLifetimeSpendCents,
    centsToNextTier: tierInfo.nextTier ? Math.max(0, tierInfo.nextTier.minSpendCents - tierInfo.netLifetimeSpendCents) : 0,
    transactions: recentTx.map((r) => r.loyalty_transactions), redemptions,
  };
}

/** Redeems a reward into a customer-restricted, single-use discount code (brief §29) — a customer-facing
 *  action, not a staff one, so it isn't gated by `assertCan`; ownership is the customerId argument itself. */
export async function redeemReward(db: Db, customerId: string, rewardId: string) {
  return db.transaction(async (tx) => {
    const [reward] = await tx.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, rewardId), eq(loyaltyRewards.active, true)));
    if (!reward) throw new NotFoundError("Reward not found.");
    const account = await getOrCreateAccount(tx, customerId);
    if (account.pointsBalance < reward.pointsCost) throw new ValidationError("Not enough points for this reward.");

    const code = `LOY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const [discount] = await tx.insert(discounts).values({
      code, type: reward.rewardType, value: reward.rewardValue, usageLimit: 1, perCustomerLimit: 1,
      restrictedToCustomerId: customerId, active: true,
    }).returning();

    const applied = await writeLoyaltyTransaction(tx, customerId, "REDEEM", -reward.pointsCost, { referenceType: "redemption", reason: `Redeemed: ${reward.name}` });
    if (applied !== -reward.pointsCost) throw new ValidationError("Not enough points for this reward.");

    const [redemption] = await tx.insert(loyaltyRedemptions).values({ customerId, rewardId, pointsSpent: reward.pointsCost, discountId: discount!.id }).returning();
    const [c] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, customerId));
    if (c) await emailProvider.send(loyaltyRewardIssuedEmail({ email: c.email, rewardName: reward.name, code }));
    return { redemption: redemption!, code };
  });
}

export async function listCustomerRewards(db: DbOrTx) {
  return db.select().from(loyaltyRewards).where(eq(loyaltyRewards.active, true)).orderBy(loyaltyRewards.pointsCost);
}

/* ------------------------------------------------------------------ admin */
export async function listAllTiers(db: Db) { return db.select().from(loyaltyTiers).orderBy(loyaltyTiers.position); }
export async function listAllRewards(db: Db) { return db.select().from(loyaltyRewards).orderBy(loyaltyRewards.pointsCost); }

export type NewTierInput = { name: string; minSpendCents: number; benefits: Record<string, unknown>; position?: number; active?: boolean };
export async function saveTier(db: Db, actor: Actor, id: string | undefined, input: NewTierInput) {
  assertCan(actor, "loyalty:write");
  if (!input.name.trim()) throw new ValidationError("Enter a tier name.");
  if (input.minSpendCents < 0) throw new ValidationError("Minimum spend can't be negative.");
  if (id) {
    const [before] = await db.select().from(loyaltyTiers).where(eq(loyaltyTiers.id, id));
    if (!before) throw new NotFoundError("Tier not found.");
    await db.update(loyaltyTiers).set({ name: input.name.trim(), minSpendCents: input.minSpendCents, benefits: input.benefits, position: input.position ?? before.position, active: input.active ?? before.active }).where(eq(loyaltyTiers.id, id));
    await audit(db, actor, "Updated loyalty tier", "loyalty_tier", id, before, input);
  } else {
    const [row] = await db.insert(loyaltyTiers).values({ name: input.name.trim(), minSpendCents: input.minSpendCents, benefits: input.benefits, position: input.position ?? 0, active: input.active ?? true }).returning();
    await audit(db, actor, "Created loyalty tier", "loyalty_tier", row!.id, undefined, input);
  }
}

export type NewRewardInput = { name: string; description?: string; pointsCost: number; rewardType: "percent" | "fixed" | "free_shipping"; rewardValue: number; active?: boolean };
export async function saveReward(db: Db, actor: Actor, id: string | undefined, input: NewRewardInput) {
  assertCan(actor, "loyalty:write");
  if (!input.name.trim()) throw new ValidationError("Enter a reward name.");
  if (!(input.pointsCost > 0)) throw new ValidationError("Points cost must be above zero.");
  if (input.rewardType === "percent" && !(input.rewardValue > 0 && input.rewardValue <= 100)) throw new ValidationError("Percentage must be between 1 and 100.");
  if (id) {
    const [before] = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, id));
    if (!before) throw new NotFoundError("Reward not found.");
    await db.update(loyaltyRewards).set({ name: input.name.trim(), description: input.description?.trim() ?? "", pointsCost: input.pointsCost, rewardType: input.rewardType, rewardValue: input.rewardValue, active: input.active ?? before.active }).where(eq(loyaltyRewards.id, id));
    await audit(db, actor, "Updated loyalty reward", "loyalty_reward", id, before, input);
  } else {
    const [row] = await db.insert(loyaltyRewards).values({ name: input.name.trim(), description: input.description?.trim() ?? "", pointsCost: input.pointsCost, rewardType: input.rewardType, rewardValue: input.rewardValue, active: input.active ?? true }).returning();
    await audit(db, actor, "Created loyalty reward", "loyalty_reward", row!.id, undefined, input);
  }
}

export async function loyaltyKpis(db: DbOrTx) {
  const [row] = await db.select({
    members: sql<number>`count(*)::int`,
    issued: sql<number>`coalesce(sum(${loyaltyAccounts.lifetimePointsEarned}), 0)::int`,
    redeemed: sql<number>`coalesce(sum(${loyaltyAccounts.lifetimePointsRedeemed}), 0)::int`,
    outstanding: sql<number>`coalesce(sum(${loyaltyAccounts.pointsBalance}), 0)::int`,
  }).from(loyaltyAccounts);
  const top = await db.select({ customerId: loyaltyAccounts.customerId, name: customers.name, pointsBalance: loyaltyAccounts.pointsBalance })
    .from(loyaltyAccounts).innerJoin(customers, eq(customers.id, loyaltyAccounts.customerId)).orderBy(desc(loyaltyAccounts.pointsBalance)).limit(10);
  return { members: row?.members ?? 0, pointsIssued: row?.issued ?? 0, pointsRedeemed: row?.redeemed ?? 0, pointsOutstanding: row?.outstanding ?? 0, topCustomers: top };
}
