import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { abandonedCartKpis, listAbandonedCarts } from "@/lib/marketing/abandoned-carts";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { dateTimeFull, int, money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { safe } from "@/lib/admin/safe";

export const metadata = { title: "Abandoned Carts" };
export const dynamic = "force-dynamic";
const THRESHOLD_HOURS = 24;

export default async function AbandonedCartsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("customers:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), { page, pageSize } = pageParams(sp);
  const [kpis, res] = await Promise.all([
    abandonedCartKpis(db, THRESHOLD_HOURS),
    safe("carts", () => listAbandonedCarts(db, THRESHOLD_HOURS, page, pageSize), one(sp.fail)),
  ]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Abandoned Carts" description={`Signed-in customers only (brief §19) — carts inactive for ${THRESHOLD_HOURS}h are considered abandoned. Tracking only; no recovery email is sent automatically.`} />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Cart figures">
        <KPICard label="Active carts" value={int(kpis.active)} change={null} comparison="" note={`Activity within ${THRESHOLD_HOURS}h`} />
        <KPICard label="Abandoned carts" value={int(kpis.abandoned)} change={null} comparison="" tone={kpis.abandoned > 0 ? "warn" : undefined} />
        <KPICard label="Open cart value" value={money(kpis.openCartValueCents)} change={null} comparison="" note="Active + abandoned" />
      </section>
      <Card>
        {!res.ok ? <ErrorState message="Unable to load carts." /> : !res.data.rows.length ? <EmptyState title="No tracked carts" /> : <>
          <DataTable caption="Abandoned carts" rows={res.data.rows} rowKey={(c) => c.id} basePath="/admin/marketing/abandoned-carts" params={{}}
            empty={<EmptyState title="No carts" />}
            columns={[
              { key: "c", header: "Customer", cell: (c) => <Link href={`/admin/customers/${c.customerId}`} className="font-medium text-accent hover:underline">{c.customerName}</Link> },
              { key: "i", header: "Items", cell: (c) => c.items.map((it) => it.name).join(", "), hideBelow: "md" },
              { key: "n", header: "Item count", align: "right", cell: (c) => int(c.itemCount) },
              { key: "v", header: "Cart value", align: "right", cell: (c) => money(c.cartValueCents) },
              { key: "a", header: "Last activity", cell: (c) => dateTimeFull(c.lastActivityAt), hideBelow: "sm" },
              { key: "s", header: "Status", cell: (c) => <StatusBadge status={c.effectiveStatus} /> },
            ]} />
          <Pagination page={page} pageSize={pageSize} total={res.data.total} basePath="/admin/marketing/abandoned-carts" params={{}} />
        </>}
      </Card>
    </div>
  );
}
