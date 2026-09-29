/**
 * Partial refunds (brief §19). Full refunds tied to a cancellation still go through
 * `updateOrderStatus(..., "cancelled" | "refunded", { restock })` in service.ts, unchanged — that path
 * also returns goods to stock. This one is a money-only adjustment (goodwill, a partial return already
 * restocked by hand through Inventory, a shipping refund, …) and never touches inventory itself.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orderEvents, orders, payments, refunds } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, emit, notify } from "../audit";
import { formatMoney } from "../money";
import { marginPct } from "./pricing";
import { statusFields, TRANSITIONS } from "./service";
import { reversePointsForRefund } from "../loyalty/service";

export type RefundInput = { amountCents: number; reason?: string; returnRequestId?: string };
const REFUNDABLE_STATUSES = ["paid", "processing", "shipped", "delivered"] as const;

export async function refundOrder(db: Db, actor: Actor, orderId: string, input: RefundInput) {
  assertCan(actor, "orders:write");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ValidationError("Enter a refund amount above zero.");
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) throw new NotFoundError("Order not found.");
    if (!(REFUNDABLE_STATUSES as readonly string[]).includes(o.status)) throw new ValidationError(`An order that is ${o.status} cannot be refunded.`);
    const netRevenue = o.subtotalCents - o.discountTotalCents;
    const refundable = netRevenue - o.refundTotalCents;
    if (input.amountCents > refundable) throw new ValidationError(`You can refund at most ${formatMoney(refundable)}.`);

    const refundTotalCents = o.refundTotalCents + input.amountCents;
    const full = refundTotalCents >= netRevenue;
    const grossProfitCents = netRevenue - refundTotalCents - o.costTotalCents;
    const grossMargin = marginPct(grossProfitCents, netRevenue - refundTotalCents);
    const paymentStatus = full ? "refunded" : "partially_refunded";

    const set: Partial<typeof orders.$inferInsert> = { refundTotalCents, grossProfitCents, grossMargin, paymentStatus };
    if (full && TRANSITIONS[o.status].includes("refunded")) Object.assign(set, statusFields("refunded", o));
    await tx.update(orders).set(set).where(eq(orders.id, o.id));

    const [p] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.orderId, o.id), eq(payments.status, "succeeded")));
    await tx.insert(refunds).values({ orderId: o.id, paymentId: p?.id ?? null, amountCents: input.amountCents, reason: input.reason ?? null, restocked: false, returnRequestId: input.returnRequestId ?? null, userId: actor.userId });
    if (full) await tx.update(payments).set({ status: "refunded" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "succeeded")));
    await reversePointsForRefund(tx, o, input.amountCents);

    await tx.insert(orderEvents).values({ orderId: o.id, status: (set.status as typeof o.status) ?? o.status, note: `Refunded ${formatMoney(input.amountCents)}${full ? " (full)" : " (partial)"}${input.reason ? `: ${input.reason}` : ""}`, userId: actor.userId });
    await audit(tx, actor, "Refunded order", "order", o.orderNumber, { refundTotalCents: o.refundTotalCents }, { refundTotalCents, amountCents: input.amountCents, full });
    await notify(tx, "refund", `Refund issued ${o.orderNumber}`, `${formatMoney(input.amountCents)} refunded (${full ? "full" : "partial"})`, o.orderNumber);
    await emit(tx, { type: "order.status", orderNumber: o.orderNumber, status: paymentStatus });
    return { full, refundTotalCents, remainingRefundableCents: netRevenue - refundTotalCents };
  });
}
