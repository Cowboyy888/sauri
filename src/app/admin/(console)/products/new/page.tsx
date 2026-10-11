import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { categories, collections, materials } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { NewProductForm } from "@/components/admin/product-forms";

export const metadata = { title: "New product" };
export default async function NewProductPage() {
  const g = await guard("products:write");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const db = getDb();
  const [cats, cols, mats] = await Promise.all([db.select().from(categories).orderBy(asc(categories.position)), db.select().from(collections).orderBy(asc(collections.name)), db.select({ code: materials.code, name: materials.name }).from(materials).orderBy(asc(materials.position))]);
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="New product" description="Create the product and its first variant. Everything is validated on the server." />
      <NewProductForm categories={cats} collections={cols} materials={mats} />
    </div>
  );
}
