import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getSupplier } from "@/lib/purchasing/suppliers";
import { productVariants, products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, int, dateShort } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { KPICard } from "@/components/admin/kpi-card";
import { SupplierFormButton, SupplierProductFormButton, RemoveSupplierProductButton } from "@/components/admin/purchasing-forms";

export const metadata = { title: "Supplier" };

export default async function SupplierProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params, sp = await searchParams, db = getDb();
  const res = await safe("supplier", async () => {
    const data = await getSupplier(db, id);
    if (!data) return null;
    const variants = await db.select({ id: productVariants.id, sku: productVariants.sku, name: products.name }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(eq(products.status, "active"));
    return { ...data, variants };
  }, one(sp.fail));
  if (res.ok && !res.data) notFound();

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title={res.ok && res.data ? res.data.supplier.name : "Supplier"} description="Profile, products supplied, and purchase history."
        actions={res.ok && res.data && g.can("purchasing:write") && <SupplierFormButton mode="edit" supplier={res.data.supplier} label="Edit" />} />
      {!res.ok ? <ErrorState message="Unable to load this supplier." /> : !res.data ? null : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Total spend" value={money(res.data.totalSpendCents)} change={null} comparison="" />
            <KPICard label="Purchase orders" value={int(res.data.orderCount)} change={null} comparison="" />
            <KPICard label="Average purchase cost" value={res.data.averagePurchaseCostCents == null ? "—" : money(res.data.averagePurchaseCostCents)} change={null} comparison="" />
            <KPICard label="Last purchase" value={res.data.lastPurchaseAt ? dateShort(res.data.lastPurchaseAt) : "—"} change={null} comparison="" />
          </div>

          <Card>
            <CardHeader title="Contact & terms" />
            <CardBody className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              <p><span className="text-muted">Contact:</span> {res.data.supplier.contactPerson || "—"}</p>
              <p><span className="text-muted">Email:</span> {res.data.supplier.email || "—"}</p>
              <p><span className="text-muted">Phone:</span> {res.data.supplier.phone || "—"}</p>
              <p><span className="text-muted">Payment terms:</span> {res.data.supplier.paymentTerms || "—"}</p>
              <p><span className="text-muted">Lead time:</span> {res.data.supplier.leadTimeDays != null ? `${res.data.supplier.leadTimeDays} days` : "—"}</p>
              <p><span className="text-muted">Minimum order:</span> {res.data.supplier.minimumOrderCents != null ? money(res.data.supplier.minimumOrderCents) : "—"}</p>
              <p className="sm:col-span-2 lg:col-span-3"><span className="text-muted">Notes:</span> {res.data.supplier.notes || "—"}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Products supplied" actions={g.can("purchasing:write") && <SupplierProductFormButton supplierId={id} variants={res.data.variants} />} />
            <DataTable caption="Products supplied" rows={res.data.products} rowKey={(p) => p.id} basePath={`/admin/suppliers/${id}`} params={{}}
              empty={<EmptyState title="No products linked yet" />}
              columns={[
                { key: "p", header: "Product", cell: (p) => <Link href={`/admin/products/${p.productId}`} className="hover:underline">{p.productName}</Link> },
                { key: "s", header: "SKU", cell: (p) => <code className="text-xs">{p.sku}</code> },
                { key: "ss", header: "Supplier SKU", cell: (p) => p.supplierSku || "—", hideBelow: "md" },
                { key: "pr", header: "Price", align: "right", cell: (p) => money(p.purchasePriceCents) },
                { key: "moq", header: "MOQ", align: "right", cell: (p) => p.minimumOrderQuantity ?? "—", hideBelow: "lg" },
                { key: "lt", header: "Lead time", align: "right", cell: (p) => p.leadTimeDays != null ? `${p.leadTimeDays}d` : "—", hideBelow: "lg" },
                { key: "last", header: "Last purchase", cell: (p) => p.lastPurchaseDate ? `${dateShort(p.lastPurchaseDate)} · ${money(p.lastPurchasePriceCents ?? 0)}` : "—", hideBelow: "xl" },
                { key: "pref", header: "Preferred", cell: (p) => (p.preferredSupplier ? <StatusBadge status="ACTIVE" label="Preferred" /> : "—") },
                { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (p) => g.can("purchasing:write") ? <RemoveSupplierProductButton id={p.id} /> : null },
              ]} />
          </Card>

          <Card>
            <CardHeader title="Purchase orders" />
            <DataTable caption="Purchase orders" rows={res.data.purchaseOrders} rowKey={(o) => o.id} basePath={`/admin/suppliers/${id}`} params={{}}
              empty={<EmptyState title="No purchase orders yet" />}
              columns={[
                { key: "n", header: "PO number", cell: (o) => <Link href={`/admin/purchases/${o.id}`} className="font-medium hover:underline">{o.poNumber}</Link> },
                { key: "d", header: "Date", cell: (o) => dateShort(o.orderDate) },
                { key: "st", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
                { key: "p", header: "Payment", cell: (o) => <StatusBadge status={o.paymentStatus} />, hideBelow: "md" },
                { key: "t", header: "Total", align: "right", cell: (o) => money(o.totalCents) },
              ]} />
          </Card>
        </>
      )}
    </div>
  );
}
