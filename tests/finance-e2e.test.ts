/**
 * Phase 9 end-to-end test (brief §33). Aurora Signet Ring: 100 units in stock, cost $50, price $100.
 * A customer buys 3 units, pays, and an operating expense of $50 is recorded and paid.
 *
 * Expected (brief): Sales $300, COGS $150, Gross Profit $150, Gross Margin 50%, remaining stock 97,
 * inventory cost value $4,850, Operating Profit $100.
 *
 * One deliberate, documented difference from the brief's illustrative numbers: this store charges an
 * unconditional 8% sales tax (`STORE.taxRateBp`, `lib/orders/tax.ts`) on every order regardless of channel
 * — real behavior this codebase has had since Phase 1, not something Phase 9 introduces or should hide
 * behind a bypassed insert. The customer therefore actually pays $324 (=$300 × 1.08) in cash, not a bare
 * $300, so this test's cash-flow figures use the real, tax-inclusive amount actually charged rather than
 * forcing the brief's tax-free illustration — everything else (sales, COGS, profit, margin, stock,
 * inventory value, operating profit) matches the brief exactly, since tax never enters those columns
 * (docs/FINANCIAL_CALCULATIONS.md).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeStaff, makeVariant, ALL_TIME } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { getCOGS, getGrossMargin, getGrossProfit, getInventoryValue, getRevenue } from "@/lib/analytics/service";
import { inventory, orders, payments } from "@/lib/db/schema";
import { createExpense, submitExpense, approveExpense, markExpensePaid } from "@/lib/finance/expenses";
import { listExpenseCategories } from "@/lib/finance/expense-categories";
import { getOperatingExpenses, getOperatingProfit, getCashIn, getCashOut, getNetCashFlow } from "@/lib/finance/summary";

describe("Phase 9 end-to-end (brief §33)", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("order, payment, inventory, COGS, revenue, profit, expense and cash flow all stay consistent", async () => {
    const staff = await makeStaff("OWNER");
    const { variant } = await makeVariant({ name: "Aurora Signet Ring", stock: 100, costCents: 5_000, priceCents: 10_000 });

    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], channel: "MANUAL_ORDER", customer: { email: "e2e@example.com", name: "E2E Buyer" }, status: "paid" }, staff);

    // --- Sales / COGS / profit (accrual — unaffected by tax) ---
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(97);
    expect(await getRevenue(db, ALL_TIME)).toBe(30_000);
    expect(await getCOGS(db, ALL_TIME)).toBe(15_000);
    expect(await getGrossProfit(db, ALL_TIME)).toBe(15_000);
    expect(await getGrossMargin(db, ALL_TIME)).toBe(50);
    expect(await getInventoryValue(db)).toBe(485_000);

    // --- The customer's actual payment (real checkout tax included — see file header) ---
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(o!.subtotalCents).toBe(30_000);
    expect(o!.taxTotalCents).toBe(2_400); // 8% of $300
    expect(payment!.amountCents).toBe(o!.totalCents);
    expect(payment!.status).toBe("succeeded");

    // --- Operating expense: $50, approved and paid ---
    const [cat] = await listExpenseCategories(db);
    const expense = await createExpense(db, staff, { categoryId: cat!.id, description: "Packaging", amountCents: 5_000 });
    await submitExpense(db, staff, expense.id);
    await approveExpense(db, staff, expense.id);
    await markExpensePaid(db, staff, expense.id);

    expect(await getOperatingExpenses(db, ALL_TIME)).toBe(5_000);
    expect(await getOperatingProfit(db, ALL_TIME)).toBe(10_000); // $150 gross profit − $50 opex = $100

    // --- Cash flow: real cash in (tax-inclusive) minus the expense actually paid ---
    const cashIn = await getCashIn(db, ALL_TIME), cashOut = await getCashOut(db, ALL_TIME);
    expect(cashIn).toBe(o!.totalCents);
    expect(cashOut).toBe(5_000);
    expect(await getNetCashFlow(db, ALL_TIME)).toBe(cashIn - cashOut);
    expect(cashIn - cashOut).toBe(o!.totalCents - 5_000);
  });
});
