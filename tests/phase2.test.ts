/** Phase 2: dashboard figures, admin queries, reports/exports, catalog actions and server-side permissions. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer, ALL_TIME } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { placeOrder } from "@/lib/orders/service";
import { getInventoryValue, getMetrics, resolveRange } from "@/lib/analytics/service";
import { parseRange, pctChange } from "@/lib/admin/range";
import { listOrders } from "@/lib/admin/orders";
import { listProducts } from "@/lib/admin/products";
import { inventorySummary, listStock, lowStock, outOfStock } from "@/lib/admin/inventory";
import { globalSearch, listNotifications } from "@/lib/admin/misc";
import { REPORT_KEYS, buildReport, toCsv, toPdf, toXlsx } from "@/lib/admin/reports";
import { createProduct, deleteProduct, duplicateProduct, setProductArchived, updateStaff, updateVariant } from "@/lib/catalog/service";
import { can } from "@/lib/auth/permissions";
import { setIdentityResolver } from "@/lib/auth/session";
import { auditLogs, categories, inventory, productVariants, products, users } from "@/lib/db/schema";
import { createProductAction, restockAction } from "@/app/admin/actions";
import { GET as reportRoute } from "@/app/api/admin/reports/[key]/route";
import { GET as searchRoute } from "@/app/api/admin/search/route";

const as = (authUserId: string) => setIdentityResolver(async () => ({ authUserId, email: "x@sauri.test", emailVerified: true }));
const IDS = { OWNER: "00000000-0000-4000-8000-0000000000a1", SALES: "00000000-0000-4000-8000-0000000000a2", INVENTORY: "00000000-0000-4000-8000-0000000000a3", VIEWER: "00000000-0000-4000-8000-0000000000a4" };
const staffFor = async () => { for (const [r, id] of Object.entries(IDS)) await makeStaff(r as keyof typeof IDS, { authUserId: id }); };
const owner = { userId: null, name: "Owner", role: "OWNER" as const };

describe("Phase 2", () => {
  beforeEach(resetDb);
  afterAll(async () => { await pool.end(); await (globalThis as { sauriPool?: { end(): Promise<void> } }).sauriPool?.end(); });

  it("§51: one order of 3 moves the dashboard by exactly +1 order, +3 units, +$300 revenue, +$150 profit; stock 97", async () => {
    const { variant } = await makeVariant({ stock: 100, costCents: 5_000, priceCents: 10_000 });
    // "Today" is resolved on every render/refresh, exactly as the dashboard does.
    const before = await getMetrics(db, await resolveRange(db, "today")), valueBefore = await getInventoryValue(db);
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    const after = await getMetrics(db, await resolveRange(db, "today"));
    expect(after.orders - before.orders).toBe(1);
    expect(after.units - before.units).toBe(3);
    expect(after.netRevenueCents - before.netRevenueCents).toBe(30_000);
    expect(after.cogsCents - before.cogsCents).toBe(15_000);
    expect(after.grossProfitCents - before.grossProfitCents).toBe(15_000);
    expect(after.grossMarginPct).toBe(50);
    expect(valueBefore - (await getInventoryValue(db))).toBe(15_000);
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(97);
  });

  it("percentage change is never computed against zero", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });

  it("the date range lives in the URL; invalid input falls back safely", () => {
    expect(parseRange({ from: "2026-09-01", to: "2026-09-28" })).toEqual({ key: "custom", custom: { from: "2026-09-01", to: "2026-09-28" } });
    expect(parseRange({ range: "90d" })).toEqual({ key: "90d" });
    expect(parseRange({ from: "2026-09-28", to: "2026-09-01" })).toEqual({ key: "30d" }); // reversed
    expect(parseRange({ range: "'; drop table orders" })).toEqual({ key: "30d" });
  });

  it("previous period = the same number of days immediately before (brief §37 shape)", async () => {
    const r = await resolveRange(db, "custom", { from: "2026-08-01", to: "2026-08-28" });
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(d);
    expect(day(r.from)).toBe("2026-08-01");
    expect(day(r.previous.from)).toBe("2026-07-04");
    expect(day(new Date(r.previous.to.getTime() - 1))).toBe("2026-07-31");
  });

  it("inventory value = AVAILABLE stock × cost (units reserved by an unpaid checkout are excluded)", async () => {
    const { variant } = await makeVariant({ stock: 100, costCents: 5_000 });
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer }); // pending: reserves 2
    expect(await getInventoryValue(db)).toBe(98 * 5_000);
    expect((await inventorySummary(db)).reservedUnits).toBe(2);
  });

  it("low stock is sorted most urgent first; out of stock lists last-sold", async () => {
    const a = await makeVariant({ code: "AAA", stock: 12, reorder: 5 });
    const b = await makeVariant({ code: "BBB", stock: 6, reorder: 5 });
    const c = await makeVariant({ code: "CCC", stock: 1, reorder: 5 });
    const sell = (v: string, q: number, e: string) => placeOrder(db, { lines: [{ variantId: v, quantity: q }], customer: { email: e, name: e }, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await sell(a.variant.id, 8, "a@x.com"); // 4 left, sells fast
    await sell(b.variant.id, 1, "b@x.com"); // 5 left, sells slowly
    await sell(c.variant.id, 1, "c@x.com"); // 0 left
    expect((await lowStock(db)).map((x) => x.sku)).toEqual(["RNG-AAA-YG-6", "RNG-BBB-YG-6"]);
    const out = await outOfStock(db);
    expect(out.map((x) => x.sku)).toEqual(["RNG-CCC-YG-6"]);
    expect(out[0]!.lastSoldAt).toBeInstanceOf(Date);
    expect((await listStock(db, { status: "LOW_STOCK", page: 1, pageSize: 10 })).total).toBe(2);
  });

  it("orders list: server-side filter, search and pagination", async () => {
    const { variant } = await makeVariant({ stock: 100 });
    for (let i = 0; i < 7; i++) await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: `c${i}@x.com`, name: `Customer ${i}` }, status: "paid", channel: i % 2 ? "INSTAGRAM" : "PHYSICAL_STORE" }, owner);
    const page1 = await listOrders(db, { page: 1, pageSize: 5 });
    expect(page1.rows).toHaveLength(5);
    expect(page1.total).toBe(7);
    expect((await listOrders(db, { page: 2, pageSize: 5 })).rows).toHaveLength(2);
    expect((await listOrders(db, { channel: "INSTAGRAM", page: 1, pageSize: 50 })).total).toBe(3);
    expect((await listOrders(db, { q: "Customer 3", page: 1, pageSize: 50 })).rows.map((o) => o.customer)).toEqual(["Customer 3"]);
    expect((await listOrders(db, { q: "ORD-10002", page: 1, pageSize: 50 })).total).toBe(1);
  });

  it("product search matches name, SKU, barcode, category and variant", async () => {
    const { variant } = await makeVariant({ name: "Aurora Ring" });
    await db.update(productVariants).set({ barcode: "8123456789012", gemstone: "Sapphire" }).where(eq(productVariants.id, variant.id));
    await makeVariant({ code: "LUN", name: "Luna Hoops", category: "earrings" });
    const r = await resolveRange(db, "30d");
    const q = async (q: string) => (await listProducts(db, { q, page: 1, pageSize: 10, range: r })).rows.map((p) => p.name);
    expect(await q("aurora")).toEqual(["Aurora Ring"]);
    expect(await q("RNG-AUR")).toEqual(["Aurora Ring"]);
    expect(await q("81234567")).toEqual(["Aurora Ring"]);
    expect(await q("earrings")).toEqual(["Luna Hoops"]);
    expect(await q("sapphire")).toEqual(["Aurora Ring"]);
    expect(await q("100%_")).toEqual([]); // wildcards are escaped
  });

  it("all nine reports build; exports are real CSV / XLSX / PDF files that respect the range", async () => {
    const { variant } = await makeVariant({ stock: 50 });
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: { email: "eve@x.com", name: "=HYPERLINK(\"x\")" }, status: "paid", channel: "MANUAL_ORDER" }, owner);
    const r = await resolveRange(db, "7d");
    for (const k of REPORT_KEYS) { const rep = await buildReport(db, k, r); expect(rep.columns.length).toBeGreaterThan(1); }
    const profit = await buildReport(db, "profit", r);
    expect(profit.rows.find((x) => x.line === "Gross margin")).toMatchObject({ percent: 50, amount: null });
    expect(profit.rows.find((x) => x.line === "Orders")).toMatchObject({ count: 1, amount: null });
    const orders = await buildReport(db, "orders", r);
    const csv = toCsv(orders);
    expect(csv.startsWith("\uFEFFOrder,Date,Customer")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\""); // spreadsheet formula injection defused
    const xlsx = await toXlsx(orders, "Last 7 days");
    expect(String.fromCharCode(xlsx[0]!, xlsx[1]!)).toBe("PK");
    const pdf = await toPdf(orders, "Last 7 days");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const empty = await buildReport(db, "orders", await resolveRange(db, "custom", { from: "2020-01-01", to: "2020-01-02" }));
    expect(empty.rows).toHaveLength(0);
  });

  it("catalog actions are audited; delete is refused once a product has history", async () => {
    const [cat] = await db.select().from(categories).limit(1);
    const p = await createProduct(db, owner, { name: "Maren Link Bracelet", categoryId: cat!.id, status: "active", material: "yg", sku: "brc-mar-yg", costPriceCents: 9_000, sellingPriceCents: 21_000 });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.productId, p.id));
    expect(v!.sku).toBe("BRC-MAR-YG");
    await updateVariant(db, owner, v!.id, { sellingPriceCents: 22_000 });
    await expect(updateVariant(db, owner, v!.id, { compareAtPriceCents: 1_000 })).rejects.toThrow(/Compare-at/);
    const copy = await duplicateProduct(db, owner, p.id);
    expect(copy).toMatchObject({ status: "draft", name: "Maren Link Bracelet (copy)" });
    const [cv] = await db.select().from(productVariants).where(eq(productVariants.productId, copy.id));
    const [cinv] = await db.select().from(inventory).where(eq(inventory.variantId, cv!.id));
    expect(cv!.sku).toBe("BRC-MAR-YG-C");
    expect(cinv!.stockQuantity).toBe(0);
    await deleteProduct(db, owner, copy.id); // never stocked or sold: allowed
    const { product: sold, variant: sv } = await makeVariant({ code: "OLD" });
    await placeOrder(db, { lines: [{ variantId: sv.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await expect(deleteProduct(db, owner, sold.id)).rejects.toThrow(/Archive it instead/);
    await setProductArchived(db, owner, sold.id, true);
    expect((await db.select().from(products).where(eq(products.id, sold.id)))[0]!.status).toBe("archived");
    const actions = (await db.select().from(auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["Created product", "Changed product price", "Duplicated product", "Deleted product", "Archived product"]));
  });

  it("role permissions follow brief §46 and the last owner can't be demoted", async () => {
    expect(can("ADMIN", "reports:read") && can("ADMIN", "inventory:write") && can("ADMIN", "customers:write")).toBe(true);
    expect(can("ADMIN", "discounts:write") || can("ADMIN", "audit:read") || can("ADMIN", "staff:write")).toBe(false);
    expect(can("SALES", "sales:read") && can("SALES", "orders:write") && !can("SALES", "products:read")).toBe(true);
    expect(can("INVENTORY", "products:write") && !can("INVENTORY", "orders:read") && !can("INVENTORY", "reports:read")).toBe(true);
    expect(can("VIEWER", "dashboard:read") && !can("VIEWER", "dashboard:write")).toBe(true);
    const o = await makeStaff("OWNER");
    await expect(updateStaff(db, o, o.userId!, { role: "ADMIN" })).rejects.toThrow(/at least one active owner/);
    const [u] = await db.select().from(users).where(eq(users.id, o.userId!));
    expect(u!.role).toBe("OWNER");
  });

  it("server actions enforce roles even when called directly", async () => {
    await staffFor();
    const { variant } = await makeVariant({ stock: 3 });
    as(IDS.SALES);
    const denied = await restockAction({ variantId: variant.id, quantity: 5 } as never);
    expect(denied).toMatchObject({ ok: false });
    as(IDS.INVENTORY);
    expect(await restockAction({ variantId: variant.id, quantity: 5, unitCost: "" } as never)).toMatchObject({ ok: true });
    expect((await db.select().from(inventory).where(eq(inventory.variantId, variant.id)))[0]!.stockQuantity).toBe(8);
    const bad = await createProductAction({ name: "", status: "active" } as never);
    expect(bad).toMatchObject({ ok: false });
    setIdentityResolver(async () => null);
    expect(await restockAction({ variantId: variant.id, quantity: 5 } as never)).toMatchObject({ ok: false, error: "Please sign in." });
  });

  it("export route: VIEWER gets 403; OWNER downloads a CSV with the range in the filename", async () => {
    await staffFor();
    const call = () => reportRoute(new Request("http://t/api/admin/reports/daily-sales?format=csv&from=2026-08-01&to=2026-08-28"), { params: Promise.resolve({ key: "daily-sales" }) });
    as(IDS.VIEWER);
    expect((await call()).status).toBe(403);
    as(IDS.OWNER);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("sauri-daily-sales-2026-08-01_2026-08-28.csv");
    expect((await res.text()).split("\r\n").filter(Boolean)).toHaveLength(29); // header + 28 days, zero-filled
  });

  it("search only returns what the caller's role may open; notifications link to the order", async () => {
    await staffFor();
    const { variant } = await makeVariant({ name: "Aurora Ring" });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "aurora.fan@x.com", name: "Aurora Fan" }, status: "paid", channel: "MANUAL_ORDER" }, owner);
    as(IDS.INVENTORY);
    const kinds = (await (await searchRoute(new Request("http://t/api/admin/search?q=aurora"))).json()).hits.map((h: { kind: string }) => h.kind);
    expect(kinds).toContain("product");
    expect(kinds).not.toContain("order");
    expect(kinds).not.toContain("customer");
    expect((await globalSearch(db, "aurora", { orders: true, products: true, customers: true })).map((h) => h.kind)).toEqual(expect.arrayContaining(["order", "customer"]));
    const n = await listNotifications(db);
    expect(n.items.find((x) => x.type === "new_order")!.href).toBe(`/admin/orders/${o.id}`);
    expect(n.unread).toBeGreaterThan(0);
  });

  void ALL_TIME;
});
