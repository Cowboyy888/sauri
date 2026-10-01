/**
 * Operating expenses and their approval workflow (brief §6-8). `expense_date` (accrual — when the cost was
 * incurred) drives the Management P&L; `paid_at` (cash) drives cash flow — see docs/FINANCIAL_CALCULATIONS.md
 * and docs/EXPENSES.md for why these are deliberately two different dates on the same row.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { expenseCategories, expenses, suppliers, users } from "../db/schema";
import { BusinessError, NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, notify } from "../audit";
import { formatMoney } from "../money";
import { n, rows } from "../admin/sql";
import type { Range } from "../analytics/service";

export type ExpenseRow = typeof expenses.$inferSelect;
export type ExpenseStatus = ExpenseRow["status"];

export const EXPENSE_TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED"],
  APPROVED: ["PAID", "CANCELLED"],
  REJECTED: [],
  PAID: [],
  CANCELLED: [],
};
/** Once an expense has actually affected a report (APPROVED or later), it may never be deleted — only
 *  voided via CANCELLED (brief §8). Everything before that point never touched a report and may be removed. */
const DELETABLE_STATUSES: ExpenseStatus[] = ["DRAFT", "PENDING_APPROVAL", "REJECTED"];

export type NewExpense = {
  categoryId: string; description: string; amountCents: number; currency?: string; paymentMethod?: string | null;
  supplierId?: string | null; referenceNumber?: string | null; notes?: string | null; attachmentUrl?: string | null; expenseDate?: Date;
};
function clean(v: NewExpense) {
  if (!Number.isInteger(v.amountCents) || v.amountCents <= 0) throw new ValidationError("Enter an amount above zero.");
  if (!v.description.trim()) throw new ValidationError("Enter a description.");
  return {
    categoryId: v.categoryId, description: v.description.trim(), amountCents: v.amountCents, currency: (v.currency || "USD").toUpperCase(),
    paymentMethod: v.paymentMethod?.trim() || null, supplierId: v.supplierId || null, referenceNumber: v.referenceNumber?.trim() || null,
    notes: v.notes?.trim() || null, attachmentUrl: v.attachmentUrl?.trim() || null, expenseDate: v.expenseDate ?? new Date(),
  };
}

export async function createExpense(db: Db, actor: Actor, input: NewExpense): Promise<ExpenseRow> {
  assertCan(actor, "finance:write");
  const v = clean(input);
  const [cat] = await db.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, v.categoryId));
  if (!cat) throw new ValidationError("Choose an expense category.");
  const [row] = await db.insert(expenses).values({ ...v, createdByUserId: actor.userId }).returning();
  await audit(db, actor, "Created expense", "expense", row!.expenseNumber, undefined, { description: v.description, amountCents: v.amountCents });
  return row!;
}

/** Only while DRAFT — same posture as a purchase order (Phase 8): once submitted, the numbers on record
 *  shouldn't move under an approver. */
export async function updateExpense(db: Db, actor: Actor, id: string, input: NewExpense): Promise<ExpenseRow> {
  assertCan(actor, "finance:write");
  const v = clean(input);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!before) throw new NotFoundError("Expense not found.");
    if (before.status !== "DRAFT") throw new ValidationError("Only a draft expense can be edited.");
    const [cat] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, v.categoryId));
    if (!cat) throw new ValidationError("Choose an expense category.");
    const [row] = await tx.update(expenses).set(v).where(eq(expenses.id, id)).returning();
    await audit(tx, actor, "Updated expense", "expense", before.expenseNumber, { amountCents: before.amountCents }, { amountCents: v.amountCents });
    return row!;
  });
}

async function transition(db: Db, actor: Actor, id: string, next: ExpenseStatus, set: Partial<typeof expenses.$inferInsert>, action: string) {
  assertCan(actor, "finance:write");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!row) throw new NotFoundError("Expense not found.");
    if (!EXPENSE_TRANSITIONS[row.status].includes(next)) throw new ValidationError(`An expense that is ${row.status.toLowerCase().replace(/_/g, " ")} cannot become ${next.toLowerCase().replace(/_/g, " ")}.`);
    const [after] = await tx.update(expenses).set({ status: next, ...set }).where(eq(expenses.id, id)).returning();
    await audit(tx, actor, action, "expense", row.expenseNumber, { status: row.status }, { status: next });
    return after!;
  });
}

export const submitExpense = (db: Db, actor: Actor, id: string) => transition(db, actor, id, "PENDING_APPROVAL", {}, "Submitted expense for approval");
export const approveExpense = (db: Db, actor: Actor, id: string) => transition(db, actor, id, "APPROVED", { approvedByUserId: actor.userId, approvedAt: new Date() }, "Approved expense");
export async function rejectExpense(db: Db, actor: Actor, id: string, reason: string) {
  return transition(db, actor, id, "REJECTED", { rejectedReason: reason.trim() || null }, "Rejected expense");
}
export async function markExpensePaid(db: Db, actor: Actor, id: string, paidAt?: Date) {
  const row = await transition(db, actor, id, "PAID", { paidAt: paidAt ?? new Date() }, "Marked expense paid");
  await notify(db, "system", `Expense paid ${row.expenseNumber}`, `${formatMoney(row.amountCents)} — ${row.description}`, row.expenseNumber);
  return row;
}
export const cancelExpense = (db: Db, actor: Actor, id: string) => transition(db, actor, id, "CANCELLED", { cancelledAt: new Date() }, "Cancelled expense");

export async function deleteExpense(db: Db, actor: Actor, id: string) {
  assertCan(actor, "finance:write");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!row) throw new NotFoundError("Expense not found.");
    if (!DELETABLE_STATUSES.includes(row.status)) throw new BusinessError("This expense has already affected reporting and can't be deleted — cancel it instead.", "VALIDATION", 422);
    await tx.delete(expenses).where(eq(expenses.id, id));
    await audit(tx, actor, "Deleted expense", "expense", row.expenseNumber, row, undefined);
  });
}

export type ExpenseListRow = {
  id: string; expenseNumber: string; expenseDate: Date; category: string; description: string; amountCents: number; currency: string;
  status: ExpenseStatus; supplierName: string | null; paymentMethod: string | null; createdBy: string | null; approvedBy: string | null; paidAt: Date | null;
};
export async function listExpenses(db: DbOrTx, opts: { range?: Range; status?: ExpenseStatus; categoryId?: string; page: number; pageSize: number }): Promise<{ rows: ExpenseListRow[]; total: number }> {
  const conds = [];
  if (opts.range) conds.push(sql`e.expense_date >= ${opts.range.from.toISOString()} and e.expense_date < ${opts.range.to.toISOString()}`);
  if (opts.status) conds.push(sql`e.status = ${opts.status}`);
  if (opts.categoryId) conds.push(sql`e.category_id = ${opts.categoryId}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const res = await rows<Record<string, string | null>>(db, sql`
    select e.id, e.expense_number, e.expense_date, c.name as category, e.description, e.amount_cents, e.currency, e.status,
      s.name as supplier_name, e.payment_method, cu.name as created_by, au.name as approved_by, e.paid_at, count(*) over () as total
    from expenses e
    join expense_categories c on c.id = e.category_id
    left join suppliers s on s.id = e.supplier_id
    left join users cu on cu.id = e.created_by_user_id
    left join users au on au.id = e.approved_by_user_id
    ${where} order by e.expense_date desc, e.created_at desc limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}`);
  return {
    total: n(res[0]?.total),
    rows: res.map((r) => ({
      id: r.id!, expenseNumber: r.expense_number!, expenseDate: new Date(r.expense_date!), category: r.category!, description: r.description!,
      amountCents: n(r.amount_cents), currency: r.currency!, status: r.status as ExpenseStatus, supplierName: r.supplier_name ?? null, paymentMethod: r.payment_method ?? null,
      createdBy: r.created_by ?? null, approvedBy: r.approved_by ?? null, paidAt: r.paid_at ? new Date(r.paid_at) : null,
    })),
  };
}

export async function getExpense(db: DbOrTx, id: string) {
  const [row] = await db.select({
    e: expenses, category: expenseCategories.name, supplierName: suppliers.name, createdBy: users.name,
  }).from(expenses).innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(suppliers, eq(suppliers.id, expenses.supplierId)).leftJoin(users, eq(users.id, expenses.createdByUserId))
    .where(eq(expenses.id, id));
  return row ?? null;
}

/* -------------------------------------------------------------- summary helpers (used by lib/finance/summary.ts) */
/** Accrual basis (brief §4): APPROVED and PAID both count as "posted," dated by when the cost was incurred. */
export async function getOperatingExpensesCents(db: DbOrTx, r: Range): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(amount_cents), 0) as v from expenses
    where status in ('APPROVED', 'PAID') and expense_date >= ${r.from.toISOString()} and expense_date < ${r.to.toISOString()}`);
  return n(row?.v);
}
/** Cash basis (brief §12): only expenses actually paid, dated by when they were paid. */
export async function getExpensesCashOutCents(db: DbOrTx, r: Range): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(amount_cents), 0) as v from expenses
    where status = 'PAID' and paid_at >= ${r.from.toISOString()} and paid_at < ${r.to.toISOString()}`);
  return n(row?.v);
}
export async function getExpensesByCategory(db: DbOrTx, r: Range) {
  const res = await rows<{ category: string; total: string; count: string }>(db, sql`
    select c.name as category, coalesce(sum(e.amount_cents), 0) as total, count(*) as count
    from expenses e join expense_categories c on c.id = e.category_id
    where e.status in ('APPROVED', 'PAID') and e.expense_date >= ${r.from.toISOString()} and e.expense_date < ${r.to.toISOString()}
    group by c.name order by total desc`);
  return res.map((x) => ({ category: x.category, totalCents: n(x.total), count: n(x.count) }));
}
