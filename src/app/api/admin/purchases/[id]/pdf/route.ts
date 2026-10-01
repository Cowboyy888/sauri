import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { getPurchaseOrder } from "@/lib/purchasing/orders";
import { getStoreSettings } from "@/lib/admin/store-settings";
import { buildPurchaseOrderPdf } from "@/lib/purchasing/pdf";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb();
  await requireStaff(db, "purchasing:read");
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Purchase order not found.", code: "NOT_FOUND" }, { status: 404 });
  const po = await getPurchaseOrder(db, id);
  if (!po) return NextResponse.json({ error: "Purchase order not found.", code: "NOT_FOUND" }, { status: 404 });
  const company = await getStoreSettings(db);
  const body = await buildPurchaseOrderPdf({
    poNumber: po.po.poNumber, orderDate: po.po.orderDate, expectedDeliveryDate: po.po.expectedDeliveryDate, paymentTerms: po.po.paymentTerms, notes: po.po.notes,
    supplierName: po.supplierName, supplierAddress: po.supplierAddress, supplierEmail: po.supplierEmail,
    items: po.items.map((i) => ({ sku: i.sku, productName: i.productName, quantity: i.quantity, unitCostCents: i.unitCostCents, lineTotalCents: i.lineTotalCents })),
    subtotalCents: po.po.subtotalCents, discountCents: po.po.discountCents, shippingCents: po.po.shippingCents, taxCents: po.po.taxCents, totalCents: po.po.totalCents,
  }, company);
  return new Response(body as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${po.po.poNumber}.pdf"`, "cache-control": "no-store" } });
});
