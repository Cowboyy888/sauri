/**
 * Dynamic, database-driven customer segments (brief §4) and RFM analysis (brief §5). Every segment is a
 * SQL predicate evaluated live against `customer_stats`/`orders`/`customers` — never a maintained list, so
 * a customer's segment membership is always correct as of the moment it's read. Thresholds are configurable
 * via `settings."crm"`, never hardcoded — see docs/CUSTOMER_SEGMENTS.md and docs/RFM.md.
 */
import "server-only";
import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import { DEFAULT_CRM_SETTINGS } from "../db/reference-data";
import { n, rows } from "../admin/sql";

export type CrmSettings = typeof DEFAULT_CRM_SETTINGS;
export async function getCrmSettings(db: DbOrTx): Promise<CrmSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(sql`${settings.key} = 'crm'`);
  const v = (row?.value as Partial<CrmSettings> | undefined) ?? {};
  return { ...DEFAULT_CRM_SETTINGS, ...v, rfm: { ...DEFAULT_CRM_SETTINGS.rfm, ...(v.rfm ?? {}) } };
}

export async function setCrmSettings(db: Db, actor: Actor, patch: Partial<CrmSettings>) {
  assertCan(actor, "customers:write");
  const before = await getCrmSettings(db);
  const next: CrmSettings = { ...before, ...patch, rfm: { ...before.rfm, ...(patch.rfm ?? {}) } };
  for (const [k, v] of Object.entries({ ...next, ...next.rfm })) if (typeof v === "number" && v < 0) throw new ValidationError(`${k} can't be negative.`);
  await db.insert(settings).values({ key: "crm", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Updated CRM segment/RFM settings", "settings", "crm", before, next);
  return next;
}

export const SEGMENT_KEYS = ["new", "first_time", "returning", "high_value", "inactive", "frequent", "never_purchased", "recent_purchasers"] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];
export const SEGMENT_LABELS: Record<SegmentKey, { label: string; description: string }> = {
  new: { label: "New Customers", description: "Registered within the configured period." },
  first_time: { label: "First-Time Buyers", description: "Exactly one completed order." },
  returning: { label: "Returning Customers", description: "Two or more completed orders." },
  high_value: { label: "High-Value Customers", description: "Lifetime spend above the configured threshold." },
  inactive: { label: "Inactive Customers", description: "No completed order within the configured period." },
  frequent: { label: "Frequent Buyers", description: "Multiple purchases within the configured recent window." },
  never_purchased: { label: "Never Purchased", description: "Registered but no completed order." },
  recent_purchasers: { label: "Recent Purchasers", description: "Ordered within the configured recent window." },
};

/** One SQL boolean expression per segment, evaluated against `c` (customers) / `s` (customer_stats) /
 *  a correlated count of orders in the frequent-buyer window — see `FROM` clause in each query below. */
export function segmentWhere(key: SegmentKey, cfg: CrmSettings) {
  switch (key) {
    case "new": return sql`c.created_at >= now() - (${cfg.newCustomerDays} || ' days')::interval`;
    case "first_time": return sql`s.total_orders = 1`;
    case "returning": return sql`s.total_orders >= 2`;
    case "high_value": return sql`s.total_spent_cents >= ${cfg.highValueThresholdCents}`;
    case "inactive": return sql`s.total_orders > 0 and (s.last_order_at is null or s.last_order_at < now() - (${cfg.inactiveDays} || ' days')::interval)`;
    case "frequent": return sql`(select count(*) from orders fo where fo.customer_id = c.id and fo.paid_at is not null and fo.status <> 'cancelled' and fo.paid_at >= now() - (${cfg.frequentBuyerDays} || ' days')::interval) >= ${cfg.frequentBuyerMinOrders}`;
    case "never_purchased": return sql`s.total_orders = 0`;
    case "recent_purchasers": return sql`s.last_order_at >= now() - (${cfg.recentPurchaserDays} || ' days')::interval`;
  }
}

export async function getSegmentCounts(db: DbOrTx): Promise<Record<SegmentKey, number>> {
  const cfg = await getCrmSettings(db);
  const out = {} as Record<SegmentKey, number>;
  for (const key of SEGMENT_KEYS) {
    const [row] = await rows<{ n: string }>(db, sql`select count(*) as n from customers c join customer_stats s on s.customer_id = c.id where c.merged_into_customer_id is null and (${segmentWhere(key, cfg)})`);
    out[key] = n(row?.n);
  }
  return out;
}

export type SegmentMember = { id: string; name: string; email: string; orders: number; lifetimeSpendCents: number; lastOrderAt: Date | null; customerSince: Date };
export async function listSegmentMembers(db: DbOrTx, key: SegmentKey, page: number, pageSize: number): Promise<{ rows: SegmentMember[]; total: number }> {
  const cfg = await getCrmSettings(db);
  const res = await rows<Record<string, string | null>>(db, sql`
    select c.id, s.name, s.email, s.total_orders, s.total_spent_cents, s.last_order_at, s.customer_since, count(*) over () as total
    from customers c join customer_stats s on s.customer_id = c.id
    where c.merged_into_customer_id is null and (${segmentWhere(key, cfg)})
    order by s.total_spent_cents desc limit ${pageSize} offset ${(page - 1) * pageSize}`);
  return {
    total: n(res[0]?.total),
    rows: res.map((x) => ({ id: x.id!, name: x.name!, email: x.email!, orders: n(x.total_orders), lifetimeSpendCents: n(x.total_spent_cents), lastOrderAt: x.last_order_at ? new Date(x.last_order_at) : null, customerSince: new Date(x.customer_since!) })),
  };
}

export async function getCustomerSegments(db: DbOrTx, customerId: string): Promise<SegmentKey[]> {
  const cfg = await getCrmSettings(db);
  const conditions = SEGMENT_KEYS.map((k) => sql`(${segmentWhere(k, cfg)}) as ${sql.raw(k)}`);
  const [row] = await rows<Record<string, string | null>>(db, sql`select ${sql.join(conditions, sql`, `)} from customers c join customer_stats s on s.customer_id = c.id where c.id = ${customerId}`);
  if (!row) return [];
  return SEGMENT_KEYS.filter((k) => String(row[k]) === "true");
}

/* --------------------------------------------------------------------------- RFM */
export type RFMLabel = "Recent" | "Active" | "At Risk" | "Inactive";
export type CustomerRFM = { recencyDays: number | null; frequency: number; monetaryCents: number; recencyLabel: RFMLabel; isFrequent: boolean; isHighValue: boolean };

/** No composite "score" is invented — recency/frequency/monetary are reported as-is, each threshold-gated
 *  label is independently justified by the metric it names (brief: "do not create subjective labels beyond
 *  what the metrics support"). `recencyLabel` is the closest thing to an overall segment because recency is
 *  what best predicts churn risk in a repeat-purchase business; the other two are informational, not folded
 *  into one number. */
export function classifyRecency(days: number | null, cfg: CrmSettings["rfm"]): RFMLabel {
  if (days == null) return "Inactive";
  if (days <= cfg.recencyRecentMaxDays) return "Recent";
  if (days >= cfg.recencyInactiveMinDays) return "Inactive";
  if (days >= cfg.recencyAtRiskMinDays) return "At Risk";
  return "Active";
}

export async function getCustomerRFM(db: DbOrTx, customerId: string): Promise<CustomerRFM> {
  const cfg = await getCrmSettings(db);
  const [row] = await rows<{ orders: string; spend: string; last_order_at: string | null }>(db, sql`select s.total_orders as orders, s.total_spent_cents as spend, s.last_order_at from customer_stats s where s.customer_id = ${customerId}`);
  const frequency = n(row?.orders), monetaryCents = n(row?.spend);
  const recencyDays = row?.last_order_at ? Math.floor((Date.now() - new Date(row.last_order_at).getTime()) / 86_400_000) : null;
  return { recencyDays, frequency, monetaryCents, recencyLabel: classifyRecency(recencyDays, cfg.rfm), isFrequent: frequency >= cfg.rfm.frequencyFrequentMinOrders, isHighValue: monetaryCents >= cfg.rfm.monetaryHighValueCents };
}

export async function getRFMDistribution(db: DbOrTx): Promise<Record<RFMLabel, number>> {
  const cfg = await getCrmSettings(db);
  const res = await rows<{ last_order_at: string | null }>(db, sql`select last_order_at from customer_stats where total_orders > 0`);
  const out: Record<RFMLabel, number> = { Recent: 0, Active: 0, "At Risk": 0, Inactive: 0 };
  for (const r of res) {
    const days = r.last_order_at ? Math.floor((Date.now() - new Date(r.last_order_at).getTime()) / 86_400_000) : null;
    out[classifyRecency(days, cfg.rfm)]++;
  }
  return out;
}
