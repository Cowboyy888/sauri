import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { categories, inventory, productVariants, products, users } from "@/lib/db/schema";
import { upsertReferenceData } from "@/lib/db/reference-data";
import type { Actor } from "@/lib/auth/permissions";

const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/sauri_test";
export const { db, pool } = createDb(url);

export async function resetDb() {
  const r = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = (r.rows as { tablename: string }[]).map((x) => `"${x.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  await upsertReferenceData(db);
  await db.execute(sql`alter sequence orders_number_seq restart with 10001`);
}

export async function makeStaff(role: Actor["role"], name = role.toLowerCase()): Promise<Actor> {
  const [u] = await db.insert(users).values({ email: `${name}@sauri.test`, name, role }).returning();
  return { userId: u!.id, name: u!.name, role };
}

/** One product, one variant, with the numbers from the brief's business test. */
export async function makeVariant(db_: Db = db, o: { stock?: number; costCents?: number; priceCents?: number; reorder?: number; code?: string; category?: string } = {}) {
  const [cat] = await db_.select().from(categories).where(sql`${categories.slug} = ${o.category ?? "rings"}`);
  const code = o.code ?? "TST";
  const [p] = await db_.insert(products).values({ slug: `test-${code.toLowerCase()}`, code, name: `Test ${code}`, categoryId: cat!.id, status: "active" }).returning();
  const [v] = await db_.insert(productVariants).values({ productId: p!.id, sku: `RNG-${code}-YG`, material: "yg", priceCents: o.priceCents ?? 10_000, costCents: o.costCents ?? 5_000 }).returning();
  await db_.insert(inventory).values({ variantId: v!.id, onHand: o.stock ?? 100, reorderLevel: o.reorder ?? 5 });
  return { product: p!, variant: v!, categoryId: cat!.id };
}

export const buyer = { email: "ana@example.com", name: "Ana Reyes" };
