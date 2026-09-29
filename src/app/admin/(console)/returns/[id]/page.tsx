import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getReturnDetail } from "@/lib/admin/returns";
import { RETURN_TRANSITIONS } from "@/lib/returns/service";
import { dateTimeFull, money, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/status-badge";
import { InspectionForm, RefundReturnButton, RequestInfoButton, ReturnShippingForm, ReturnStatusActions } from "@/components/admin/return-actions";

export const metadata = { title: "Return" };

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guard("orders:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await getReturnDetail(getDb(), id);
  if (!r) notFound();

  const next = RETURN_TRANSITIONS[r.status as keyof typeof RETURN_TRANSITIONS] ?? [];
  const refundPreviewCents = r.items.reduce((sum, i) => sum + Math.round((i.lineTotalCents / i.orderedQuantity) * i.quantity), 0);
  const allInspected = r.items.every((i) => i.inspection);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/returns" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Returns</Link>
      <PageHeader title={`Return for ${r.order.orderNumber}`} description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={r.status} /><span>Requested {dateTimeFull(r.requestedAt)}</span></span>}
        actions={<Link href={`/admin/orders/${r.order.id}`} className="text-[13px] font-medium text-accent hover:underline">View order →</Link>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Items" description="Reason, description and any customer photos." />
            <div className="grid gap-3 p-4">
              {r.items.map((i) => (
                <div key={i.id} className="grid gap-2 rounded-md border border-line-soft p-3 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{i.quantity}× {i.productName} <span className="font-normal text-muted">{i.variant} · {i.sku}</span></p>
                    <StatusBadge status={i.reason} />
                  </div>
                  {i.description && <p className="text-muted">“{i.description}”</p>}
                  {i.photoUrls.length > 0 && <div className="flex flex-wrap gap-2">{i.photoUrls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Photo</a>)}</div>}
                  {i.exchangeRequested && <p className="text-xs text-accent">Exchange requested</p>}
                  {i.inspection ? (
                    <p className="text-xs text-muted">Inspected {dateTimeFull(i.inspection.inspectedAt)}{i.inspection.inspectedBy ? ` by ${i.inspection.inspectedBy}` : ""} — <StatusBadge status={i.inspection.condition} /> → <StatusBadge status={i.inspection.disposition} />{i.inspection.notes ? ` · ${i.inspection.notes}` : ""}</p>
                  ) : (r.status === "inspecting" || r.status === "received") && g.can("inventory:write") ? (
                    <InspectionForm returnItemId={i.id} productName={i.productName} />
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
          {r.status === "approved_for_refund" && g.can("orders:write") && (
            <Card><CardHeader title="Refund" description={allInspected ? undefined : "Not every item has been inspected yet — the refund can still proceed for the merchandise value on record."} /><CardBody>
              <RefundReturnButton returnRequestId={r.id} amountLabel={money(refundPreviewCents)} />
            </CardBody></Card>
          )}
          {r.refunds.length > 0 && (
            <Card><CardHeader title="Refunds issued" /><CardBody className="grid gap-1 text-[13px]">
              {r.refunds.map((rf, i) => <p key={i}>{money(rf.amountCents)} · {dateTimeFull(rf.at)}</p>)}
            </CardBody></Card>
          )}
          <Card><CardHeader title="Timeline" /><CardBody>
            <ol className="relative grid gap-3 border-l border-line pl-4">{r.events.map((e, i) => (
              <li key={i} className="text-[13px]"><span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full bg-accent" aria-hidden /><p className="font-medium">{titleCase(e.status)}</p><p className="text-xs text-muted">{dateTimeFull(e.at)}{e.user ? ` · ${e.user}` : ""}</p>{e.note && <p className="text-xs text-muted">{e.note}</p>}</li>
            ))}</ol>
          </CardBody></Card>
        </div>
        <div className="grid content-start gap-4">
          {g.can("orders:write") && <Card><CardHeader title="Actions" /><CardBody className="grid gap-2">
            <ReturnStatusActions returnRequestId={r.id} status={r.status} next={next} />
            <RequestInfoButton returnRequestId={r.id} />
          </CardBody></Card>}
          <Card><CardHeader title="Customer" /><CardBody className="grid gap-1 text-[13px]">
            {g.can("customers:read") ? <Link href={`/admin/customers/${r.customer.id}`} className="font-medium text-accent hover:underline">{r.customer.name}</Link> : <p className="font-medium">{r.customer.name}</p>}
            <p className="text-muted">{r.customer.email}</p>
            {r.customerNotes && <p className="mt-2 rounded-md bg-canvas p-2 text-muted">“{r.customerNotes}”</p>}
          </CardBody></Card>
          {g.can("orders:write") && <Card><CardHeader title="Return shipping" description="The customer's tracking for shipping the item back to us." /><CardBody>
            <ReturnShippingForm returnRequestId={r.id} trackingNumber={r.returnTrackingNumber} carrier={r.returnCarrier} />
          </CardBody></Card>}
        </div>
      </div>
    </div>
  );
}
