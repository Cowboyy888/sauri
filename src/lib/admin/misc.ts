import { eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { notifications, settings } from "../db/schema";
import { like, n, orderBy, productImage, rows, type Page } from "./sql";

/* ---------------- notifications ---------------- */
/** Display names from the brief (§39) mapped onto the stored enum values. */
export const NOTIFICATION_LABEL: Record<string, string> = {
  new_order: "NEW_ORDER", large_order: "LARGE_ORDER", low_stock: "LOW_STOCK", out_of_stock: "OUT_OF_STOCK",
  payment_failed: "PAYMENT_FAILED", refund: "REFUND", review: "REVIEW", system: "SYSTEM_WARNING",
};
export type NotificationRow = { id: number; type: string; title: string; body: string; reference: string | null; href: string; read: boolean; at: Date };

/** Where clicking a notification goes. Order references resolve to the order's page. */
export async function listNotifications(db: DbOrTx, limit = 20): Promise<{ items: NotificationRow[]; unread: number }> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select nt.*, o.id as order_id, vs.product_id as variant_product
    from notifications nt
      left join orders o on o.order_number = nt.reference
      left join variant_stock vs on vs.sku = nt.reference
    order by nt.created_at desc, nt.id desc limit ${limit}`);
  const [u] = await rows<{ c: string }>(db, sql`select count(*) as c from notifications where read_at is null`);
  return {
    unread: n(u?.c),
    items: res.map((x) => ({
      id: n(x.id), type: x.type!, title: x.title!, body: x.body ?? "", reference: x.reference ?? null, read: !!x.read_at, at: new Date(x.created_at!),
      href: x.order_id ? `/admin/orders/${x.order_id}` : x.type === "low_stock" || x.type === "out_of_stock" ? `/admin/inventory?q=${encodeURIComponent(x.reference ?? "")}` : x.type === "review" ? "/admin/reviews" : "/admin/dashboard",
    })),
  };
}
export async function markNotificationsRead(db: DbOrTx, ids: number[] | "all") {
  const now = new Date();
  if (ids === "all") await db.update(notifications).set({ readAt: now }).where(isNull(notifications.readAt));
  else if (ids.length) await db.update(notifications).set({ readAt: now }).where(inArray(notifications.id, ids));
}

/* ---------------- audit log ---------------- */
export type AuditRow = { id: number; at: Date; actor: string; action: string; entity: string; entityId: string | null; oldValue: unknown; newValue: unknown };
export async function listAudit(db: DbOrTx, o: { q?: string; entity?: string; page: number; pageSize: number }): Promise<Page<AuditRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, unknown>>(db, sql`
    select a.*, count(*) over () as total from audit_logs a
    where true ${q ? sql`and (a.actor ilike ${like(q)} or a.action ilike ${like(q)} or a.entity_id ilike ${like(q)})` : sql``}
      ${o.entity ? sql`and a.entity = ${o.entity}` : sql``}
    order by a.created_at desc, a.id desc limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return { total: n(res[0]?.total), page: o.page, pageSize: o.pageSize, rows: res.map((a) => ({ id: n(a.id), at: new Date(String(a.created_at)), actor: String(a.actor), action: String(a.action), entity: String(a.entity), entityId: (a.entity_id as string) ?? null, oldValue: a.old_value, newValue: a.new_value })) };
}
export async function listAuditEntities(db: DbOrTx) {
  return (await rows<{ entity: string }>(db, sql`select distinct entity from audit_logs order by entity`)).map((r) => r.entity);
}

/* ---------------- global search (top bar) ---------------- */
export type SearchHit = { kind: "order" | "product" | "variant" | "customer"; id: string; title: string; subtitle: string; href: string; image?: string | null };
export async function globalSearch(db: DbOrTx, q: string, can: { orders: boolean; products: boolean; customers: boolean }): Promise<SearchHit[]> {
  const t = q.trim();
  if (t.length < 2) return [];
  const L = like(t);
  const [o, p, v, c] = await Promise.all([
    can.orders ? rows<Record<string, string>>(db, sql`select o.id, o.order_number, c.name, o.total_cents, o.status from orders o join customers c on c.id = o.customer_id where o.order_number ilike ${L} or c.name ilike ${L} order by o.placed_at desc limit 5`) : [],
    can.products ? rows<Record<string, string | null>>(db, sql`select p.id, p.name, p.status, ${productImage("p.id")} as image from products p where p.name ilike ${L} order by p.name limit 5`) : [],
    can.products ? rows<Record<string, string | null>>(db, sql`select vs.product_id, vs.sku, vs.product_name, vs.available_stock, vs.variant_label from variant_stock vs where vs.sku ilike ${L} or vs.barcode ilike ${L} order by vs.sku limit 5`) : [],
    can.customers ? rows<Record<string, string>>(db, sql`select customer_id, name, email, total_orders from customer_stats where name ilike ${L} or email ilike ${L} order by total_spent_cents desc limit 5`) : [],
  ]);
  const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
  return [
    ...o.map((x) => ({ kind: "order" as const, id: x.id!, title: x.order_number!, subtitle: `${x.name} · ${money(n(x.total_cents))} · ${x.status}`, href: `/admin/orders/${x.id}` })),
    ...p.map((x) => ({ kind: "product" as const, id: x.id!, title: x.name!, subtitle: `Product · ${x.status}`, href: `/admin/products/${x.id}`, image: x.image ?? null })),
    ...v.map((x) => ({ kind: "variant" as const, id: `${x.product_id}-${x.sku}`, title: x.sku!, subtitle: `${x.product_name} · ${x.variant_label} · ${x.available_stock} available`, href: `/admin/products/${x.product_id}?tab=inventory` })),
    ...c.map((x) => ({ kind: "customer" as const, id: x.customer_id!, title: x.name!, subtitle: `${x.email} · ${x.total_orders} orders`, href: `/admin/customers/${x.customer_id}` })),
  ];
}

/* ---------------- discounts, reviews, staff, content ---------------- */
export async function listDiscounts(db: DbOrTx) {
  const res = await rows<Record<string, string | null>>(db, sql`select d.*, c.name as category, p.name as product from discounts d left join categories c on c.id = d.category_id left join products p on p.id = d.product_id order by d.created_at desc`);
  return res.map((d) => ({
    id: d.id!, code: d.code!, type: d.type!, value: n(d.value), scope: d.category ? `${d.category} only` : d.product ? `${d.product} only` : "All products",
    minSubtotalCents: n(d.min_subtotal_cents), maxDiscountCents: d.max_discount_cents == null ? null : n(d.max_discount_cents),
    startsAt: new Date(d.starts_at!), endsAt: d.ends_at ? new Date(d.ends_at) : null, usageLimit: d.usage_limit == null ? null : n(d.usage_limit),
    perCustomerLimit: d.per_customer_limit == null ? null : n(d.per_customer_limit), usedCount: n(d.used_count), active: String(d.active) === "true",
  }));
}

export async function listReviews(db: DbOrTx, o: { status?: string; page: number; pageSize: number }) {
  const res = await rows<Record<string, string | null>>(db, sql`
    select r.id, r.rating, r.title, r.body, r.author_name, r.status, r.created_at, p.id as product_id, p.name as product, ${productImage("p.id")} as image, count(*) over () as total
    from reviews r join products p on p.id = r.product_id
    where true ${o.status ? sql`and r.status = ${o.status}` : sql``}
    order by (r.status = 'pending') desc, r.created_at desc limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return { total: n(res[0]?.total), page: o.page, pageSize: o.pageSize, rows: res.map((r) => ({ id: r.id!, rating: n(r.rating), title: r.title!, body: r.body!, author: r.author_name!, status: r.status!, at: new Date(r.created_at!), productId: r.product_id!, product: r.product!, image: r.image ?? null })) };
}

export async function listStaff(db: DbOrTx) {
  const res = await rows<Record<string, string | null>>(db, sql`select id, name, email, role, active, auth_user_id, created_at from users order by (role = 'OWNER') desc, name`);
  return res.map((u) => ({ id: u.id!, name: u.name!, email: u.email!, role: u.role!, active: String(u.active) === "true", linked: !!u.auth_user_id, createdAt: new Date(u.created_at!) }));
}

export type StoreContent = { announce: string; heroTitle: string; heroLede: string };
export async function getContent(db: DbOrTx): Promise<StoreContent> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "content"));
  const v = (row?.value ?? {}) as Partial<StoreContent>;
  return { announce: v.announce ?? "", heroTitle: v.heroTitle ?? "", heroLede: v.heroLede ?? "" };
}

export { orderBy };
