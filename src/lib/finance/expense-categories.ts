/**
 * Configurable expense categories (brief §6) — the same "small, named, ordered list" shape as Phase 6's
 * customer tags, not a hardcoded enum. Seeded with the brief's starting set (reference-data.ts) but fully
 * editable afterward.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { expenseCategories } from "../db/schema";
import { ValidationError, NotFoundError, BusinessError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { n, rows } from "../admin/sql";

export type ExpenseCategoryRow = typeof expenseCategories.$inferSelect;

export async function listExpenseCategories(db: DbOrTx, opts: { onlyActive?: boolean } = {}) {
  const res = await rows<{ id: string; name: string; active: boolean; position: number; usage_count: string }>(db, sql`
    select c.*, coalesce(u.n, 0) as usage_count
    from expense_categories c
    left join (select category_id, count(*) as n from expenses group by category_id) u on u.category_id = c.id
    ${opts.onlyActive ? sql`where c.active` : sql``}
    order by c.position, c.name`);
  return res.map((r) => ({ id: r.id, name: r.name, active: r.active, position: n(r.position), usageCount: n(r.usage_count) }));
}

export async function createExpenseCategory(db: Db, actor: Actor, name: string) {
  assertCan(actor, "finance:write");
  const clean = name.trim();
  if (!clean) throw new ValidationError("Enter a category name.");
  const [row] = await db.insert(expenseCategories).values({ name: clean }).onConflictDoNothing().returning();
  if (!row) throw new ValidationError("A category with that name already exists.");
  await audit(db, actor, "Created expense category", "expense_category", row.id, undefined, { name: row.name });
  return row;
}

export async function setExpenseCategoryActive(db: Db, actor: Actor, id: string, active: boolean) {
  assertCan(actor, "finance:write");
  const [row] = await db.update(expenseCategories).set({ active }).where(eq(expenseCategories.id, id)).returning();
  if (!row) throw new NotFoundError("Category not found.");
  await audit(db, actor, "Changed expense category status", "expense_category", row.id, undefined, { active });
  return row;
}

export async function deleteExpenseCategory(db: Db, actor: Actor, id: string) {
  assertCan(actor, "finance:write");
  const [used] = await rows<{ c: string }>(db, sql`select count(*) as c from expenses where category_id = ${id}`);
  if (n(used?.c) > 0) throw new BusinessError("This category is used by existing expenses — deactivate it instead of deleting it.", "VALIDATION", 422);
  const [row] = await db.delete(expenseCategories).where(eq(expenseCategories.id, id)).returning();
  if (row) await audit(db, actor, "Deleted expense category", "expense_category", id, row, undefined);
}
