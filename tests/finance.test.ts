/** Phase 9 financial formulas (brief §32), expense workflow (§7-8), reconciliation and tax reporting. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeStaff, makeVariant, ALL_TIME } from "./helpers";
import { customers, orders, payments, refunds, salesChannels } from "@/lib/db/schema";
import { placeOrder } from "@/lib/orders/service";
import { refundOrder } from "@/lib/orders/refunds";
import { createSupplier } from "@/lib/purchasing/suppliers";
import { createPurchaseOrder, recordPurchasePayment } from "@/lib/purchasing/orders";
import { createExpense, submitExpense, approveExpense, rejectExpense, markExpensePaid, cancelExpense, deleteExpense, EXPENSE_TRANSITIONS } from "@/lib/finance/expenses";
import { listExpenseCategories } from "@/lib/finance/expense-categories";
import {
  getGrossSales, getDiscounts, getRefunds, getNetRevenue, getCOGS, getGrossProfit, getGrossMargin,
  getOperatingExpenses, getOperatingProfit, getOperatingMargin, getCashIn, getCashOut, getNetCashFlow,
  getOutstandingSupplierPayments,
} from "@/lib/finance/summary";
import { listCustomerPayments } from "@/lib/finance/customer-payments";
import { classify } from "@/lib/finance/reconciliation";
import { getTaxReport } from "@/lib/finance/tax";

/** Bypasses placeOrder's tax/discount pipeline for a controlled, whole-dollar payment — used only to test
 *  the cash-flow/customer-payment read models in isolation, the same way helpers.ts#makeVariant bypasses
 *  the catalog service to test inventory reads in isolation. */
async function insertPaidOrder(totalCents: number, paidAt: Date) {
  const [channel] = await db.select().from(salesChannels).where(eq(salesChannels.code, "MANUAL_ORDER"));
  const [customer] = await db.insert(customers).values({ email: `cash-${Math.random()}@test.com`, name: "Cash Test" }).returning();
  const [order] = await db.insert(orders).values({
    customerId: customer!.id, channelId: channel!.id, status: "paid", paymentStatus: "paid", fulfillmentStatus: "unfulfilled",
    subtotalCents: totalCents, totalCents, grossProfitCents: totalCents, placedAt: paidAt, paidAt,
  }).returning();
  await db.insert(payments).values({ orderId: order!.id, provider: "manual", status: "succeeded", amountCents: totalCents });
  return order!;
}

describe("brief §32: revenue, COGS, gross profit, margin", () => {
  beforeEach(resetDb);

  it("gross sales $1,000, discount $100, refund $50 => net revenue $850, COGS $400, gross profit $450, margin 52.94%", async () => {
    const staff = await makeStaff("OWNER");
    const { variant } = await makeVariant({ costCents: 4_000, priceCents: 10_000, stock: 100 });
    const order = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 10 }], customer: { email: "formulas@example.com", name: "Formulas" },
      channel: "MANUAL_ORDER", status: "paid",
    }, staff);
    // Apply the $100 discount directly on the order row (isolating the formula from discount-code validation,
    // already covered elsewhere) — tax/total are zeroed out too so `order_total_math`'s CHECK still holds.
    await db.update(orders).set({ discountTotalCents: 10_000, taxTotalCents: 0, totalCents: 90_000, grossProfitCents: 100_000 - 10_000 - 40_000, grossMargin: 55.56 }).where(eq(orders.id, order.id));
    await refundOrder(db, staff, order.id, { amountCents: 5_000 });

    expect(await getGrossSales(db, ALL_TIME)).toBe(100_000);
    expect(await getDiscounts(db, ALL_TIME)).toBe(10_000);
    expect(await getRefunds(db, ALL_TIME)).toBe(5_000);
    expect(await getNetRevenue(db, ALL_TIME)).toBe(85_000);
    expect(await getCOGS(db, ALL_TIME)).toBe(40_000);
    expect(await getGrossProfit(db, ALL_TIME)).toBe(45_000);
    expect(await getGrossMargin(db, ALL_TIME)).toBeCloseTo(52.94, 1);
  });

  it("gross profit $450, operating expenses $150 => operating profit $300", async () => {
    const staff = await makeStaff("OWNER");
    const { variant } = await makeVariant({ costCents: 4_000, priceCents: 10_000, stock: 100 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 10 }], customer: { email: "opex@example.com", name: "Opex" }, channel: "MANUAL_ORDER", status: "paid" }, staff);
    await db.update(orders).set({ discountTotalCents: 10_000, taxTotalCents: 0, totalCents: 90_000, grossProfitCents: 50_000 }).where(eq(orders.id, order.id));
    await refundOrder(db, staff, order.id, { amountCents: 5_000 }); // gross profit now $450 exactly, as above

    const [cat] = await listExpenseCategories(db);
    const expense = await createExpense(db, staff, { categoryId: cat!.id, description: "Rent", amountCents: 15_000 });
    await submitExpense(db, staff, expense.id);
    await approveExpense(db, staff, expense.id);

    expect(await getOperatingExpenses(db, ALL_TIME)).toBe(15_000);
    expect(await getOperatingProfit(db, ALL_TIME)).toBe(30_000);
    expect(await getOperatingMargin(db, ALL_TIME)).toBeCloseTo(35.29, 1);
  });

  it("zero revenue => gross margin and operating margin are N/A (null), never a division-by-zero", async () => {
    expect(await getGrossMargin(db, ALL_TIME)).toBeNull();
    expect(await getOperatingMargin(db, ALL_TIME)).toBeNull();
    expect(await getNetRevenue(db, ALL_TIME)).toBe(0);
  });
});

describe("brief §32: cash flow", () => {
  beforeEach(resetDb);

  it("customer payments $1,000, supplier payments $400, expenses paid $100 => net cash flow $500", async () => {
    const staff = await makeStaff("OWNER");
    const now = new Date();
    await insertPaidOrder(100_000, now);

    const supplier = await createSupplier(db, staff, { name: "Cash Flow Supplier" });
    const { variant } = await makeVariant({ code: "CFS" });
    const po = await createPurchaseOrder(db, staff, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 10, unitCostCents: 10_000 }] });
    await recordPurchasePayment(db, staff, po.id, { amountCents: 40_000, paidAt: now });

    const [cat] = await listExpenseCategories(db);
    const expense = await createExpense(db, staff, { categoryId: cat!.id, description: "Bank fee", amountCents: 10_000, expenseDate: now });
    await submitExpense(db, staff, expense.id);
    await approveExpense(db, staff, expense.id);
    await markExpensePaid(db, staff, expense.id, now);

    expect(await getCashIn(db, ALL_TIME)).toBe(100_000);
    expect(await getCashOut(db, ALL_TIME)).toBe(50_000);
    expect(await getNetCashFlow(db, ALL_TIME)).toBe(50_000);
  });

  it("PO $5,000, paid $2,000 => outstanding $3,000", async () => {
    const staff = await makeStaff("OWNER");
    const supplier = await createSupplier(db, staff, { name: "Outstanding Co" });
    const { variant } = await makeVariant({ code: "OUT" });
    const po = await createPurchaseOrder(db, staff, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 5, unitCostCents: 100_000 }] });
    await recordPurchasePayment(db, staff, po.id, { amountCents: 200_000 });
    expect(await getOutstandingSupplierPayments(db)).toBe(300_000);
  });

  it("original payment $500, refund $100 => net customer payment $400", async () => {
    const order = await insertPaidOrder(50_000, new Date());
    await db.insert(refunds).values({ orderId: order.id, amountCents: 10_000, restocked: false });
    const { rows } = await listCustomerPayments(db, { range: ALL_TIME, page: 1, pageSize: 10 });
    const row = rows.find((r) => r.orderId === order.id)!;
    expect(row.amountCents).toBe(50_000);
    expect(row.refundedCents).toBe(10_000);
    expect(row.amountCents - row.refundedCents).toBe(40_000);
  });
});

describe("brief §7-8: expense workflow", () => {
  beforeEach(resetDb);

  it("DRAFT -> PENDING_APPROVAL -> APPROVED -> PAID", async () => {
    const staff = await makeStaff("OWNER");
    const [cat] = await listExpenseCategories(db);
    const e = await createExpense(db, staff, { categoryId: cat!.id, description: "Software", amountCents: 5_000 });
    expect(e.status).toBe("DRAFT");
    await submitExpense(db, staff, e.id);
    await approveExpense(db, staff, e.id);
    const paid = await markExpensePaid(db, staff, e.id);
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).toBeTruthy();
  });

  it("PENDING_APPROVAL -> REJECTED, and a rejected expense may still be deleted", async () => {
    const staff = await makeStaff("OWNER");
    const [cat] = await listExpenseCategories(db);
    const e = await createExpense(db, staff, { categoryId: cat!.id, description: "Rejected one", amountCents: 5_000 });
    await submitExpense(db, staff, e.id);
    const rejected = await rejectExpense(db, staff, e.id, "Not needed");
    expect(rejected.status).toBe("REJECTED");
    await expect(deleteExpense(db, staff, e.id)).resolves.toBeUndefined();
  });

  it("a PAID expense can never be deleted, only cancelled/voided", async () => {
    const staff = await makeStaff("OWNER");
    const [cat] = await listExpenseCategories(db);
    const e = await createExpense(db, staff, { categoryId: cat!.id, description: "Paid one", amountCents: 5_000 });
    await submitExpense(db, staff, e.id);
    await approveExpense(db, staff, e.id);
    await markExpensePaid(db, staff, e.id);
    await expect(deleteExpense(db, staff, e.id)).rejects.toThrow();
    expect(EXPENSE_TRANSITIONS.PAID).toEqual([]);
    // A cancelled expense stops counting toward operating expenses even though it was once APPROVED.
    const [cat2] = await listExpenseCategories(db);
    const e2 = await createExpense(db, staff, { categoryId: cat2!.id, description: "To cancel", amountCents: 9_999 });
    await submitExpense(db, staff, e2.id);
    await approveExpense(db, staff, e2.id);
    const before = await getOperatingExpenses(db, ALL_TIME);
    await cancelExpense(db, staff, e2.id);
    const after = await getOperatingExpenses(db, ALL_TIME);
    expect(after).toBe(before - 9_999);
  });

  it("a non-OWNER/ADMIN role cannot write finance records", async () => {
    const sales = await makeStaff("SALES");
    const [cat] = await listExpenseCategories(db);
    await expect(createExpense(db, sales, { categoryId: cat!.id, description: "Nope", amountCents: 1_000 })).rejects.toThrow();
  });
});

describe("brief §15: reconciliation classification (pure)", () => {
  it("matched, partial, discrepancy and unmatched", () => {
    expect(classify(10_000, 10_000)).toBe("MATCHED");
    expect(classify(10_000, 5_000)).toBe("PARTIAL");
    expect(classify(10_000, 12_000)).toBe("DISCREPANCY");
    expect(classify(10_000, null)).toBe("UNMATCHED");
  });
});

describe("brief §17: tax reporting foundation", () => {
  beforeEach(resetDb);

  it("reports real collected tax from orders, at the configured rate, without inventing a number", async () => {
    const staff = await makeStaff("OWNER");
    const { variant } = await makeVariant({ priceCents: 10_000, stock: 10 });
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "tax@example.com", name: "Tax" }, channel: "WEBSITE", status: "paid" }, staff);
    const report = await getTaxReport(db, ALL_TIME);
    expect(report.configured).toBe(true);
    expect(report.ratePercent).toBe(8);
    expect(report.taxAmountCents).toBeGreaterThan(0);
    expect(report.taxExemptSalesCents).toBe(0);
  });
});

afterAll(() => pool.end());
