import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getCrmSettings, getSegmentCounts, listSegmentMembers, SEGMENT_KEYS, SEGMENT_LABELS, type SegmentKey } from "@/lib/crm/segments";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { dateShort, int, money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";
import { CrmSettingsForm } from "@/components/admin/crm-settings-form";

export const metadata = { title: "Customer Segments" };

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("customers:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), { page, pageSize } = pageParams(sp);
  const active = (one(sp.segment) as SegmentKey | undefined) && SEGMENT_KEYS.includes(one(sp.segment) as SegmentKey) ? (one(sp.segment) as SegmentKey) : null;
  const [counts, cfg] = await Promise.all([getSegmentCounts(db), getCrmSettings(db)]);
  const members = active ? await listSegmentMembers(db, active, page, pageSize) : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Customers</Link>
      <PageHeader title="Customer Segments" description="Every segment is computed live from real order data — never a maintained list (brief §4)." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SEGMENT_KEYS.map((key) => (
          <Link key={key} href={`/admin/customers/segments?segment=${key}`} className={`rounded-lg border p-4 hover:border-accent ${active === key ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
            <p className="text-[13px] font-medium">{SEGMENT_LABELS[key].label}</p>
            <p className="mt-1 text-2xl font-semibold">{int(counts[key])}</p>
            <p className="mt-1 text-xs text-muted">{SEGMENT_LABELS[key].description}</p>
          </Link>
        ))}
      </div>

      {active && (
        <Card>
          <CardHeader title={SEGMENT_LABELS[active].label} description={`${int(counts[active])} customers`} />
          {!members || !members.rows.length ? <EmptyState title="No customers in this segment" /> : <>
            <DataTable caption={SEGMENT_LABELS[active].label} rows={members.rows} rowKey={(c) => c.id} basePath="/admin/customers/segments" params={{ segment: active }}
              empty={<EmptyState title="No customers" />}
              columns={[
                { key: "n", header: "Customer", cell: (c) => <Link href={`/admin/customers/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link> },
                { key: "e", header: "Email", cell: (c) => c.email, hideBelow: "md" },
                { key: "o", header: "Orders", align: "right", cell: (c) => int(c.orders) },
                { key: "r", header: "Lifetime spend", align: "right", cell: (c) => money(c.lifetimeSpendCents) },
                { key: "l", header: "Last order", cell: (c) => (c.lastOrderAt ? dateShort(c.lastOrderAt) : <span className="text-subtle">never</span>), hideBelow: "sm" },
                { key: "s", header: "Customer since", cell: (c) => dateShort(c.customerSince), hideBelow: "lg" },
              ]} />
            <Pagination total={members.total} page={page} pageSize={pageSize} basePath="/admin/customers/segments" params={{ segment: active }} />
          </>}
        </Card>
      )}

      {g.can("customers:write") && <Card><CardHeader title="Thresholds" description="Configurable — nothing above is hardcoded." /><CardBody>
        <CrmSettingsForm settings={cfg} />
      </CardBody></Card>}
    </div>
  );
}
