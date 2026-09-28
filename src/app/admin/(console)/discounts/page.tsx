import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { listDiscounts } from "@/lib/admin/misc";
import { safe } from "@/lib/admin/safe";
import { dateShort, int, money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { DiscountToggle, NewDiscountButton } from "@/components/admin/owner-forms";

export const metadata = { title: "Discounts" };

export default async function DiscountsPage() {
  const g = await guard("discounts:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const db = getDb();
  const res = await safe("discounts", async () => ({ list: await listDiscounts(db), cats: await db.select().from(categories).orderBy(asc(categories.position)) }));
  const now = Date.now();
  const state = (d: { active: boolean; startsAt: Date; endsAt: Date | null; usageLimit: number | null; usedCount: number }) => !d.active ? "paused" : d.endsAt && d.endsAt.getTime() < now ? "expired" : d.startsAt.getTime() > now ? "scheduled" : d.usageLimit != null && d.usedCount >= d.usageLimit ? "expired" : "active";
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Discounts" description="Codes are validated on the server at checkout." actions={g.can("discounts:write") && res.ok && <NewDiscountButton categories={res.data.cats} />} />
      <Card>{!res.ok ? <ErrorState message="Unable to load discounts." /> :
        <DataTable caption="Discounts" rows={res.data.list} rowKey={(d) => d.id} basePath="/admin/discounts" params={{}} empty={<EmptyState title="No discount codes yet" />}
          columns={[
            { key: "c", header: "Code", cell: (d) => <span className="font-semibold tracking-wide">{d.code}</span> },
            { key: "o", header: "Offer", cell: (d) => d.type === "percent" ? `${d.value}% off` : d.type === "fixed" ? `${money(d.value)} off` : "Free shipping" },
            { key: "s", header: "Applies to", cell: (d) => d.scope, hideBelow: "md" },
            { key: "m", header: "Minimum", align: "right", cell: (d) => (d.minSubtotalCents ? money(d.minSubtotalCents) : "—"), hideBelow: "lg" },
            { key: "x", header: "Cap", align: "right", cell: (d) => (d.maxDiscountCents != null ? money(d.maxDiscountCents) : "—"), hideBelow: "lg" },
            { key: "dt", header: "Dates", cell: (d) => <span className="whitespace-nowrap text-muted">{dateShort(d.startsAt)} → {d.endsAt ? dateShort(d.endsAt) : "no end"}</span>, hideBelow: "md" },
            { key: "u", header: "Used", align: "right", cell: (d) => `${int(d.usedCount)}${d.usageLimit != null ? ` / ${int(d.usageLimit)}` : ""}` },
            { key: "pc", header: "Per customer", align: "right", cell: (d) => d.perCustomerLimit ?? "—", hideBelow: "xl" },
            { key: "st", header: "Status", cell: (d) => <StatusBadge status={state(d)} /> },
            { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (d) => (g.can("discounts:write") ? <DiscountToggle id={d.id} active={d.active} /> : null) },
          ]} />}
      </Card>
    </div>
  );
}
