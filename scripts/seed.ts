/**
 * npm run db:seed        reference data, staff, suppliers, collections, the 16-piece catalog (142 variants),
 *                        opening stock, discounts, published reviews. Safe for a fresh production database.
 * npm run db:seed:demo   all of the above, plus ~120 days of DEVELOPMENT-ONLY customers, orders, refunds,
 *                        addresses and reviews, placed through the real order service so every total,
 *                        profit figure and stock movement obeys the same rules as live orders.
 *                        Refuses to run if the database already has orders.
 */
import { existsSync, readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import {
  categories, collections, customerAddresses, customers, discounts, inventory, inventoryMovements, orders, productImages, productVariants, products, reviews, suppliers, users,
} from "../src/lib/db/schema";
import { upsertReferenceData } from "../src/lib/db/reference-data";
import { placeOrder, updateOrderStatus, statusFields } from "../src/lib/orders/service";
import type { Actor } from "../src/lib/auth/permissions";

type CatalogProduct = { id: string; slug: string; name: string; cat: string; price: number; cmp?: number; mats: string[]; size: { type: string; opts: string[] } | null; gems: string[]; badge?: string; isBest?: boolean; isNew?: boolean; short: string; desc: string; details: string[]; occ: string[] };
type Catalog = { materials: Record<string, { name: string; f: number }>; products: CatalogProduct[] };
const catalog: Catalog = JSON.parse(readFileSync(new URL("./data/catalog.json", import.meta.url), "utf8"));
/** Product renderings generated from the prototype (public/products/*.svg). Replace with Supabase Storage photos. */
const IMAGES_URL = new URL("./data/images.json", import.meta.url);
const images: Record<string, { file: string; material: string; view: string; alt: string }[]> = existsSync(IMAGES_URL) ? JSON.parse(readFileSync(IMAGES_URL, "utf8")) : {};
const COST_RATIO: Record<string, number> = { yg: 0.44, wg: 0.45, vm: 0.33, ss: 0.29 };
const COLOR: Record<string, string> = { yg: "Yellow Gold", wg: "White Gold", vm: "Yellow Gold", ss: "Silver" };
const COLLECTION_OF: Record<string, string> = {
  aurora: "everyday-edit", elan: "everyday-edit", seren: "everyday-edit", linea: "everyday-edit", soleil: "everyday-edit", cleo: "everyday-edit", luna: "everyday-edit", halo: "everyday-edit", rive: "everyday-edit",
  nova: "celestial", astra: "celestial", celeste: "celestial", mira: "pearl-studio", perle: "pearl-studio", vesper: "bridal", isla: "bridal",
};
const demo = process.argv.includes("--demo");

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = mulberry(20260927);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)]!;
function wpick<T>(e: [T, number][]): T { const tot = e.reduce((a, x) => a + x[1], 0); let r = R() * tot; for (const x of e) { r -= x[1]; if (r <= 0) return x[0]; } return e[0]![0]; }
function basePriceCents(p: CatalogProduct, m: string) {
  const f0 = catalog.materials[p.mats[0]!]!.f, f = catalog.materials[m]!.f;
  return f === f0 ? p.price * 100 : (Math.floor((p.price * f) / f0 / 10) * 10 + 8) * 100;
}
const barcodeFor = (sku: string) => "8" + String(Math.abs([...sku].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))).padStart(12, "0").slice(0, 12);

const REVIEW_POOL: [number, string, string][] = [
  [5, "Have not taken it off", "I wear it every day, in the shower and at the gym, and it still looks new."],
  [5, "Better than the photos", "The finish is beautiful in person. Arrived in a lovely box with a handwritten note."],
  [5, "Perfect gift", "Bought this for my sister's birthday. She cried a little. Worth it."],
  [4, "Beautiful, runs slightly small", "Lovely piece. I would size up if you are between sizes."],
  [5, "Stacks perfectly", "Looks great with my other rings. Comfortable enough to sleep in."],
  [4, "Delicate but sturdy", "Thinner than I expected, but it has held up well for three months."],
  [5, "My new everyday piece", "Simple, well made and goes with everything."],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(url);
  await upsertReferenceData(db);

  if (demo) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(orders);
    if (c!.n > 0) throw new Error("Refusing to add demo orders: this database already has orders.");
  }

  await db.insert(users).values([
    { email: "owner@sauri.example", name: "Owner", role: "OWNER" as const },
    { email: "dara@sauri.example", name: "Dara", role: "ADMIN" as const },
    { email: "sokha@sauri.example", name: "Sokha", role: "SALES" as const },
    { email: "vanna@sauri.example", name: "Vanna", role: "INVENTORY" as const },
    { email: "accounts@sauri.example", name: "Accountant", role: "VIEWER" as const },
  ]).onConflictDoNothing();
  const [owner] = await db.select().from(users).where(eq(users.email, "owner@sauri.example"));
  const ownerActor: Actor = { userId: owner!.id, name: owner!.name, role: "OWNER" };

  await db.insert(suppliers).values(["Aurum Atelier, Bangkok", "Linden Castings", "Perla Freshwater Co.", "Northgate Findings"].map((name) => ({ name }))).onConflictDoNothing();
  await db.insert(collections).values([
    { slug: "everyday-edit", name: "The Everyday Edit", description: "Pieces made to be worn every day." },
    { slug: "celestial", name: "Celestial", description: "Stars, light and lab-grown diamonds." },
    { slug: "pearl-studio", name: "Pearl Studio", description: "Freshwater pearls, hand-selected." },
    { slug: "bridal", name: "Bridal", description: "Solitaires and eternity bands." },
  ]).onConflictDoNothing();
  const cols = Object.fromEntries((await db.select().from(collections)).map((c) => [c.slug, c.id]));
  const cats = Object.fromEntries((await db.select().from(categories)).map((c) => [c.slug, c]));

  let newVariants = 0;
  for (const p of catalog.products) {
    const code = p.id.slice(0, 3).toUpperCase();
    const [row] = await db.insert(products).values({
      slug: p.slug, code, name: p.name, shortDescription: p.short, description: p.desc, categoryId: cats[p.cat]!.id, collectionId: cols[COLLECTION_OF[p.id] ?? "everyday-edit"] ?? null,
      status: "active", featured: !!p.isBest && ["aurora", "luna", "soleil", "celeste"].includes(p.id), bestSeller: !!p.isBest, newArrival: !!p.isNew,
      badge: p.badge ?? null, seoTitle: `${p.name} | SAURI`, seoDescription: p.short, tags: p.occ, details: p.details,
    }).onConflictDoNothing().returning();
    if (!row) continue;
    for (const m of p.mats) for (const s of p.size ? p.size.opts : [null]) for (const g of p.gems.length ? p.gems : [null]) {
      const price = basePriceCents(p, m);
      const sku = [cats[p.cat]!.skuPrefix, code, m.toUpperCase(), s ? s.replace('"', "IN") : null, g ? g.slice(0, 2).toUpperCase() : null].filter(Boolean).join("-");
      const compareAt = p.cmp && m === p.mats[0] && p.cmp * 100 > price ? p.cmp * 100 : null;
      const [v] = await db.insert(productVariants).values({
        productId: row.id, sku, barcode: barcodeFor(sku), material: m, color: COLOR[m] ?? null, size: s, gemstone: g,
        sellingPriceCents: price, costPriceCents: Math.round(price * COST_RATIO[m]!), compareAtPriceCents: compareAt,
        weightMg: p.cat === "bracelets" ? 6_500 : p.cat === "necklaces" ? 4_200 : p.cat === "rings" ? 2_800 : 1_900,
      }).returning();
      await db.insert(inventory).values({ variantId: v!.id, stockQuantity: 0, reorderLevel: p.cat === "rings" ? 3 : 5 });
      newVariants++;
    }
    const imgs = images[p.slug] ?? [];
    if (imgs.length) {
      const firstVariantOf = new Map<string, string>();
      for (const v of await db.select().from(productVariants).where(eq(productVariants.productId, row.id))) if (!firstVariantOf.has(v.material)) firstVariantOf.set(v.material, v.id);
      const ordered = [...imgs].sort((a, b) => (a.material === p.mats[0] ? 0 : 1) - (b.material === p.mats[0] ? 0 : 1) || (a.view === "front" ? 0 : 1) - (b.view === "front" ? 0 : 1));
      await db.insert(productImages).values(ordered.map((im, i) => ({ productId: row.id, variantId: im.view === "front" ? firstVariantOf.get(im.material) ?? null : null, url: `/products/${im.file}`, alt: im.alt, position: i })));
    }
    const n = 3 + Math.floor(R() * 4);
    await db.insert(reviews).values(Array.from({ length: n }, (_, i) => {
      const [rating, title, body] = REVIEW_POOL[(i + p.name.length) % REVIEW_POOL.length]!;
      return { productId: row.id, rating, title, body, authorName: pick(["Hana K.", "Claire D.", "Sophea L.", "Maya R.", "Jules P.", "Nita S."]), status: (i === n - 1 && R() < 0.5 ? "pending" : "published") as "pending" | "published" };
    }));
  }

  const now = Date.now(), day = 86_400_000;
  await db.insert(discounts).values([
    { code: "SAURI10", type: "percent", value: 10, startsAt: new Date(now - 400 * day) },
    { code: "WELCOME15", type: "percent", value: 15, minSubtotalCents: 10_000, maxDiscountCents: 6_000, perCustomerLimit: 1, startsAt: new Date(now - 400 * day) },
    { code: "FREESHIP", type: "free_shipping", value: 0, minSubtotalCents: 6_000, usageLimit: 500 },
    { code: "RINGS20", type: "percent", value: 20, categoryId: cats.rings!.id, maxDiscountCents: 10_000, endsAt: new Date(now + 14 * day), usageLimit: 200, perCustomerLimit: 1 },
  ]).onConflictDoNothing();

  // Opening stock: one PURCHASE movement per variant, so the ledger starts at zero and always reconciles.
  const variants = await db.select().from(productVariants);
  const openingAt = demo ? new Date(now - 125 * day) : new Date();
  for (const v of variants) {
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, v.id));
    if (!inv || inv.stockQuantity > 0) continue;
    const qty = demo ? 20 + Math.floor(R() * 40) : 10 + Math.floor(R() * 30);
    await db.transaction(async (tx) => {
      await tx.update(inventory).set({ stockQuantity: qty }).where(eq(inventory.variantId, v.id));
      await tx.insert(inventoryMovements).values({ variantId: v.id, movementType: "PURCHASE", quantity: qty, stockBefore: 0, stockAfter: qty, referenceType: "opening_balance", referenceId: "OPENING", unitCostCents: v.costPriceCents, notes: "Opening stock", userId: owner!.id, createdAt: openingAt });
    });
  }
  console.log(`Catalog: ${catalog.products.length} products, ${newVariants} new variants.`);

  if (demo) {
    const FN = ["Sophea", "Dara", "Maya", "Claire", "Nita", "Jules", "Amara", "Lin", "Priya", "Elise", "Rosa", "Mei", "Hana", "Chloe", "Ava", "Leah", "Nora", "Iris", "Kanha", "Bopha", "Lucy", "Zoe", "Emma", "Grace", "Anh", "Yuki", "Nadia", "Ines", "Tara", "Ella"];
    const LN = ["Kim", "Lim", "Chan", "Sok", "Nguyen", "Tan", "Martin", "Dubois", "Rossi", "Park", "Lee", "Wong", "Heng", "Patel", "Garcia", "Silva", "Keo", "Meas", "Costa", "Ito"];
    const CITIES: [string, string, string][] = [["Phnom Penh", "12000", "Cambodia"], ["Singapore", "018956", "Singapore"], ["New York", "10001", "United States"], ["London", "EC1A 1BB", "United Kingdom"], ["Sydney", "2000", "Australia"], ["Toronto", "M5H 2N2", "Canada"]];
    const people: { email: string; name: string; addr: Record<string, string> }[] = [];
    const bySlug = new Map((await db.select().from(products)).map((p) => [p.slug, p.id]));
    const variantsByProduct = new Map<string, string[]>();
    for (const v of variants) variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), v.id]);
    const weights: [CatalogProduct, number][] = catalog.products.map((p) => [p, p.isBest ? 3 : 1]);
    const channels: [string, number][] = [["WEBSITE", 55], ["INSTAGRAM", 12], ["FACEBOOK", 6], ["TIKTOK", 9], ["PHYSICAL_STORE", 10], ["WHOLESALE", 2], ["MANUAL_ORDER", 4], ["OTHER", 2]];
    let placed = 0, skipped = 0, refunded = 0;
    for (let d = 120; d >= 0; d--) {
      const dayStart = new Date(now - d * day); dayStart.setHours(0, 0, 0, 0);
      const count = Math.max(0, Math.round(3 + 4 * (1 - d / 120) + (R() - 0.5) * 4));
      for (let k = 0; k < count; k++) {
        const t = d === 0 ? new Date(dayStart.getTime() + R() * (now - dayStart.getTime())) : new Date(dayStart.getTime() + (8 + R() * 14) * 3_600_000);
        let person: (typeof people)[number];
        if (people.length > 15 && R() < 0.35) person = pick(people);
        else {
          const f = pick(FN), l = pick(LN), [city, zip, country] = pick(CITIES);
          person = { name: `${f} ${l}`, email: `${f}.${l}${people.length}@example.com`.toLowerCase(), addr: { firstName: f, lastName: l, line1: `${10 + Math.floor(R() * 200)} Riverside Street`, city, postalCode: zip, country } };
          people.push(person);
        }
        const p = wpick(weights);
        const lines = [{ variantId: pick(variantsByProduct.get(bySlug.get(p.slug)!)!), quantity: 1 }];
        const channel = wpick(channels);
        if (channel === "WHOLESALE") lines[0]!.quantity = 3;
        else if (R() < 0.18) { const p2 = wpick(weights); lines.push({ variantId: pick(variantsByProduct.get(bySlug.get(p2.slug)!)!), quantity: 1 }); }
        try {
          const o = await placeOrder(db, {
            lines, channel, customer: person, status: "paid", placedAt: t, shippingAddress: person.addr,
            discountCode: R() < 0.1 ? "SAURI10" : null, paymentProvider: channel === "WEBSITE" ? "stripe" : "manual",
          }, ownerActor);
          placed++;
          const age = (now - t.getTime()) / day;
          if (age > 3 && R() < 0.025) { await updateOrderStatus(db, ownerActor, o.id, "refunded", { reason: "Demo refund" }); refunded++; }
          else if (age > 1) await db.update(orders).set(statusFields(age > 7 ? "delivered" : age > 3 ? "shipped" : "processing")).where(eq(orders.id, o.id));
        } catch { skipped++; } // sold out: a real shopper would have seen "sold out" too
      }
    }
    for (const person of people) {
      const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, person.email));
      if (c) await db.insert(customerAddresses).values({ customerId: c.id, type: "shipping", isDefault: true, firstName: person.addr.firstName!, lastName: person.addr.lastName!, line1: person.addr.line1!, city: person.addr.city!, postalCode: person.addr.postalCode!, country: person.addr.country! });
    }
    // Notifications were written "now" while replaying history: date them to their orders and mark old ones read.
    await db.execute(sql`update notifications n set created_at = o.placed_at from orders o where n.reference = o.order_number`);
    await db.execute(sql`update notifications set read_at = now() where created_at < now() - interval '1 day'`);
    console.log(`Demo history: ${placed} orders (${refunded} refunded, ${skipped} skipped as sold out), ${people.length} customers.`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
