import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getPurchaseOrder, isOverdue } from "@/lib/purchasing/orders";
import { getReceivingContext } from "@/lib/purchasing/receiving";
import { suppliers, productVariants, products } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, dateShort, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  PurchaseOrderForm, PurchaseOrderStatusControl, PurchaseOrderDocumentForm, RemovePurchaseDocumentButton,
  SendPurchaseOrderEmailForm, RecordPaymentForm, ReceivingForm,
} from "@/components/admin/purchasing-forms";

export const metadata = { title: "Purchase order" };
const RECEIVABLE = new Set(["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"]);

export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params, sp = await searchParams, db = getDb();
  const res = await safe("purchase-order", async () => {
    const po = await getPurchaseOrder(db, id);
    if (!po) return null;
    const [supplierRows, variantRows, receiving] = await Promise.all([
      db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers),
      db.select({ id: productVariants.id, sku: productVariants.sku, name: products.name, costPriceCents: productVariants.costPriceCents }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)),
      RECEIVABLE.has(po.po.status) ? getReceivingContext(db, id) : Promise.resolve([]),
    ]);
    return { ...po, supplierRows, variantRows, receiving };
  }, one(sp.fail));
  if (res.ok && !res.data) notFound();

  return (
    <div className="grid grid-cols-1 gap-4">
      {!res.ok ? <ErrorState message="Unable to load this purchase order." /> : !res.data ? null : (
        <>
          <PageHeader title={res.data.po.poNumber} description={`${res.data.supplierName} · ${dateShort(res.data.po.orderDate)}`}
            actions={<div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={res.data.po.status} />
              <StatusBadge status={isOverdue(res.data.po) ? "OVERDUE" : res.data.po.paymentStatus} />
              <Link href={`/api/admin/purchases/${id}/pdf`}><Button>Download PDF</Button></Link>
              {g.can("purchasing:write") && <SendPurchaseOrderEmailForm purchaseOrderId={id} defaultEmail={null} />}
              {g.can("purchasing:write") && <RecordPaymentForm purchaseOrderId={id} />}
            </div>}
          >
            {g.can("purchasing:write") && <PurchaseOrderStatusControl id={id} status={res.data.po.status} />}
          </PageHeader>

          {res.data.po.status === "DRAFT" && g.can("purchasing:write") && (
            <Card><CardHeader title="Edit purchase order" /><CardBody><PurchaseOrderForm mode="edit" po={res.data.po} suppliers={res.data.supplierRows} variants={res.data.variantRows} initialItems={res.data.items.map((i) => ({ variantId: i.variantId, supplierSku: i.supplierSku ?? "", quantity: i.quantity, unitCost: i.unitCostCents / 100, discount: i.discountCents / 100 }))} /></CardBody></Card>
          )}

          {res.data.po.status !== "DRAFT" && (
            <Card>
              <CardHeader title="Items" />
              <DataTable caption="Items" rows={res.data.items} rowKey={(i) => i.id} basePath={`/admin/purchases/${id}`} params={{}}
                empty={<EmptyState title="No items" />}
                columns={[
                  { key: "s", header: "SKU", cell: (i) => <code className="text-xs">{i.sku}</code> },
                  { key: "p", header: "Product", cell: (i) => i.productName },
                  { key: "q", header: "Ordered", align: "right", cell: (i) => int(i.quantity) },
                  { key: "r", header: "Received", align: "right", cell: (i) => int(i.receivedQuantity) },
                  { key: "rem", header: "Remaining", align: "right", cell: (i) => int(i.quantity - i.receivedQuantity) },
                  { key: "c", header: "Unit cost", align: "right", cell: (i) => money(i.unitCostCents), hideBelow: "md" },
                  { key: "t", header: "Line total", align: "right", cell: (i) => money(i.lineTotalCents) },
                ]} />
              <CardBody className="grid grid-cols-1 gap-1 border-t border-line-soft text-right text-[13px]">
                <p>Subtotal: {money(res.data.po.subtotalCents)}</p>
                {res.data.po.discountCents > 0 && <p>Discount: -{money(res.data.po.discountCents)}</p>}
                {res.data.po.shippingCents > 0 && <p>Shipping: {money(res.data.po.shippingCents)}</p>}
                {res.data.po.taxCents > 0 && <p>Tax: {money(res.data.po.taxCents)}</p>}
                <p className="font-semibold">Total: {money(res.data.po.totalCents)}</p>
                <p className="text-muted">Paid: {money(res.data.po.amountPaidCents)}</p>
              </CardBody>
            </Card>
          )}

          {RECEIVABLE.has(res.data.po.status) && g.can("inventory:write") && res.data.receiving.length > 0 && (
            <Card>
              <CardHeader title="Receive goods" description="Only accepted units become sellable stock." />
              <CardBody><ReceivingForm purchaseOrderId={id} items={res.data.receiving.filter((i) => i.remaining > 0).map((i) => ({ purchaseOrderItemId: i.id, sku: i.sku, productName: i.productName, quantity: i.quantity, receivedQuantity: i.receivedQuantity, unitCostCents: i.unitCostCents }))} /></CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Documents" actions={g.can("purchasing:write") && <PurchaseOrderDocumentForm purchaseOrderId={id} />} />
            <DataTable caption="Documents" rows={res.data.documents} rowKey={(d) => d.id} basePath={`/admin/purchases/${id}`} params={{}}
              empty={<EmptyState title="No documents attached" />}
              columns={[
                { key: "f", header: "File", cell: (d) => <a href={d.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.filename}</a> },
                { key: "t", header: "Type", cell: (d) => d.type },
                { key: "d", header: "Added", cell: (d) => dateShort(d.createdAt) },
                { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (d) => g.can("purchasing:write") ? <RemovePurchaseDocumentButton id={d.id} /> : null },
              ]} />
          </Card>

          <Card>
            <CardHeader title="Email history" />
            <DataTable caption="Sends" rows={res.data.sends} rowKey={(s) => s.id} basePath={`/admin/purchases/${id}`} params={{}}
              empty={<EmptyState title="Not sent yet" />}
              columns={[
                { key: "r", header: "Recipient", cell: (s) => s.recipientEmail },
                { key: "s", header: "Status", cell: (s) => (s.succeeded ? <StatusBadge status="SENT" /> : <StatusBadge status="OVERDUE" label="Failed" />) },
                { key: "d", header: "Sent", cell: (s) => dateShort(s.createdAt) },
              ]} />
          </Card>

          <Card>
            <CardHeader title="Payments" />
            <DataTable caption="Payments" rows={res.data.payments} rowKey={(p) => p.id} basePath={`/admin/purchases/${id}`} params={{}}
              empty={<EmptyState title="No payments recorded" />}
              columns={[
                { key: "a", header: "Amount", align: "right", cell: (p) => money(p.amountCents) },
                { key: "d", header: "Date", cell: (p) => dateShort(p.paidAt) },
                { key: "n", header: "Note", cell: (p) => p.note || "—", hideBelow: "md" },
              ]} />
          </Card>
        </>
      )}
    </div>
  );
}
