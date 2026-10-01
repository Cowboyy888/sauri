/**
 * Payment reconciliation (brief §15) — compares an internal `payments` row against the payment provider's
 * own record. For `provider = 'stripe'` rows this calls the real Stripe API (test mode); everything else
 * (cash, manual, card terminal, bank transfer) has no electronic provider to check against, so it starts
 * IGNORED until a manager enters what the bank/register actually shows. See docs/RECONCILIATION.md.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { orders, payments, reconciliationRecords } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { getStripe } from "../payments/stripe";
import { n, rows } from "../admin/sql";
import type { Range } from "../analytics/service";

export type ReconciliationStatus = (typeof reconciliationRecords.$inferSelect)["status"];

/** Pure classification, unit-testable without a database or Stripe (docs/RECONCILIATION.md). */
export function classify(internalCents: number, externalCents: number | null): ReconciliationStatus {
  if (externalCents == null) return "UNMATCHED";
  if (externalCents === internalCents) return "MATCHED";
  if (externalCents > 0 && externalCents < internalCents) return "PARTIAL";
  return "DISCREPANCY";
}

export type ReconciliationRow = {
  id: string | null; paymentId: string; orderId: string; orderNumber: string; provider: string; transactionRef: string | null;
  internalAmountCents: number; externalAmountCents: number | null; status: ReconciliationStatus; checkedAt: Date | null;
  reviewedAt: Date | null; notes: string | null; paidAt: Date;
};
/** Every succeeded/refunded payment in range, left-joined to its (possibly not-yet-run) reconciliation
 *  record, so a payment nobody has checked yet still shows up as a row to act on. */
export async function listReconciliationCandidates(db: DbOrTx, r: Range): Promise<ReconciliationRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select p.id as payment_id, o.id as order_id, o.order_number, p.provider, p.provider_ref, p.amount_cents,
      rr.id as rec_id, rr.external_amount_cents, rr.status, rr.checked_at, rr.reviewed_at, rr.notes, o.paid_at
    from payments p join orders o on o.id = p.order_id
    left join reconciliation_records rr on rr.payment_id = p.id
    where p.status in ('succeeded', 'refunded') and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
    order by o.paid_at desc`);
  return res.map((x) => ({
    id: x.rec_id ?? null, paymentId: x.payment_id!, orderId: x.order_id!, orderNumber: x.order_number!, provider: x.provider!, transactionRef: x.provider_ref ?? null,
    internalAmountCents: n(x.amount_cents), externalAmountCents: x.external_amount_cents != null ? n(x.external_amount_cents) : null,
    status: (x.status as ReconciliationStatus) ?? (x.provider === "stripe" ? "UNMATCHED" : "IGNORED"),
    checkedAt: x.checked_at ? new Date(x.checked_at) : null, reviewedAt: x.reviewed_at ? new Date(x.reviewed_at) : null, notes: x.notes ?? null,
    paidAt: new Date(x.paid_at!),
  }));
}

async function upsertRecord(db: Db, payment: { id: string; orderId: string; amountCents: number; providerRef: string | null }, patch: { externalAmountCents: number | null; status: ReconciliationStatus; notes?: string | null }) {
  const [row] = await db.insert(reconciliationRecords).values({
    paymentId: payment.id, orderId: payment.orderId, internalAmountCents: payment.amountCents, transactionRef: payment.providerRef,
    externalAmountCents: patch.externalAmountCents, status: patch.status, checkedAt: new Date(), notes: patch.notes ?? null,
  }).onConflictDoUpdate({
    target: reconciliationRecords.paymentId,
    set: { externalAmountCents: patch.externalAmountCents, status: patch.status, checkedAt: new Date(), notes: patch.notes ?? null, updatedAt: new Date() },
  }).returning();
  return row!;
}

/** Live check against Stripe for one payment (brief §15's "compare against actual payment records"). Only
 *  meaningful for `provider = 'stripe'` rows with a stored reference. */
export async function runStripeReconciliation(db: Db, actor: Actor, paymentId: string) {
  assertCan(actor, "finance:write");
  const [row] = await db.select({ p: payments, orderId: orders.id }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(payments.id, paymentId));
  if (!row) throw new NotFoundError("Payment not found.");
  if (row.p.provider !== "stripe") throw new ValidationError("Only Stripe payments can be checked automatically — enter the external amount manually for this one.");
  if (!row.p.providerRef) return upsertRecord(db, { id: row.p.id, orderId: row.orderId, amountCents: row.p.amountCents, providerRef: null }, { externalAmountCents: null, status: "UNMATCHED", notes: "No provider reference recorded yet." });
  let externalCents: number | null = null;
  try {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(row.p.providerRef).catch(() => null);
    externalCents = intent?.amount_received ?? intent?.amount ?? null;
  } catch { externalCents = null; }
  const result = await upsertRecord(db, { id: row.p.id, orderId: row.orderId, amountCents: row.p.amountCents, providerRef: row.p.providerRef }, { externalAmountCents: externalCents, status: classify(row.p.amountCents, externalCents) });
  await audit(db, actor, "Ran payment reconciliation", "reconciliation_record", result.id, undefined, { paymentId, status: result.status });
  return result;
}

/** Manual verification (brief §15) — for cash/manual/bank-transfer payments, or any Stripe row a staff
 *  member wants to double-check against a statement by hand. */
export async function recordManualReconciliation(db: Db, actor: Actor, paymentId: string, input: { externalAmountCents: number | null; notes?: string }) {
  assertCan(actor, "finance:write");
  const [row] = await db.select({ p: payments, orderId: orders.id }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(payments.id, paymentId));
  if (!row) throw new NotFoundError("Payment not found.");
  if (input.externalAmountCents != null && (!Number.isInteger(input.externalAmountCents) || input.externalAmountCents < 0)) throw new ValidationError("Enter an amount of zero or more.");
  const status = input.externalAmountCents == null ? "IGNORED" : classify(row.p.amountCents, input.externalAmountCents);
  const result = await upsertRecord(db, { id: row.p.id, orderId: row.orderId, amountCents: row.p.amountCents, providerRef: row.p.providerRef }, { externalAmountCents: input.externalAmountCents, status, notes: input.notes ?? null });
  await audit(db, actor, "Recorded manual reconciliation", "reconciliation_record", result.id, undefined, { paymentId, status: result.status });
  return result;
}

export async function markReconciliationReviewed(db: Db, actor: Actor, id: string) {
  assertCan(actor, "finance:write");
  const [row] = await db.update(reconciliationRecords).set({ reviewedByUserId: actor.userId, reviewedAt: new Date() }).where(eq(reconciliationRecords.id, id)).returning();
  if (!row) throw new NotFoundError("Reconciliation record not found.");
  await audit(db, actor, "Reviewed reconciliation record", "reconciliation_record", id, undefined, undefined);
  return row;
}
