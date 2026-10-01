/**
 * Supplier payment tracking (brief §9) — a finance-flavored read model over the existing Phase 8 purchase
 * order system. `recordPurchasePayment()` (lib/purchasing/orders.ts) stays the only write path; this module
 * only reads. CANCELLED is read directly off the purchase order's own status rather than duplicated into
 * `purchase_payment_status` (docs/PHASE_8_AUDIT.md's "OVERDUE is derived, never stored" precedent, extended
 * to this one additional display-only state).
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { n, rows } from "../admin/sql";

export type SupplierPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
export type SupplierPaymentRow = {
  purchaseOrderId: string; poNumber: string; supplierName: string; totalCents: number; amountPaidCents: number; remainingCents: number;
  dueDate: Date | null; status: SupplierPaymentStatus;
};

const OVERDUE_EXPR = sql`(o.status <> 'CANCELLED' and o.payment_status <> 'PAID' and o.due_date is not null and o.due_date < now())`;
const DERIVED_STATUS = sql`case when o.status = 'CANCELLED' then 'CANCELLED' when ${OVERDUE_EXPR} then 'OVERDUE' else o.payment_status::text end`;

export async function listSupplierPayments(db: DbOrTx, opts: { status?: SupplierPaymentStatus; page: number; pageSize: number }): Promise<{ rows: SupplierPaymentRow[]; total: number }> {
  const where = opts.status ? sql`where ${DERIVED_STATUS} = ${opts.status}` : sql``;
  const res = await rows<Record<string, string | null>>(db, sql`
    select o.id, o.po_number, s.name as supplier_name, o.total_cents, o.amount_paid_cents, o.due_date, ${DERIVED_STATUS} as derived_status, count(*) over () as total
    from purchase_orders o join suppliers s on s.id = o.supplier_id
    ${where}
    order by (${DERIVED_STATUS} = 'OVERDUE') desc, o.due_date nulls last
    limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}`);
  return {
    total: n(res[0]?.total),
    rows: res.map((r) => {
      const totalCents = n(r.total_cents), amountPaidCents = n(r.amount_paid_cents);
      return {
        purchaseOrderId: r.id!, poNumber: r.po_number!, supplierName: r.supplier_name!, totalCents, amountPaidCents,
        remainingCents: totalCents - amountPaidCents, dueDate: r.due_date ? new Date(r.due_date) : null, status: r.derived_status as SupplierPaymentStatus,
      };
    }),
  };
}
