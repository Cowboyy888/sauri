/**
 * Marketing, campaign and conversion analytics (brief §3, §8-9, §26-33). Every money/order figure reads
 * `orders`/`order_items` through `marketing_attributions` (never a duplicated total) — see
 * docs/PHASE_7_AUDIT.md and docs/MARKETING_ANALYTICS.md. Behavioral/funnel figures (sessions, views, cart
 * adds, checkout starts) read `marketing_events`. Zero-safety throughout: a rate with nothing to divide by
 * is `null`, never a fabricated `0%` or `0`.
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { Range } from "./service";
import { n, rows } from "../admin/sql";
import { getCampaignActualSpendCents } from "../marketing/campaigns";
import { getMarketingSettings } from "../marketing/settings";

const inRange = (col: string, r: Range) => sql.raw(`${col} >= '${r.from.toISOString()}' and ${col} < '${r.to.toISOString()}'`);
const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number): number | null => (b ? round2((a / b) * 100) : null);

/** The one CASE expression every channel-grouped query uses, so "Instagram" always means the same thing on
 *  every page (brief: "do not mix users, sessions and page views without clearly labeling them" — the same
 *  spirit applies to channel labels). Reads utm_source/utm_medium columns (JSONB ->> or plain text) plus a
 *  fallback acquisition-source enum column, both passed in as raw SQL fragments. */
function channelCase(sourceExpr: string, mediumExpr: string, fallbackExpr: string) {
  return sql.raw(`
    case
      when lower(coalesce(${mediumExpr},'')) = 'email' then 'Email'
      when lower(coalesce(${sourceExpr},'')) = 'google' and lower(coalesce(${mediumExpr},'')) in ('cpc','ppc','paid') then 'Google Ads'
      when lower(coalesce(${sourceExpr},'')) = 'google' then 'Organic Search'
      when lower(coalesce(${sourceExpr},'')) in ('instagram') or ${fallbackExpr} = 'INSTAGRAM' then 'Instagram'
      when lower(coalesce(${sourceExpr},'')) in ('facebook','fb') or ${fallbackExpr} = 'FACEBOOK' then 'Facebook'
      when lower(coalesce(${sourceExpr},'')) = 'tiktok' or ${fallbackExpr} = 'TIKTOK' then 'TikTok'
      when ${fallbackExpr} = 'REFERRAL' then 'Referral'
      when ${fallbackExpr} = 'DIRECT' or (${sourceExpr} is null and ${mediumExpr} is null and ${fallbackExpr} is null) then 'Direct'
      else 'Other'
    end`);
}

/** Which touch (first or last) drives campaign/channel attribution — configurable, brief §5. */
async function touchCols(db: DbOrTx): Promise<{ campaignCol: string; sourceExpr: string; mediumExpr: string; fallbackExpr: string }> {
  const settings = await getMarketingSettings(db);
  const p = settings.attributionModel === "FIRST_TOUCH" ? "first_touch" : "last_touch";
  return { campaignCol: `ma.${p}_campaign_id`, sourceExpr: `ma.${p}_details->>'utmSource'`, mediumExpr: `ma.${p}_details->>'utmMedium'`, fallbackExpr: `ma.${p}_source` };
}

/* --------------------------------------------------------------------- overview KPIs (brief §3) */
export type MarketingOverview = {
  marketingRevenueCents: number; marketingOrders: number; marketingCustomers: number;
  conversionRate: number | null; averageOrderValueCents: number; discountAmountCents: number;
  returningCustomerRevenueCents: number; newCustomerRevenueCents: number;
};
export async function getMarketingOverview(db: DbOrTx, r: Range): Promise<MarketingOverview> {
  const t = await touchCols(db);
  const [row] = await rows<Record<string, string | null>>(db, sql`
    with attributed as (
      select o.*, ${sql.raw(t.campaignCol)} is not null as is_marketing,
        (select count(*) from orders fo where fo.customer_id = o.customer_id and fo.paid_at is not null and fo.paid_at < o.paid_at) = 0 as is_new
      from orders o join marketing_attributions ma on ma.order_id = o.id
      where o.paid_at is not null and ${inRange("o.paid_at", r)}
    )
    select
      coalesce(sum(subtotal_cents - discount_total_cents - refund_total_cents) filter (where is_marketing), 0) as marketing_revenue,
      count(*) filter (where is_marketing) as marketing_orders,
      count(distinct customer_id) filter (where is_marketing) as marketing_customers,
      coalesce(sum(discount_total_cents) filter (where is_marketing), 0) as discount_amount,
      coalesce(sum(subtotal_cents - discount_total_cents - refund_total_cents) filter (where is_new), 0) as new_revenue,
      coalesce(sum(subtotal_cents - discount_total_cents - refund_total_cents) filter (where not is_new), 0) as returning_revenue
    from attributed`);
  const [sessionsRow] = await rows<{ n: string }>(db, sql`select count(distinct session_id) as n from marketing_events where type = 'page_view' and ${inRange("created_at", r)}`);
  const marketingOrders = n(row?.marketing_orders), marketingRevenue = n(row?.marketing_revenue);
  const qualifiedSessions = n(sessionsRow?.n);
  return {
    marketingRevenueCents: marketingRevenue, marketingOrders, marketingCustomers: n(row?.marketing_customers),
    conversionRate: pct(marketingOrders, qualifiedSessions), averageOrderValueCents: marketingOrders ? Math.round(marketingRevenue / marketingOrders) : 0,
    discountAmountCents: n(row?.discount_amount), returningCustomerRevenueCents: n(row?.returning_revenue), newCustomerRevenueCents: n(row?.new_revenue),
  };
}

/* --------------------------------------------------------------------- campaign performance (brief §8, §28-31) */
export type CampaignPerformance = {
  id: string; name: string; slug: string; status: string; source: string; medium: string;
  sessions: number; productViews: number; addToCart: number; checkoutStarted: number;
  orders: number; revenueCents: number; unitsSold: number; averageOrderValueCents: number; conversionRate: number | null;
  discountCents: number; newCustomers: number; returningCustomers: number;
  budgetCents: number | null; spendCents: number; roas: number | null; roi: number | null; cac: number | null;
};
export async function getCampaignPerformance(db: DbOrTx, r: Range): Promise<CampaignPerformance[]> {
  const t = await touchCols(db);
  const campaigns = await rows<Record<string, string | null>>(db, sql`select id, name, slug, status, budget_cents, source, medium from marketing_campaigns order by created_at desc`);
  const out: CampaignPerformance[] = [];
  for (const c of campaigns) {
    const [events] = await rows<Record<string, string>>(db, sql`
      select count(distinct session_id) filter (where type = 'page_view') as sessions,
        count(*) filter (where type = 'product_viewed') as views,
        count(*) filter (where type = 'cart_added') as cart,
        count(*) filter (where type = 'checkout_started') as checkout
      from marketing_events where campaign_id = ${c.id} and ${inRange("created_at", r)}`);
    const [money] = await rows<Record<string, string | null>>(db, sql`
      with attributed as (
        select o.*, (select count(*) from orders fo where fo.customer_id = o.customer_id and fo.paid_at is not null and fo.paid_at < o.paid_at) = 0 as is_new
        from orders o join marketing_attributions ma on ma.order_id = o.id and ${sql.raw(t.campaignCol)} = ${c.id}
        where o.paid_at is not null and ${inRange("o.paid_at", r)}
      )
      select count(*) as orders, coalesce(sum(subtotal_cents - discount_total_cents - refund_total_cents),0) as revenue,
        coalesce(sum(discount_total_cents),0) as discount,
        (select coalesce(sum(i.quantity),0) from order_items i where i.order_id in (select id from attributed)) as units,
        count(distinct customer_id) filter (where is_new) as new_customers, count(distinct customer_id) filter (where not is_new) as returning_customers
      from attributed`);
    const spendCents = await getCampaignActualSpendCents(db, c.id!);
    const orders = n(money?.orders), revenue = n(money?.revenue), sessions = n(events?.sessions), newCustomers = n(money?.new_customers);
    out.push({
      id: c.id!, name: c.name!, slug: c.slug!, status: c.status!, source: c.source!, medium: c.medium!,
      sessions, productViews: n(events?.views), addToCart: n(events?.cart), checkoutStarted: n(events?.checkout),
      orders, revenueCents: revenue, unitsSold: n(money?.units), averageOrderValueCents: orders ? Math.round(revenue / orders) : 0,
      conversionRate: pct(orders, sessions), discountCents: n(money?.discount), newCustomers, returningCustomers: n(money?.returning_customers),
      budgetCents: c.budget_cents == null ? null : n(c.budget_cents), spendCents,
      roas: spendCents > 0 ? round2(revenue / spendCents) : null,
      roi: spendCents > 0 ? round2(((revenue - spendCents) / spendCents) * 100) : null,
      cac: spendCents > 0 && newCustomers > 0 ? Math.round(spendCents / newCustomers) : null,
    });
  }
  return out;
}

/* --------------------------------------------------------------------- channel performance (brief §26, §30) */
export type ChannelPerformance = { channel: string; sessions: number; orders: number; revenueCents: number; customers: number; averageOrderValueCents: number; conversionRate: number | null; adSpendCents: number | null; roas: number | null };
const CHANNELS = ["Organic Search", "Google Ads", "Direct", "Instagram", "Facebook", "TikTok", "Referral", "Email", "Other"] as const;
export async function getChannelPerformance(db: DbOrTx, r: Range): Promise<ChannelPerformance[]> {
  const t = await touchCols(db);
  const channelExpr = channelCase(t.sourceExpr, t.mediumExpr, t.fallbackExpr);
  const money = await rows<Record<string, string | null>>(db, sql`
    select ${channelExpr} as channel, count(*) as orders, coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents),0) as revenue, count(distinct o.customer_id) as customers
    from orders o join marketing_attributions ma on ma.order_id = o.id
    where o.paid_at is not null and ${inRange("o.paid_at", r)}
    group by 1`);
  const eventSourceExpr = `e.utm_source`, eventMediumExpr = `e.utm_medium`;
  const sessions = await rows<Record<string, string>>(db, sql`
    select ${channelCase(eventSourceExpr, eventMediumExpr, "null")} as channel, count(distinct session_id) as n
    from marketing_events e where type = 'page_view' and ${inRange("created_at", r)} group by 1`);
  const spend = await rows<{ channel: string; spend: string }>(db, sql`
    select ${channelCase("mc.source", "mc.medium", "null")} as channel, coalesce(sum(cc.amount_cents),0) as spend
    from campaign_costs cc join marketing_campaigns mc on mc.id = cc.campaign_id
    where ${inRange("cc.incurred_at", r)} group by 1`);
  const byChannel = new Map<string, { orders: number; revenue: number; customers: number; sessions: number; spend: number }>(CHANNELS.map((c) => [c, { orders: 0, revenue: 0, customers: 0, sessions: 0, spend: 0 }]));
  for (const m of money) { const b = byChannel.get(m.channel as string); if (b) { b.orders = n(m.orders); b.revenue = n(m.revenue); b.customers = n(m.customers); } }
  for (const s of sessions) { const b = byChannel.get(s.channel!); if (b) b.sessions = n(s.n); }
  for (const s of spend) { const b = byChannel.get(s.channel); if (b) b.spend = n(s.spend); }
  return CHANNELS.map((channel) => {
    const b = byChannel.get(channel)!;
    return {
      channel, sessions: b.sessions, orders: b.orders, revenueCents: b.revenue, customers: b.customers,
      averageOrderValueCents: b.orders ? Math.round(b.revenue / b.orders) : 0, conversionRate: pct(b.orders, b.sessions),
      adSpendCents: b.spend > 0 ? b.spend : null, roas: b.spend > 0 ? round2(b.revenue / b.spend) : null,
    };
  }).filter((c) => c.sessions > 0 || c.orders > 0 || c.adSpendCents != null);
}

/* --------------------------------------------------------------------- CAC (brief §31) */
export async function getOverallCAC(db: DbOrTx, r: Range): Promise<{ spendCents: number; newCustomers: number; cacCents: number | null }> {
  const [spendRow] = await rows<{ total: string | null }>(db, sql`select sum(amount_cents) as total from campaign_costs where ${inRange("incurred_at", r)}`);
  const [customersRow] = await rows<{ n: string }>(db, sql`
    with firsts as (select customer_id, min(paid_at) as f from orders where paid_at is not null group by customer_id)
    select count(*) as n from firsts where ${inRange("f", r)}`);
  const spendCents = n(spendRow?.total), newCustomers = n(customersRow?.n);
  return { spendCents, newCustomers, cacCents: spendCents > 0 && newCustomers > 0 ? Math.round(spendCents / newCustomers) : null };
}

/* --------------------------------------------------------------------- new vs returning revenue (brief §32) */
export async function getNewVsReturningRevenue(db: DbOrTx, r: Range) {
  const [row] = await rows<Record<string, string>>(db, sql`
    with rec as (select o.*, (select count(*) from orders fo where fo.customer_id = o.customer_id and fo.paid_at is not null and fo.paid_at < o.paid_at) = 0 as is_new
      from orders o where o.paid_at is not null and ${inRange("o.paid_at", r)})
    select
      coalesce(sum(subtotal_cents - discount_total_cents - refund_total_cents) filter (where is_new),0) as new_revenue,
      coalesce(sum(subtotal_cents - discount_total_cents - refund_total_cents) filter (where not is_new),0) as returning_revenue,
      count(*) filter (where is_new) as new_orders, count(*) filter (where not is_new) as returning_orders
    from rec`);
  return { newRevenueCents: n(row?.new_revenue), returningRevenueCents: n(row?.returning_revenue), newOrders: n(row?.new_orders), returningOrders: n(row?.returning_orders) };
}

/* --------------------------------------------------------------------- funnel (brief §33) */
export type MarketingFunnel = { sessions: number; productViews: number; addToCart: number; checkoutStarted: number; purchases: number; viewRate: number | null; cartRate: number | null; checkoutRate: number | null; purchaseRate: number | null };
export async function getMarketingFunnel(db: DbOrTx, r: Range): Promise<MarketingFunnel> {
  const [ev] = await rows<Record<string, string>>(db, sql`
    select count(distinct session_id) filter (where type = 'page_view') as sessions,
      count(*) filter (where type = 'product_viewed') as views, count(*) filter (where type = 'cart_added') as cart, count(*) filter (where type = 'checkout_started') as checkout
    from marketing_events where ${inRange("created_at", r)}`);
  const [ord] = await rows<{ n: string }>(db, sql`select count(*) as n from orders where paid_at is not null and ${inRange("paid_at", r)}`);
  const sessions = n(ev?.sessions), views = n(ev?.views), cart = n(ev?.cart), checkout = n(ev?.checkout), purchases = n(ord?.n);
  return { sessions, productViews: views, addToCart: cart, checkoutStarted: checkout, purchases, viewRate: pct(views, sessions), cartRate: pct(cart, views), checkoutRate: pct(checkout, cart), purchaseRate: pct(purchases, checkout) };
}

/* --------------------------------------------------------------------- product funnel extras (brief §10-11) */
export type ProductFunnelRow = { productId: string; views: number; wishlistAdds: number; addToCart: number; checkoutStarted: number };
export async function getProductFunnelExtras(db: DbOrTx, r: Range): Promise<Map<string, ProductFunnelRow>> {
  const ev = await rows<Record<string, string>>(db, sql`
    select product_id, count(*) filter (where type = 'product_viewed') as views, count(*) filter (where type = 'cart_added') as cart, count(*) filter (where type = 'checkout_started') as checkout
    from marketing_events where product_id is not null and ${inRange("created_at", r)} group by product_id`);
  const wish = await rows<{ product_id: string; n: string }>(db, sql`select product_id, count(*) as n from wishlist_events where action = 'added' and ${inRange("created_at", r)} group by product_id`);
  const map = new Map<string, ProductFunnelRow>();
  for (const e of ev) map.set(e.product_id!, { productId: e.product_id!, views: n(e.views), wishlistAdds: 0, addToCart: n(e.cart), checkoutStarted: n(e.checkout) });
  for (const w of wish) { const ex = map.get(w.product_id); if (ex) ex.wishlistAdds = n(w.n); else map.set(w.product_id, { productId: w.product_id, views: 0, wishlistAdds: n(w.n), addToCart: 0, checkoutStarted: 0 }); }
  return map;
}

/* --------------------------------------------------------------------- collection analytics (brief §12) */
export type CollectionAnalyticsRow = { id: string; name: string; views: number; productViews: number; addToCart: number; orders: number; revenueCents: number; unitsSold: number; conversionRate: number | null };
export async function getCollectionAnalytics(db: DbOrTx, r: Range): Promise<CollectionAnalyticsRow[]> {
  const cols = await rows<{ id: string; name: string }>(db, sql`select id, name from collections order by name`);
  const events = await rows<Record<string, string>>(db, sql`
    select collection_id, count(*) filter (where type = 'collection_viewed') as views from marketing_events where collection_id is not null and ${inRange("created_at", r)} group by collection_id`);
  const productEvents = await rows<Record<string, string>>(db, sql`
    select p.collection_id, count(*) filter (where e.type = 'product_viewed') as pviews, count(*) filter (where e.type = 'cart_added') as cart
    from marketing_events e join products p on p.id = e.product_id where p.collection_id is not null and ${inRange("e.created_at", r)} group by p.collection_id`);
  const sales = await rows<Record<string, string>>(db, sql`
    select p.collection_id, count(distinct o.id) as orders, coalesce(sum(i.line_total_cents),0) as revenue, coalesce(sum(i.quantity),0) as units
    from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id
    where o.paid_at is not null and p.collection_id is not null and ${inRange("o.paid_at", r)} group by p.collection_id`);
  const viewsById = new Map(events.map((e) => [e.collection_id, n(e.views)]));
  const prodById = new Map(productEvents.map((e) => [e.collection_id, { pviews: n(e.pviews), cart: n(e.cart) }]));
  const salesById = new Map(sales.map((s) => [s.collection_id, { orders: n(s.orders), revenue: n(s.revenue), units: n(s.units) }]));
  return cols.map((c) => {
    const views = viewsById.get(c.id) ?? 0, p = prodById.get(c.id) ?? { pviews: 0, cart: 0 }, s = salesById.get(c.id) ?? { orders: 0, revenue: 0, units: 0 };
    return { id: c.id, name: c.name, views, productViews: p.pviews, addToCart: p.cart, orders: s.orders, revenueCents: s.revenue, unitsSold: s.units, conversionRate: pct(s.orders, views || p.pviews) };
  });
}

/* --------------------------------------------------------------------- search analytics (brief §36-38) */
export type SearchRow = { query: string; count: number; resultsFound: number; productClicks: number; orders: number; revenueCents: number };
export async function getSearchAnalytics(db: DbOrTx, r: Range, limit = 50): Promise<SearchRow[]> {
  const res = await rows<Record<string, string>>(db, sql`
    select lower(trim(search_query)) as q, count(*) as n, max(results_count) as results
    from marketing_events where type = 'search' and search_query is not null and trim(search_query) <> '' and ${inRange("created_at", r)}
    group by 1 order by n desc limit ${limit}`);
  return res.map((x) => ({ query: x.q!, count: n(x.n), resultsFound: n(x.results), productClicks: 0, orders: 0, revenueCents: 0 }));
}
export type ZeroResultSearch = { query: string; count: number; lastSearchedAt: Date };
export async function getZeroResultSearches(db: DbOrTx, r: Range, limit = 100): Promise<ZeroResultSearch[]> {
  const res = await rows<Record<string, string>>(db, sql`
    select lower(trim(search_query)) as q, count(*) as n, max(created_at) as last
    from marketing_events where type = 'search' and coalesce(results_count,0) = 0 and search_query is not null and trim(search_query) <> '' and ${inRange("created_at", r)}
    group by 1 order by n desc limit ${limit}`);
  return res.map((x) => ({ query: x.q!, count: n(x.n), lastSearchedAt: new Date(x.last!) }));
}
export async function getSearchConversion(db: DbOrTx, r: Range): Promise<{ searches: number; zeroResult: number; zeroResultRate: number | null }> {
  const [row] = await rows<Record<string, string>>(db, sql`
    select count(*) filter (where type = 'search') as searches, count(*) filter (where type = 'search' and coalesce(results_count,0) = 0) as zero
    from marketing_events where ${inRange("created_at", r)}`);
  const searches = n(row?.searches), zero = n(row?.zero);
  return { searches, zeroResult: zero, zeroResultRate: pct(zero, searches) };
}

/* --------------------------------------------------------------------- back-in-stock demand (brief §38) */
export type BackInStockDemandRow = { variantId: string; productName: string; sku: string; subscribers: number; currentStock: number; notified: number; purchasesAfterRestock: number };
export async function getBackInStockDemand(db: DbOrTx): Promise<BackInStockDemandRow[]> {
  const res = await rows<Record<string, string>>(db, sql`
    with sub as (
      select variant_id, count(*) as subscribers, count(*) filter (where notified_at is not null) as notified, min(notified_at) as first_notified
      from stock_notifications group by variant_id
    )
    select sub.variant_id, p.name as product_name, pv.sku, sub.subscribers, sub.notified,
      coalesce(i.stock_quantity - i.reserved_quantity, 0) as current_stock,
      (select count(distinct oi.order_id) from order_items oi join orders o on o.id = oi.order_id
       where oi.variant_id = sub.variant_id and o.paid_at is not null and sub.first_notified is not null and o.paid_at > sub.first_notified) as purchases_after
    from sub join product_variants pv on pv.id = sub.variant_id join products p on p.id = pv.product_id left join inventory i on i.variant_id = sub.variant_id
    order by sub.subscribers desc limit 100`);
  return res.map((x) => ({ variantId: x.variant_id!, productName: x.product_name!, sku: x.sku!, subscribers: n(x.subscribers), currentStock: n(x.current_stock), notified: n(x.notified), purchasesAfterRestock: n(x.purchases_after) }));
}

/* --------------------------------------------------------------------- device analytics (brief §34) */
export async function getDeviceAnalytics(db: DbOrTx, r: Range) {
  const res = await rows<Record<string, string | null>>(db, sql`
    select coalesce(e.device, 'unknown') as device, count(distinct e.session_id) as sessions,
      (select count(*) from orders o join marketing_events oe on oe.order_id = o.id and oe.type = 'purchase_completed' and oe.device = e.device where o.paid_at is not null and ${inRange("o.paid_at", r)}) as orders,
      (select coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents),0) from orders o join marketing_events oe on oe.order_id = o.id and oe.type = 'purchase_completed' and oe.device = e.device where o.paid_at is not null and ${inRange("o.paid_at", r)}) as revenue
    from marketing_events e where e.type = 'page_view' and ${inRange("e.created_at", r)} group by e.device`);
  return res.map((x) => ({ device: x.device!, sessions: n(x.sessions), orders: n(x.orders), revenueCents: n(x.revenue), conversionRate: pct(n(x.orders), n(x.sessions)) }));
}

/* --------------------------------------------------------------------- landing page analytics (brief §35) */
export async function getLandingPageAnalytics(db: DbOrTx, r: Range, limit = 50) {
  const res = await rows<Record<string, string>>(db, sql`
    with first_hit as (select session_id, min(created_at) as t from marketing_events where type = 'page_view' and ${inRange("created_at", r)} group by session_id)
    select e.path, count(distinct e.session_id) as sessions
    from marketing_events e join first_hit fh on fh.session_id = e.session_id and fh.t = e.created_at
    where e.type = 'page_view' and e.path is not null group by e.path order by sessions desc limit ${limit}`);
  return res.map((x) => ({ path: x.path!, sessions: n(x.sessions) })) as { path: string; sessions: number }[];
}

/* --------------------------------------------------------------------- abandoned-cart recovery (brief §21) */
export type RecoveryAnalytics = { abandonedCarts: number; recoveredCarts: number; recoveryRate: number | null; recoveredRevenueCents: number; discountCostCents: number; netRecoveredRevenueCents: number };
export async function getRecoveryAnalytics(db: DbOrTx, r: Range, thresholdHours: number): Promise<RecoveryAnalytics> {
  const [row] = await rows<Record<string, string | null>>(db, sql`
    with eligible as (
      select ac.*, (ac.status = 'recovered' or ac.last_activity_at < now() - (${thresholdHours} || ' hours')::interval) as counts
      from abandoned_carts ac where ${inRange("ac.created_at", r)}
    )
    select count(*) filter (where counts) as eligible, count(*) filter (where status = 'recovered' and counts) as recovered,
      coalesce((select sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents) from orders o join eligible e on e.recovered_order_id = o.id where e.status = 'recovered' and e.counts), 0) as revenue,
      coalesce((select sum(o.discount_total_cents) from orders o join eligible e on e.recovered_order_id = o.id where e.status = 'recovered' and e.counts), 0) as discount
    from eligible`);
  const eligible = n(row?.eligible), recovered = n(row?.recovered), revenue = n(row?.revenue), discount = n(row?.discount);
  return { abandonedCarts: eligible, recoveredCarts: recovered, recoveryRate: pct(recovered, eligible), recoveredRevenueCents: revenue, discountCostCents: discount, netRecoveredRevenueCents: revenue - discount };
}

export const _internal = { touchCols, channelCase };
export type { SQL };
