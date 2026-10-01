/**
 * Inventory financial valuation (brief §20) — built entirely from the existing Phase 1/8 costing and
 * analytics read models (`getInventory`), never a second inventory query or costing method. Cost value
 * reuses the same weighted-average cost price every other report already reads; see
 * docs/INVENTORY_COSTING.md.
 */
import type { DbOrTx } from "../db/client";
import { getInventory } from "../analytics/service";

export type InventoryFinancialValue = {
  totalUnits: number; inventoryCostValueCents: number; inventoryRetailValueCents: number; potentialGrossProfitCents: number;
  lowStockValueCents: number; outOfStockProducts: number;
  slowMoving: { variantId: string; productName: string; label: string; sku: string; availableStock: number; valueCents: number }[];
};

export async function getInventoryFinancialValue(db: DbOrTx): Promise<InventoryFinancialValue> {
  const inv = await getInventory(db);
  let totalUnits = 0, costValue = 0, retailValue = 0, lowStockValue = 0, outOfStock = 0;
  for (const v of inv) {
    totalUnits += v.availableStock;
    costValue += v.inventoryValueCents;
    retailValue += v.availableStock * v.sellingPriceCents;
    if (v.status === "LOW_STOCK") lowStockValue += v.inventoryValueCents;
    if (v.status === "OUT_OF_STOCK") outOfStock += 1;
  }
  const slowMoving = inv.filter((v) => v.availableStock > 0 && v.sold30 === 0).sort((a, b) => b.inventoryValueCents - a.inventoryValueCents).slice(0, 20)
    .map((v) => ({ variantId: v.variantId, productName: v.productName, label: v.label, sku: v.sku, availableStock: v.availableStock, valueCents: v.inventoryValueCents }));
  return { totalUnits, inventoryCostValueCents: costValue, inventoryRetailValueCents: retailValue, potentialGrossProfitCents: retailValue - costValue, lowStockValueCents: lowStockValue, outOfStockProducts: outOfStock, slowMoving };
}
