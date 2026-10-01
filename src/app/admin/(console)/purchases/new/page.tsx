import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { suppliers, productVariants, products } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody } from "@/components/ui/card";
import { PurchaseOrderForm } from "@/components/admin/purchasing-forms";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  const g = await guard("purchasing:write");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const db = getDb();
  const [supplierRows, variantRows] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.status, "ACTIVE")).orderBy(suppliers.name),
    db.select({ id: productVariants.id, sku: productVariants.sku, name: products.name, costPriceCents: productVariants.costPriceCents }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(eq(products.status, "active")).orderBy(products.name),
  ]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="New purchase order" description="Totals are always computed on the server." />
      <Card><CardBody><PurchaseOrderForm mode="create" suppliers={supplierRows} variants={variantRows} /></CardBody></Card>
    </div>
  );
}
