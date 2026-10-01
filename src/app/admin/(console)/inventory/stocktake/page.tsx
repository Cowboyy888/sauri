import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listStocktakes, getStocktakeSettings } from "@/lib/purchasing/stocktake";
import { inventoryLocations } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { StartStocktakeButton, StocktakeSettingsForm } from "@/components/admin/purchasing-forms";

export const metadata = { title: "Stocktake" };

export default async function StocktakePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("inventory:write");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("stocktake", async () => {
    const [list, settings, locations] = await Promise.all([listStocktakes(db), getStocktakeSettings(db), db.select({ id: inventoryLocations.id, name: inventoryLocations.name }).from(inventoryLocations)]);
    return { list, settings, locations };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Stocktake" description="Cycle counts, with manager approval above a configurable discrepancy threshold." actions={res.ok && <StartStocktakeButton locations={res.data.locations} />} />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load stocktakes." /> :
          <DataTable caption="Stocktakes" rows={res.data.list} rowKey={(s) => s.id} basePath="/admin/inventory/stocktake" params={{}}
            empty={<EmptyState title="No stocktakes yet" />}
            columns={[
              { key: "d", header: "Started", cell: (s) => <Link href={`/admin/inventory/stocktake/${s.id}`} className="hover:underline">{dateTimeFull(s.startedAt)}</Link> },
              { key: "n", header: "Notes", cell: (s) => s.notes || "—", hideBelow: "md" },
              { key: "st", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            ]} />}
      </Card>
      {res.ok && (
        <Card><CardHeader title="Settings" /><CardBody><StocktakeSettingsForm approvalThresholdUnits={res.data.settings.approvalThresholdUnits} /></CardBody></Card>
      )}
    </div>
  );
}
