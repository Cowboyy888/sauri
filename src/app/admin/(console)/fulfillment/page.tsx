import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listFulfillmentQueues, type QueueStage } from "@/lib/admin/fulfillment";
import { dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/states";

export const metadata = { title: "Fulfillment" };
export const dynamic = "force-dynamic";

const QUEUES: { stage: QueueStage; title: string; description: string }[] = [
  { stage: "processing", title: "To process", description: "Paid orders waiting to start fulfillment." },
  { stage: "picking", title: "Picking", description: "Items being pulled from inventory." },
  { stage: "packing", title: "Packing", description: "Fully picked, being packed." },
  { stage: "ready_to_ship", title: "Ready to ship", description: "Packed and awaiting a shipping label." },
  { stage: "partially_shipped", title: "Partially shipped", description: "Some packages shipped, some still pending." },
  { stage: "shipped", title: "Shipped", description: "On the way — not yet delivered." },
  { stage: "delivered", title: "Delivered", description: "Arrived — eligible for completion or return." },
];

export default async function FulfillmentDashboard() {
  const g = await guard("inventory:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const queues = await listFulfillmentQueues(getDb());
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Fulfillment" description="Orders move left to right — pick, pack, ship, deliver (brief §3). Oldest orders in each stage need attention first." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {QUEUES.map(({ stage, title, description }) => {
          const q = queues[stage];
          return (
            <Card key={stage}>
              <CardHeader title={<span className="inline-flex items-center gap-2">{title}<span className="rounded-full bg-line-soft px-2 py-0.5 text-xs font-semibold text-muted">{q.count}</span></span>} description={description} />
              {!q.rows.length ? <EmptyState title="Nothing here" className="py-6" /> : (
                <ul className="divide-y divide-line-soft text-[13px]">
                  {q.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/admin/orders/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-canvas">
                        <span className="min-w-0"><span className="font-medium text-accent">{r.orderNumber}</span><span className="block truncate text-xs text-muted">{r.customer} · {r.items} item{r.items === 1 ? "" : "s"}</span></span>
                        <span className="shrink-0 text-xs text-muted">{dateTimeFull(r.paidAt ?? r.placedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {q.count > q.rows.length && <Link href={`/admin/orders?fulfillment=${stage}&sort=date&dir=asc`} className="block border-t border-line-soft px-4 py-2 text-center text-xs font-medium text-accent hover:underline">View all {q.count} →</Link>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
