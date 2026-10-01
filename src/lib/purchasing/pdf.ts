/**
 * Purchase order PDF (brief §17). Reuses the exact jsPDF + jspdf-autotable stack `lib/admin/reports.ts`
 * already uses for report exports — no new PDF dependency. Company details come from settings
 * (`getStoreSettings`), never hardcoded, per the brief's own instruction.
 */
import { formatMoney } from "../money";
import type { StoreSettings } from "../admin/store-settings";

export type PoPdfInput = {
  poNumber: string; orderDate: Date; expectedDeliveryDate: Date | null; paymentTerms: string | null; notes: string;
  supplierName: string; supplierAddress: string | null; supplierEmail: string | null;
  items: { sku: string; productName: string; quantity: number; unitCostCents: number; lineTotalCents: number }[];
  subtotalCents: number; discountCents: number; shippingCents: number; taxCents: number; totalCents: number;
};

export async function buildPurchaseOrderPdf(po: PoPdfInput, company: StoreSettings): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(company.companyName, 40, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
  let y = 62;
  for (const line of [company.companyAddress, company.companyEmail, company.companyPhone].filter(Boolean)) { doc.text(line!, 40, y); y += 12; }

  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20); doc.text("PURCHASE ORDER", w - 40, 46, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`PO Number: ${po.poNumber}`, w - 40, 64, { align: "right" });
  doc.text(`Date: ${po.orderDate.toISOString().slice(0, 10)}`, w - 40, 76, { align: "right" });
  if (po.expectedDeliveryDate) doc.text(`Expected delivery: ${po.expectedDeliveryDate.toISOString().slice(0, 10)}`, w - 40, 88, { align: "right" });

  let sy = Math.max(y, 100) + 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20); doc.text("Supplier", 40, sy);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80);
  sy += 14; doc.text(po.supplierName, 40, sy);
  if (po.supplierAddress) { sy += 12; doc.text(po.supplierAddress, 40, sy); }
  if (po.supplierEmail) { sy += 12; doc.text(po.supplierEmail, 40, sy); }
  if (po.paymentTerms) { sy += 12; doc.text(`Payment terms: ${po.paymentTerms}`, 40, sy); }

  const body = po.items.map((i) => [i.sku, i.productName, String(i.quantity), formatMoney(i.unitCostCents), formatMoney(i.lineTotalCents)]);
  autoTable(doc, {
    head: [["SKU", "Product", "Qty", "Unit cost", "Line total"]], body, startY: sy + 24, margin: { left: 40, right: 40 },
    styles: { fontSize: 8.5, cellPadding: 4, lineColor: [228, 226, 220], lineWidth: 0.4 }, headStyles: { fillColor: [241, 241, 238], textColor: 40, fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });

  // @ts-expect-error jspdf-autotable augments the doc instance at runtime
  let ty = doc.lastAutoTable.finalY + 20;
  const totalsLine = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 11 : 9.5); doc.setTextColor(bold ? 20 : 80);
    doc.text(label, w - 180, ty); doc.text(value, w - 40, ty, { align: "right" }); ty += bold ? 18 : 14;
  };
  totalsLine("Subtotal", formatMoney(po.subtotalCents));
  if (po.discountCents) totalsLine("Discount", `-${formatMoney(po.discountCents)}`);
  if (po.shippingCents) totalsLine("Shipping", formatMoney(po.shippingCents));
  if (po.taxCents) totalsLine("Tax", formatMoney(po.taxCents));
  totalsLine("Total", formatMoney(po.totalCents), true);

  if (po.notes) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(20); doc.text("Notes", 40, ty + 10);
    doc.setFont("helvetica", "normal"); doc.setTextColor(80); doc.text(doc.splitTextToSize(po.notes, w - 80), 40, ty + 24);
  }

  const sigY = doc.internal.pageSize.getHeight() - 80;
  doc.setDrawColor(200); doc.line(40, sigY, 220, sigY); doc.line(w - 220, sigY, w - 40, sigY);
  doc.setFontSize(8.5); doc.setTextColor(120);
  doc.text("Authorized by", 40, sigY + 12); doc.text("Signature", w - 220, sigY + 12);

  return new Uint8Array(doc.output("arraybuffer"));
}
