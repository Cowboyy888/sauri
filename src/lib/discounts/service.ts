import { and, count, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { discountUsages, discounts, orders } from "../db/schema";
import { ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { eligibleSubtotal, type PricedLine } from "../orders/pricing";
import { formatMoney } from "../money";

export type DiscountRow = typeof discounts.$inferSelect;

/** Server-side validation of a discount code against a re-priced cart. Throws a customer-safe message. */
export async function validateDiscount(tx: DbOrTx, code: string, lines: PricedLine[], customerId: string | null, now = new Date()): Promise<DiscountRow> {
  const clean = code.trim().toUpperCase();
  const [d] = await tx.select().from(discounts).where(sql`upper(${discounts.code}) = ${clean}`);
  if (!d || !d.active) throw new ValidationError(`${clean} is not a valid code.`);
  if (now < d.startsAt) throw new ValidationError("This code is not active yet.");
  if (d.endsAt && now > d.endsAt) throw new ValidationError("This code has expired.");
  if (d.usageLimit != null && d.usedCount >= d.usageLimit) throw new ValidationError("This code has reached its usage limit.");
  const subtotal = lines.reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
  if (subtotal < d.minSubtotalCents) throw new ValidationError(`This code needs a minimum order of ${formatMoney(d.minSubtotalCents)}.`);
  if ((d.categoryId || d.productId) && eligibleSubtotal(lines, { ...d, type: d.type }) === 0) throw new ValidationError("This code does not apply to the items in your bag.");
  if (d.perCustomerLimit != null && customerId) {
    const [u] = await tx.select({ n: count() }).from(discountUsages)
      .innerJoin(orders, eq(orders.id, discountUsages.orderId))
      .where(and(eq(discountUsages.discountId, d.id), eq(discountUsages.customerId, customerId), sql`${orders.status} <> 'cancelled'`));
    if ((u?.n ?? 0) >= d.perCustomerLimit) throw new ValidationError("You have already used this code.");
  }
  return d;
}

/** Atomically consume one use; fails if a concurrent order took the last one. */
export async function consumeDiscount(tx: DbOrTx, d: DiscountRow, orderId: string, customerId: string, amountCents: number) {
  const updated = await tx.update(discounts).set({ usedCount: sql`${discounts.usedCount} + 1` })
    .where(and(eq(discounts.id, d.id), sql`(${discounts.usageLimit} IS NULL OR ${discounts.usedCount} < ${discounts.usageLimit})`))
    .returning({ id: discounts.id });
  if (!updated.length) throw new ValidationError("This code has reached its usage limit.");
  await tx.insert(discountUsages).values({ discountId: d.id, orderId, customerId, amountCents });
}

export type NewDiscount = Omit<typeof discounts.$inferInsert, "id" | "usedCount" | "createdAt">;
export async function createDiscount(db: Db, actor: Actor, input: NewDiscount) {
  assertCan(actor, "discounts:write");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new ValidationError("Use 3 to 20 letters or numbers for the code.");
  const value = input.value ?? 0;
  if (input.type === "percent" && !(value > 0 && value <= 100)) throw new ValidationError("Percentage must be between 1 and 100.");
  if (input.type === "fixed" && !(value > 0)) throw new ValidationError("Enter an amount above zero.");
  if (input.endsAt && input.startsAt && input.endsAt < input.startsAt) throw new ValidationError("The end date must be after the start date.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(discounts).values({ ...input, code }).onConflictDoNothing().returning();
    if (!row) throw new ValidationError("That code already exists.");
    await audit(tx, actor, "Created discount", "discount", code, undefined, { type: row.type, value: row.value });
    return row;
  });
}
