import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listAudit, listAuditEntities } from "@/lib/admin/misc";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";

export const metadata = { title: "Audit log" };
const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(", ") : String(v));

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("audit:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), { page, pageSize } = pageParams(sp, 40);
  const params = { q: one(sp.q), entity: one(sp.entity) };
  const res = await safe("audit", async () => ({ list: await listAudit(db, { ...params, page, pageSize }), entities: await listAuditEntities(db) }), one(sp.fail));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Audit log" description="Important changes: who made them, what changed, and when. IP and device details are not collected." />
      <Card>
        <FilterBar><SearchInput placeholder="Search user, action or item" />{res.ok && <FilterSelect param="entity" label="Entity" options={res.data.entities.map((e) => ({ value: e, label: e.replace(/_/g, " ") }))} />}</FilterBar>
        {!res.ok ? <ErrorState message="Unable to load the audit log." /> : <>
          <DataTable caption="Audit log" rows={res.data.list.rows} rowKey={(a) => String(a.id)} basePath="/admin/audit-log" params={params} dense empty={<EmptyState title="No entries" />}
            columns={[
              { key: "d", header: "Date", cell: (a) => <span className="whitespace-nowrap">{dateTimeFull(a.at)}</span> },
              { key: "u", header: "User", cell: (a) => a.actor },
              { key: "a", header: "Action", cell: (a) => <span className="font-medium">{a.action}</span> },
              { key: "e", header: "Entity", cell: (a) => <span className="whitespace-nowrap text-muted">{a.entity.replace(/_/g, " ")} <span className="text-fg">{a.entityId && a.entityId.length > 30 ? `${a.entityId.slice(0, 8)}…` : a.entityId}</span></span>, hideBelow: "md" },
              { key: "b", header: "Before", cell: (a) => <span className="block max-w-[260px] truncate text-muted" title={show(a.oldValue)}>{show(a.oldValue)}</span>, hideBelow: "lg" },
              { key: "f", header: "After", cell: (a) => <span className="block max-w-[300px] truncate" title={show(a.newValue)}>{show(a.newValue)}</span>, hideBelow: "sm" },
            ]} />
          <Pagination {...res.data.list} basePath="/admin/audit-log" params={params} />
        </>}
      </Card>
    </div>
  );
}
