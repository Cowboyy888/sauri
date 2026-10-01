"use server";
/**
 * Server actions for the admin. Every action:
 *   1. resolves the caller and checks the permission on the server (requireStaff),
 *   2. validates input with zod,
 *   3. calls the Phase 1 / Phase 2 service (which checks the permission again and writes the audit log),
 *   4. revalidates the admin so every page, including the dashboard, shows the new numbers.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { DEV_COOKIE, devAuthEnabled, requireStaff, supabaseConfigured } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import { BusinessError } from "@/lib/errors";
import { adjustStock, restock, setReorderLevel } from "@/lib/inventory/service";
import { updateOrderStatus } from "@/lib/orders/service";
import { addOrderNote, setTracking } from "@/lib/orders/fulfillment";
import { refundOrder } from "@/lib/orders/refunds";
import { advanceFulfillmentStage, createPackage, setPickStatus, setPackageStatus, markCompleted } from "@/lib/fulfillment/service";
import { updateReturnStatus, recordInspection, refundReturn, requestReturnInfo, setReturnShipping, setReturnPolicy } from "@/lib/returns/service";
import { createShippingMethod, updateShippingMethod, setShippingMethodActive } from "@/lib/admin/shipping-methods";
import { createDiscount, setDiscountActive } from "@/lib/discounts/service";
import { addProductImage, addStaff, addVariant, createProduct, deleteProduct, duplicateProduct, removeProductImage, setProductArchived, updateContent, updateProduct, updateStaff, updateVariant } from "@/lib/catalog/service";
import { moderateReview } from "@/lib/reviews/service";
import {
  addNote, anonymizeCustomer, assignTag, createTag, logCommunication, mergeCustomers, unassignTag,
} from "@/lib/crm/customer-management";
import { setCrmSettings } from "@/lib/crm/segments";
import { adjustPoints, saveReward, saveTier, setLoyaltySettings } from "@/lib/loyalty/service";
import { createCampaign, logCampaignCost, setCampaignStatus, updateCampaign } from "@/lib/marketing/campaigns";
import { createPromotion, deletePromotion, setPromotionActive, updatePromotion } from "@/lib/marketing/promotions";
import { createEmailCampaign, cancelEmailCampaign, scheduleEmailCampaign, sendEmailCampaignNow } from "@/lib/marketing/email-campaigns";
import { sendAbandonedCartRecoveryNow } from "@/lib/marketing/abandoned-carts";
import { setMarketingSettings } from "@/lib/marketing/settings";
import { createSupplier, updateSupplier, setSupplierStatus, upsertSupplierProduct, removeSupplierProduct } from "@/lib/purchasing/suppliers";
import { createPurchaseOrder, updatePurchaseOrder, setPurchaseOrderStatus, addPurchaseDocument, removePurchaseDocument, sendPurchaseOrderEmail, recordPurchasePayment, type PurchaseOrderItemInput } from "@/lib/purchasing/orders";
import { receivePurchaseOrder, type ReceiveLine } from "@/lib/purchasing/receiving";
import { startStocktake, recordCount, completeStocktake, cancelStocktake, setStocktakeSettings } from "@/lib/purchasing/stocktake";
import { bulkSetProductStatus, bulkSetCategory, bulkSetCollection, bulkSetReorderLevel } from "@/lib/catalog/service";
import { applyProductImport, validateImport, type ImportPreview } from "@/lib/catalog/import";
import { setStoreSettings } from "@/lib/admin/store-settings";
import { setTargetStockLevel } from "@/lib/admin/purchasing";
import { createExpenseCategory, setExpenseCategoryActive } from "@/lib/finance/expense-categories";
import { createExpense, updateExpense, submitExpense, approveExpense, rejectExpense, markExpensePaid, cancelExpense, deleteExpense } from "@/lib/finance/expenses";
import { setTaxSettings } from "@/lib/finance/tax";
import { runStripeReconciliation, recordManualReconciliation, markReconciliationReviewed } from "@/lib/finance/reconciliation";
import { saveReportSnapshot, deleteReportSnapshot } from "@/lib/finance/snapshots";
import type { ReportKey } from "@/lib/admin/reports";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

async function act<T>(permission: Permission, fn: (actor: Awaited<ReturnType<typeof requireStaff>>) => Promise<T | void>, message?: string): Promise<ActionResult<T>> {
  try {
    const actor = await requireStaff(getDb(), permission);
    const data = await fn(actor);
    revalidatePath("/admin", "layout");
    return { ok: true, message, data: data ?? undefined };
  } catch (e) {
    if (e instanceof BusinessError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was changed." };
  }
}

const dollars = (label: string) => z.coerce.number({ message: `${label} must be a number.` }).min(0, `${label} can't be negative.`).max(1_000_000).transform((d) => Math.round(d * 100));
const optDollars = (label: string) => z.union([z.literal("").transform(() => null), dollars(label)]).optional().transform((v) => v ?? null);
const uuid = z.string().uuid("Invalid id.");

/* ---------------- inventory ---------------- */
const Restock = z.object({ variantId: uuid, quantity: z.coerce.number().int("Whole units only.").min(1, "Enter a quantity of at least 1.").max(100_000), unitCost: optDollars("Unit cost"), supplierName: z.string().trim().max(120).optional(), reference: z.string().trim().max(60).optional(), notes: z.string().trim().max(500).optional() });
export async function restockAction(input: z.input<typeof Restock>) {
  return act("inventory:write", async (actor) => {
    const v = Restock.parse(input);
    const r = await restock(getDb(), actor, { variantId: v.variantId, quantity: v.quantity, unitCostCents: v.unitCost ?? undefined, supplierName: v.supplierName || undefined, reference: v.reference || undefined, notes: v.notes || undefined });
    return r;
  }, "Stock updated");
}
const Adjust = z.object({ variantId: uuid, newStockQuantity: z.coerce.number().int().min(0, "Stock can't be negative."), movementType: z.enum(["ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "MANUAL"]), notes: z.string().trim().max(500).optional(), reorderLevel: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional() });
export async function adjustStockAction(input: z.input<typeof Adjust>) {
  return act("inventory:write", async (actor) => {
    const v = Adjust.parse(input);
    const db = getDb();
    const r = await adjustStock(db, actor, { variantId: v.variantId, newStockQuantity: v.newStockQuantity, movementType: v.movementType, notes: v.notes || undefined });
    if (v.reorderLevel !== undefined && v.reorderLevel !== "") await setReorderLevel(db, actor, v.variantId, v.reorderLevel);
    return r;
  }, "Stock adjusted");
}

/* ---------------- orders ---------------- */
const Status = z.object({ orderId: uuid, status: z.enum(["processing", "shipped", "delivered", "cancelled", "refunded"]), reason: z.string().trim().max(500).optional(), restock: z.boolean().optional() });
export async function updateOrderStatusAction(input: z.input<typeof Status>) {
  return act("orders:write", async (actor) => { const v = Status.parse(input); await updateOrderStatus(getDb(), actor, v.orderId, v.status, { reason: v.reason || undefined, restock: v.restock }); }, "Order updated");
}
const Tracking = z.object({ orderId: uuid, trackingNumber: z.string().trim().min(1, "Enter a tracking number.").max(80), carrier: z.string().trim().max(60).optional() });
export async function setTrackingAction(input: z.input<typeof Tracking>) {
  return act("orders:write", async (actor) => { const v = Tracking.parse(input); await setTracking(getDb(), actor, v.orderId, v); }, "Tracking added");
}
const Note = z.object({ orderId: uuid, note: z.string().trim().min(1, "Enter a note.").max(2000) });
export async function addOrderNoteAction(input: z.input<typeof Note>) {
  return act("orders:write", async (actor) => { const v = Note.parse(input); await addOrderNote(getDb(), actor, v.orderId, v.note); }, "Note added");
}
const Refund = z.object({ orderId: uuid, amount: dollars("Refund amount"), reason: z.string().trim().max(500).optional() });
export async function refundOrderAction(input: z.input<typeof Refund>) {
  return act("orders:write", async (actor) => {
    const v = Refund.parse(input);
    return refundOrder(getDb(), actor, v.orderId, { amountCents: v.amount, reason: v.reason || undefined });
  }, "Refund processed");
}

/* ---------------- fulfillment (Phase 5) ---------------- */
const Stage = z.object({ orderId: uuid, next: z.enum(["processing", "picking", "packing", "ready_to_ship"]), notes: z.string().trim().max(500).optional() });
export async function advanceFulfillmentStageAction(input: z.input<typeof Stage>) {
  return act("inventory:write", async (actor) => { const v = Stage.parse(input); await advanceFulfillmentStage(getDb(), actor, v.orderId, v.next, v.notes || undefined); }, "Stage updated");
}
const Pick = z.object({ orderItemId: uuid, status: z.enum(["picked", "missing", "damaged"]), pickedQuantity: z.coerce.number().int().min(0).optional() });
export async function setPickStatusAction(input: z.input<typeof Pick>) {
  return act("inventory:write", async (actor) => { const v = Pick.parse(input); await setPickStatus(getDb(), actor, v.orderItemId, v.status, v.pickedQuantity); }, "Pick status updated");
}
const NewPackage = z.object({
  orderId: uuid, items: z.array(z.object({ orderItemId: uuid, quantity: z.coerce.number().int().min(1) })).min(1, "Add at least one item."),
  weightGrams: z.coerce.number().min(0).optional(), lengthMm: z.coerce.number().min(0).optional(), widthMm: z.coerce.number().min(0).optional(), heightMm: z.coerce.number().min(0).optional(),
  carrier: z.string().trim().max(60).optional(), service: z.string().trim().max(60).optional(), trackingNumber: z.string().trim().max(80).optional(), trackingUrl: z.string().trim().max(500).optional(), labelUrl: z.string().trim().max(500).optional(),
});
export async function createPackageAction(input: z.input<typeof NewPackage>) {
  return act("inventory:write", async (actor) => {
    const v = NewPackage.parse(input);
    const p = await createPackage(getDb(), actor, v.orderId, v);
    return { id: p.id };
  }, "Package created");
}
const PkgStatus = z.object({ packageId: uuid, status: z.enum(["label_created", "ready_to_ship", "shipped", "in_transit", "out_for_delivery", "delivered", "delivery_failed", "return_to_sender"]), note: z.string().trim().max(500).optional() });
export async function setPackageStatusAction(input: z.input<typeof PkgStatus>) {
  return act("inventory:write", async (actor) => { const v = PkgStatus.parse(input); await setPackageStatus(getDb(), actor, v.packageId, v.status, v.note || undefined); }, "Package status updated");
}
export async function markOrderCompletedAction(orderId: string) {
  return act("orders:write", async (actor) => { await markCompleted(getDb(), actor, uuid.parse(orderId)); }, "Order marked completed");
}

/* ---------------- returns (Phase 5) ---------------- */
const ReturnStatus = z.object({ returnRequestId: uuid, next: z.enum(["under_review", "approved", "rejected", "return_shipped", "received", "inspecting", "approved_for_refund", "closed"]), note: z.string().trim().max(500).optional() });
export async function updateReturnStatusAction(input: z.input<typeof ReturnStatus>) {
  return act("orders:write", async (actor) => { const v = ReturnStatus.parse(input); await updateReturnStatus(getDb(), actor, v.returnRequestId, v.next, v.note || undefined); }, "Return updated");
}
const ReturnInfo = z.object({ returnRequestId: uuid, note: z.string().trim().min(1, "Enter what's needed.").max(1000) });
export async function requestReturnInfoAction(input: z.input<typeof ReturnInfo>) {
  return act("orders:write", async (actor) => { const v = ReturnInfo.parse(input); await requestReturnInfo(getDb(), actor, v.returnRequestId, v.note); }, "Requested more information");
}
const ReturnShip = z.object({ returnRequestId: uuid, trackingNumber: z.string().trim().max(80).optional(), carrier: z.string().trim().max(60).optional() });
export async function setReturnShippingAction(input: z.input<typeof ReturnShip>) {
  return act("orders:write", async (actor) => { const v = ReturnShip.parse(input); await setReturnShipping(getDb(), actor, v.returnRequestId, v); }, "Return tracking saved");
}
const Inspection = z.object({ returnItemId: uuid, condition: z.enum(["new", "like_new", "used", "damaged", "defective", "unsellable"]), disposition: z.enum(["restock", "repair", "damaged", "dispose", "return_to_customer"]), notes: z.string().trim().max(500).optional() });
export async function recordInspectionAction(input: z.input<typeof Inspection>) {
  return act("inventory:write", async (actor) => { const v = Inspection.parse(input); await recordInspection(getDb(), actor, v.returnItemId, v); }, "Inspection recorded");
}
export async function refundReturnAction(returnRequestId: string) {
  return act("orders:write", async (actor) => { await refundReturn(getDb(), actor, uuid.parse(returnRequestId)); }, "Refund processed");
}

/* ---------------- settings: shipping methods & return policy (Phase 5) ---------------- */
const ShipMethod = z.object({
  id: uuid.optional(), name: z.string().trim().min(1, "Enter a name.").max(80), description: z.string().trim().max(300).optional(),
  price: dollars("Price"), estimatedMinDays: z.coerce.number().int().min(0).max(90), estimatedMaxDays: z.coerce.number().int().min(0).max(90),
  waivableAboveThreshold: z.boolean().optional(), carrierCost: optDollars("Carrier cost"),
  countryCode: z.string().trim().max(2).optional(), region: z.string().trim().max(60).optional(), minOrder: optDollars("Minimum order"), maxOrder: optDollars("Maximum order"), active: z.boolean().optional(),
});
export async function saveShippingMethodAction(input: z.input<typeof ShipMethod>) {
  return act("settings:write", async (actor) => {
    const v = ShipMethod.parse(input);
    const payload = { name: v.name, description: v.description, priceCents: v.price, estimatedMinDays: v.estimatedMinDays, estimatedMaxDays: v.estimatedMaxDays, waivableAboveThreshold: v.waivableAboveThreshold, carrierCostCents: v.carrierCost ?? undefined, countryCode: v.countryCode?.toUpperCase() || null, region: v.region || null, minOrderCents: v.minOrder, maxOrderCents: v.maxOrder, active: v.active };
    if (v.id) await updateShippingMethod(getDb(), actor, v.id, payload); else await createShippingMethod(getDb(), actor, payload);
  }, "Shipping method saved");
}
export async function toggleShippingMethodAction(id: string, active: boolean) {
  return act("settings:write", async (actor) => { await setShippingMethodActive(getDb(), actor, uuid.parse(id), active); }, active ? "Method activated" : "Method deactivated");
}
const ReturnPolicy = z.object({
  returnWindowDays: z.coerce.number().int().min(0).max(365), exchangeEnabled: z.boolean(), refundEnabled: z.boolean(),
  returnShippingPolicy: z.enum(["customer", "company", "free"]), finalSaleTags: z.string().optional(), eligibleCategorySlugs: z.string().optional(),
});
export async function setReturnPolicyAction(input: z.input<typeof ReturnPolicy>) {
  return act("settings:write", async (actor) => {
    const v = ReturnPolicy.parse(input);
    await setReturnPolicy(getDb(), actor, {
      returnWindowDays: v.returnWindowDays, exchangeEnabled: v.exchangeEnabled, refundEnabled: v.refundEnabled, returnShippingPolicy: v.returnShippingPolicy,
      finalSaleTags: (v.finalSaleTags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      eligibleCategorySlugs: v.eligibleCategorySlugs?.trim() ? v.eligibleCategorySlugs.split(",").map((t) => t.trim()).filter(Boolean) : null,
    });
  }, "Return policy saved");
}

/* ---------------- CRM: tags, notes, communications (Phase 6) ---------------- */
const NewTag = z.object({ name: z.string().trim().min(1, "Enter a tag name.").max(40), color: z.string().trim().max(20).optional() });
export async function createTagAction(input: z.input<typeof NewTag>) {
  return act("customers:write", async (actor) => { const v = NewTag.parse(input); await createTag(getDb(), actor, v.name, v.color); }, "Tag created");
}
export async function assignTagAction(customerId: string, tagId: string) {
  return act("customers:write", async (actor) => { await assignTag(getDb(), actor, uuid.parse(customerId), uuid.parse(tagId)); }, "Tag added");
}
export async function unassignTagAction(customerId: string, tagId: string) {
  return act("customers:write", async (actor) => { await unassignTag(getDb(), actor, uuid.parse(customerId), uuid.parse(tagId)); }, "Tag removed");
}
const NewNote = z.object({ customerId: uuid, note: z.string().trim().min(1, "Enter a note.").max(2000) });
export async function addCustomerNoteAction(input: z.input<typeof NewNote>) {
  return act("customers:write", async (actor) => { const v = NewNote.parse(input); await addNote(getDb(), actor, v.customerId, v.note); }, "Note added");
}
const NewComm = z.object({ customerId: uuid, type: z.enum(["email", "sms", "call", "whatsapp", "telegram", "note"]), subject: z.string().trim().max(200).optional(), message: z.string().trim().min(1, "Enter a message.").max(4000) });
export async function logCommunicationAction(input: z.input<typeof NewComm>) {
  return act("customers:write", async (actor) => { const v = NewComm.parse(input); await logCommunication(getDb(), actor, v.customerId, v); }, "Logged");
}
const Merge = z.object({ survivorId: uuid, loserId: uuid });
export async function mergeCustomersAction(input: z.input<typeof Merge>) {
  return act("customers:write", async (actor) => { const v = Merge.parse(input); await mergeCustomers(getDb(), actor, v.survivorId, v.loserId); }, "Customers merged");
}
export async function anonymizeCustomerAction(customerId: string) {
  return act("customers:write", async (actor) => { await anonymizeCustomer(getDb(), actor, uuid.parse(customerId)); }, "Customer anonymized");
}
const CrmSettings = z.object({
  newCustomerDays: z.coerce.number().int().min(0), inactiveDays: z.coerce.number().int().min(0), highValueThresholdCents: z.coerce.number().int().min(0),
  recentPurchaserDays: z.coerce.number().int().min(0), frequentBuyerDays: z.coerce.number().int().min(0), frequentBuyerMinOrders: z.coerce.number().int().min(1),
  recencyRecentMaxDays: z.coerce.number().int().min(0), recencyAtRiskMinDays: z.coerce.number().int().min(0), recencyInactiveMinDays: z.coerce.number().int().min(0),
  frequencyFrequentMinOrders: z.coerce.number().int().min(1), monetaryHighValueCents: z.coerce.number().int().min(0),
});
export async function setCrmSettingsAction(input: z.input<typeof CrmSettings>) {
  return act("customers:write", async (actor) => {
    const v = CrmSettings.parse(input);
    await setCrmSettings(getDb(), actor, {
      newCustomerDays: v.newCustomerDays, inactiveDays: v.inactiveDays, highValueThresholdCents: v.highValueThresholdCents, recentPurchaserDays: v.recentPurchaserDays,
      frequentBuyerDays: v.frequentBuyerDays, frequentBuyerMinOrders: v.frequentBuyerMinOrders,
      rfm: { recencyRecentMaxDays: v.recencyRecentMaxDays, recencyAtRiskMinDays: v.recencyAtRiskMinDays, recencyInactiveMinDays: v.recencyInactiveMinDays, frequencyFrequentMinOrders: v.frequencyFrequentMinOrders, monetaryHighValueCents: v.monetaryHighValueCents },
    });
  }, "CRM settings saved");
}

/* ---------------- loyalty (Phase 6) ---------------- */
const AdjustPoints = z.object({ customerId: uuid, points: z.coerce.number().int(), reason: z.string().trim().min(1, "Enter a reason.").max(500) });
export async function adjustPointsAction(input: z.input<typeof AdjustPoints>) {
  return act("loyalty:write", async (actor) => { const v = AdjustPoints.parse(input); await adjustPoints(getDb(), actor, v.customerId, v.points, v.reason); }, "Points adjusted");
}
const TierInput = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(60), minSpend: dollars("Minimum spend"), bonusPointsMultiplier: z.coerce.number().min(1).max(10).optional(), earlyAccess: z.boolean().optional(), freeShipping: z.boolean().optional(), active: z.boolean().optional() });
export async function saveTierAction(input: z.input<typeof TierInput>) {
  return act("loyalty:write", async (actor) => {
    const v = TierInput.parse(input);
    await saveTier(getDb(), actor, v.id, { name: v.name, minSpendCents: v.minSpend, benefits: { bonusPointsMultiplier: v.bonusPointsMultiplier, earlyAccess: v.earlyAccess, freeShipping: v.freeShipping }, active: v.active });
  }, "Tier saved");
}
const RewardInput = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(80), description: z.string().trim().max(300).optional(), pointsCost: z.coerce.number().int().min(1), rewardType: z.enum(["percent", "fixed", "free_shipping"]), rewardValue: z.coerce.number().min(0), active: z.boolean().optional() });
export async function saveRewardAction(input: z.input<typeof RewardInput>) {
  return act("loyalty:write", async (actor) => {
    const v = RewardInput.parse(input);
    const rewardValue = v.rewardType === "fixed" ? Math.round(v.rewardValue * 100) : Math.round(v.rewardValue);
    await saveReward(getDb(), actor, v.id, { name: v.name, description: v.description, pointsCost: v.pointsCost, rewardType: v.rewardType, rewardValue });
  }, "Reward saved");
}
const LoyaltySettings = z.object({ enabled: z.boolean(), pointsPerDollar: z.coerce.number().min(0).max(1000) });
export async function setLoyaltySettingsAction(input: z.input<typeof LoyaltySettings>) {
  return act("loyalty:write", async (actor) => { const v = LoyaltySettings.parse(input); await setLoyaltySettings(getDb(), actor, v); }, "Loyalty settings saved");
}

/* ---------------- products ---------------- */
const csv = z.string().optional().transform((s) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30));
const NewProduct = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(120), slug: z.string().trim().max(80).optional(), shortDescription: z.string().trim().max(200).optional(), description: z.string().trim().max(5000).optional(),
  categoryId: uuid, collectionId: z.union([z.literal(""), uuid]).optional(), status: z.enum(["draft", "active", "archived"]),
  featured: z.boolean().optional(), bestSeller: z.boolean().optional(), newArrival: z.boolean().optional(),
  material: z.enum(["yg", "wg", "vm", "ss"]), color: z.string().trim().max(40).optional(), size: z.string().trim().max(20).optional(), gemstone: z.string().trim().max(40).optional(), style: z.string().trim().max(40).optional(),
  sku: z.string().trim().min(3, "Enter a SKU.").max(40), barcode: z.string().trim().max(40).optional(),
  costPrice: dollars("Cost price"), sellingPrice: dollars("Selling price"), compareAtPrice: optDollars("Compare-at price"),
  weightGrams: z.union([z.literal(""), z.coerce.number().min(0).max(10_000)]).optional(), reorderLevel: z.coerce.number().int().min(0).max(10_000).optional(),
  seoTitle: z.string().trim().max(70).optional(), seoDescription: z.string().trim().max(160).optional(), canonicalUrl: z.string().trim().max(300).optional(), brand: z.string().trim().max(80).optional(), careInstructions: z.string().trim().max(1000).optional(),
  tags: csv, imageUrls: z.string().optional().transform((s) => (s ?? "").split(/\s+/).map((x) => x.trim()).filter(Boolean).slice(0, 12)),
});
export async function createProductAction(input: z.input<typeof NewProduct>) {
  const res = await act("products:write", async (actor) => {
    const v = NewProduct.parse(input);
    const p = await createProduct(getDb(), actor, { ...v, collectionId: v.collectionId || null, costPriceCents: v.costPrice, sellingPriceCents: v.sellingPrice, compareAtPriceCents: v.compareAtPrice, weightMg: v.weightGrams === "" || v.weightGrams == null ? 0 : Math.round(v.weightGrams * 1000) });
    return { id: p.id };
  }, "Product created");
  return res;
}
const Patch = z.object({
  id: uuid, name: z.string().trim().min(1).max(120).optional(), slug: z.string().trim().max(80).optional(), shortDescription: z.string().trim().max(200).optional(), description: z.string().trim().max(5000).optional(),
  categoryId: uuid.optional(), collectionId: z.union([z.literal(""), uuid]).optional(), status: z.enum(["draft", "active", "archived"]).optional(),
  featured: z.boolean().optional(), bestSeller: z.boolean().optional(), newArrival: z.boolean().optional(),
  seoTitle: z.string().trim().max(70).optional(), seoDescription: z.string().trim().max(160).optional(), canonicalUrl: z.string().trim().max(300).optional(), brand: z.string().trim().max(80).optional(), careInstructions: z.string().trim().max(1000).optional(), tags: z.string().optional(),
});
export async function updateProductAction(input: z.input<typeof Patch>) {
  return act("products:write", async (actor) => {
    const { id, tags, ...v } = Patch.parse(input);
    await updateProduct(getDb(), actor, id, { ...v, ...(tags !== undefined ? { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } : {}) });
  }, "Product saved");
}
const VPatch = z.object({ variantId: uuid, sellingPrice: dollars("Selling price").optional(), costPrice: dollars("Cost price").optional(), compareAtPrice: optDollars("Compare-at price"), barcode: z.string().trim().max(40).optional(), status: z.enum(["active", "inactive"]).optional() });
export async function updateVariantAction(input: z.input<typeof VPatch>) {
  return act("products:write", async (actor) => {
    const v = VPatch.parse(input);
    await updateVariant(getDb(), actor, v.variantId, { sellingPriceCents: v.sellingPrice, costPriceCents: v.costPrice, compareAtPriceCents: v.compareAtPrice, barcode: v.barcode === undefined ? undefined : v.barcode || null, status: v.status });
  }, "Variant saved");
}
const NewVariant = z.object({ productId: uuid, sku: z.string().trim().min(3).max(40), material: z.enum(["yg", "wg", "vm", "ss"]), size: z.string().trim().max(20).optional(), color: z.string().trim().max(40).optional(), gemstone: z.string().trim().max(40).optional(), style: z.string().trim().max(40).optional(), barcode: z.string().trim().max(40).optional(), sellingPrice: dollars("Selling price"), costPrice: dollars("Cost price"), compareAtPrice: optDollars("Compare-at price"), reorderLevel: z.coerce.number().int().min(0).optional() });
export async function addVariantAction(input: z.input<typeof NewVariant>) {
  return act("products:write", async (actor) => { const v = NewVariant.parse(input); await addVariant(getDb(), actor, v.productId, { ...v, sellingPriceCents: v.sellingPrice, costPriceCents: v.costPrice, compareAtPriceCents: v.compareAtPrice }); }, "Variant added. Restock it to start selling.");
}
export async function duplicateProductAction(id: string) { return act("products:write", async (actor) => ({ id: (await duplicateProduct(getDb(), actor, uuid.parse(id))).id }), "Draft copy created"); }
export async function archiveProductAction(id: string, archived: boolean) { return act("products:write", async (actor) => { await setProductArchived(getDb(), actor, uuid.parse(id), archived); }, archived ? "Product archived" : "Product restored"); }
export async function deleteProductAction(id: string) { return act("products:write", async (actor) => { await deleteProduct(getDb(), actor, uuid.parse(id)); }, "Product deleted"); }
export async function addImageAction(productId: string, url: string, alt: string) { return act("products:write", async (actor) => { await addProductImage(getDb(), actor, uuid.parse(productId), z.string().max(500).parse(url), z.string().max(200).parse(alt)); }, "Image added"); }
export async function removeImageAction(imageId: string) { return act("products:write", async (actor) => { await removeProductImage(getDb(), actor, uuid.parse(imageId)); }, "Image removed"); }

/* ---------------- reviews, content, discounts, staff ---------------- */
const ReviewLabel: Record<string, string> = { published: "Review published", rejected: "Review rejected", hidden: "Review hidden" };
export async function setReviewStatusAction(id: string, status: "published" | "rejected" | "hidden", note?: string) {
  const next = z.enum(["published", "rejected", "hidden"]).parse(status);
  return act("reviews:write", async (actor) => { await moderateReview(getDb(), actor, uuid.parse(id), next, note); }, ReviewLabel[next]);
}
const Content = z.object({ announce: z.string().max(120), heroTitle: z.string().max(60), heroLede: z.string().max(300) });
export async function updateContentAction(input: z.input<typeof Content>) { return act("content:write", async (actor) => { await updateContent(getDb(), actor, Content.parse(input)); }, "Content published"); }
const Disc = z.object({ code: z.string().trim().min(3).max(20), type: z.enum(["percent", "fixed", "free_shipping"]), value: z.coerce.number().min(0).max(100_000), categoryId: z.union([z.literal(""), uuid]).optional(), minSubtotal: optDollars("Minimum order"), maxDiscount: optDollars("Maximum discount"), startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(), usageLimit: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional(), perCustomerLimit: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional() });
export async function createDiscountAction(input: z.input<typeof Disc>) {
  return act("discounts:write", async (actor) => {
    const v = Disc.parse(input);
    await createDiscount(getDb(), actor, {
      code: v.code, type: v.type, value: v.type === "fixed" ? Math.round(v.value * 100) : Math.round(v.value), categoryId: v.categoryId || null,
      minSubtotalCents: v.minSubtotal ?? 0, maxDiscountCents: v.maxDiscount, startsAt: new Date(`${v.startsAt}T00:00:00`), endsAt: v.endsAt ? new Date(`${v.endsAt}T23:59:59`) : null,
      usageLimit: v.usageLimit === "" || v.usageLimit == null ? null : v.usageLimit, perCustomerLimit: v.perCustomerLimit === "" || v.perCustomerLimit == null ? null : v.perCustomerLimit, active: true,
    });
  }, "Discount created");
}
export async function toggleDiscountAction(id: string, active: boolean) { return act("discounts:write", async (actor) => { await setDiscountActive(getDb(), actor, uuid.parse(id), active); }, active ? "Discount activated" : "Discount paused"); }
const Role = z.enum(["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"]);
export async function updateStaffAction(userId: string, patch: { role?: string; active?: boolean }) { return act("staff:write", async (actor) => { await updateStaff(getDb(), actor, uuid.parse(userId), { role: patch.role ? Role.parse(patch.role) : undefined, active: patch.active }); }, "Staff updated"); }
export async function addStaffAction(input: { email: string; name: string; role: string }) { return act("staff:write", async (actor) => { await addStaff(getDb(), actor, { email: z.string().email("Enter a valid email.").parse(input.email), name: z.string().max(80).parse(input.name), role: Role.parse(input.role) }); }, "Staff member added. They can sign in with this email."); }

/* ---------------- marketing: campaigns (Phase 7) ---------------- */
const NewCampaign = z.object({
  name: z.string().trim().min(1, "Enter a campaign name.").max(120), slug: z.string().trim().min(2, "Enter a campaign ID.").max(40),
  source: z.string().trim().min(1, "Enter a source.").max(60), medium: z.string().trim().min(1, "Enter a medium.").max(60),
  budget: optDollars("Budget"), description: z.string().trim().max(1000).optional(),
  startDate: z.union([z.literal(""), z.coerce.date()]).optional(), endDate: z.union([z.literal(""), z.coerce.date()]).optional(),
});
export async function createCampaignAction(input: z.input<typeof NewCampaign>) {
  return act("marketing:write", async (actor) => {
    const v = NewCampaign.parse(input);
    await createCampaign(getDb(), actor, { name: v.name, slug: v.slug, source: v.source, medium: v.medium, budgetCents: v.budget, description: v.description, startDate: v.startDate || null, endDate: v.endDate || null });
  }, "Campaign created");
}
export async function updateCampaignAction(id: string, input: z.input<typeof NewCampaign>) {
  return act("marketing:write", async (actor) => {
    const v = NewCampaign.parse(input);
    await updateCampaign(getDb(), actor, uuid.parse(id), { name: v.name, source: v.source, medium: v.medium, budgetCents: v.budget, description: v.description, startDate: v.startDate || null, endDate: v.endDate || null });
  }, "Campaign updated");
}
export async function setCampaignStatusAction(id: string, status: string) {
  return act("marketing:write", async (actor) => { await setCampaignStatus(getDb(), actor, uuid.parse(id), z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]).parse(status)); }, "Campaign status updated");
}
const NewCost = z.object({ campaignId: uuid, amount: dollars("Amount"), incurredAt: z.union([z.literal(""), z.coerce.date()]).optional(), note: z.string().trim().max(300).optional() });
export async function logCampaignCostAction(input: z.input<typeof NewCost>) {
  return act("marketing:write", async (actor) => {
    const v = NewCost.parse(input);
    await logCampaignCost(getDb(), actor, { campaignId: v.campaignId, amountCents: v.amount, incurredAt: v.incurredAt || undefined, note: v.note });
  }, "Spend logged");
}

/* ---------------- marketing: promotions & coupons (Phase 7) ---------------- */
const csvIds = z.string().optional().transform((s) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200));
const PromotionInputSchema = z.object({
  id: uuid.optional(), name: z.string().trim().max(120).optional(), code: z.string().trim().min(3).max(20),
  type: z.enum(["percent", "fixed", "free_shipping"]), value: z.coerce.number().min(0).max(1_000_000).optional(),
  eligibleProductIds: csvIds, excludedProductIds: csvIds, eligibleCollectionIds: csvIds, excludedCollectionIds: csvIds,
  eligibleSegments: z.array(z.string()).optional(), firstOrderOnly: z.boolean().optional(),
  minSubtotal: optDollars("Minimum order"), maxDiscount: optDollars("Maximum discount"),
  startsAt: z.union([z.literal(""), z.coerce.date()]).optional(), endsAt: z.union([z.literal(""), z.coerce.date()]).optional(),
  usageLimit: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional(), perCustomerLimit: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional(),
  campaignId: z.union([z.literal(""), uuid]).optional(),
});
export async function savePromotionAction(input: z.input<typeof PromotionInputSchema>) {
  return act("marketing:write", async (actor) => {
    const v = PromotionInputSchema.parse(input);
    const payload = {
      name: v.name, type: v.type, value: v.type === "percent" ? v.value : v.type === "fixed" ? Math.round((v.value ?? 0) * 100) : 0,
      eligibleProductIds: v.eligibleProductIds, excludedProductIds: v.excludedProductIds, eligibleCollectionIds: v.eligibleCollectionIds, excludedCollectionIds: v.excludedCollectionIds,
      eligibleSegments: v.eligibleSegments, firstOrderOnly: v.firstOrderOnly,
      minSubtotalCents: v.minSubtotal ?? undefined, maxDiscountCents: v.maxDiscount,
      startsAt: v.startsAt || undefined, endsAt: v.endsAt || null,
      usageLimit: v.usageLimit === "" ? null : v.usageLimit, perCustomerLimit: v.perCustomerLimit === "" ? null : v.perCustomerLimit,
      campaignId: v.campaignId || null,
    };
    if (v.id) await updatePromotion(getDb(), actor, v.id, payload); else await createPromotion(getDb(), actor, { ...payload, code: v.code });
  }, "Promotion saved");
}
export async function setPromotionActiveAction(id: string, active: boolean) {
  return act("marketing:write", async (actor) => { await setPromotionActive(getDb(), actor, uuid.parse(id), active); }, active ? "Promotion activated" : "Promotion paused");
}
export async function deletePromotionAction(id: string) {
  return act("marketing:write", async (actor) => { await deletePromotion(getDb(), actor, uuid.parse(id)); }, "Promotion deleted");
}

/* ---------------- marketing: email campaigns (Phase 7) ---------------- */
const NewEmailCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(200), previewText: z.string().trim().max(200).optional(), content: z.string().trim().min(1).max(20_000),
  audienceType: z.enum(["segment", "loyalty_members", "bought_category", "has_wishlist_items"]), segmentKey: z.string().optional(), categoryId: z.union([z.literal(""), uuid]).optional(),
  campaignId: z.union([z.literal(""), uuid]).optional(),
});
export async function createEmailCampaignAction(input: z.input<typeof NewEmailCampaignSchema>) {
  return act("marketing:write", async (actor) => {
    const v = NewEmailCampaignSchema.parse(input);
    await createEmailCampaign(getDb(), actor, {
      name: v.name, subject: v.subject, previewText: v.previewText, content: v.content, campaignId: v.campaignId || null,
      audience: { type: v.audienceType, segmentKey: v.segmentKey, categoryId: v.categoryId || undefined },
    });
  }, "Email campaign created");
}
export async function scheduleEmailCampaignAction(id: string, scheduledAt: string) {
  return act("marketing:write", async (actor) => { await scheduleEmailCampaign(getDb(), actor, uuid.parse(id), new Date(scheduledAt)); }, "Scheduled");
}
export async function cancelEmailCampaignAction(id: string) {
  return act("marketing:write", async (actor) => { await cancelEmailCampaign(getDb(), actor, uuid.parse(id)); }, "Cancelled");
}
export async function sendEmailCampaignNowAction(id: string) {
  return act("marketing:write", async (actor) => { await sendEmailCampaignNow(getDb(), actor, uuid.parse(id)); }, "Sent");
}

/* ---------------- marketing: abandoned-cart recovery & settings (Phase 7) ---------------- */
export async function sendAbandonedCartRecoveryAction(cartId: string) {
  return act("marketing:write", async (actor) => { await sendAbandonedCartRecoveryNow(getDb(), actor, uuid.parse(cartId)); }, "Recovery email sent");
}
const MarketingSettingsSchema = z.object({
  attributionModel: z.enum(["FIRST_TOUCH", "LAST_TOUCH"]),
  allowLoyaltyWithCoupon: z.boolean().optional(), allowRewardWithPromotion: z.boolean().optional(), allowFreeShippingRewardWithCoupon: z.boolean().optional(),
  abandonedCartAutomationEnabled: z.boolean().optional(),
});
export async function setMarketingSettingsAction(input: z.input<typeof MarketingSettingsSchema>) {
  return act("marketing:write", async (actor) => {
    const v = MarketingSettingsSchema.parse(input);
    await setMarketingSettings(getDb(), actor, {
      attributionModel: v.attributionModel,
      stacking: { allowLoyaltyWithCoupon: !!v.allowLoyaltyWithCoupon, allowRewardWithPromotion: !!v.allowRewardWithPromotion, allowFreeShippingRewardWithCoupon: !!v.allowFreeShippingRewardWithCoupon },
      abandonedCartAutomation: { enabled: !!v.abandonedCartAutomationEnabled, steps: [{ afterHours: 1 }, { afterHours: 24 }, { afterHours: 72 }] },
    });
  }, "Marketing settings saved");
}

/* ---------------- suppliers (Phase 8) ---------------- */
const SupplierInput = z.object({
  id: uuid.optional(), name: z.string().trim().min(1, "Enter a supplier name.").max(120), company: z.string().trim().max(120).optional(),
  contactPerson: z.string().trim().max(120).optional(), email: z.union([z.literal(""), z.string().email()]).optional(), phone: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().max(200).optional(), addressLine2: z.string().trim().max(200).optional(), city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(), country: z.string().trim().max(80).optional(), website: z.string().trim().max(200).optional(),
  paymentTerms: z.string().trim().max(200).optional(), currency: z.string().trim().max(6).optional(), leadTimeDays: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional(),
  minimumOrder: optDollars("Minimum order"), notes: z.string().trim().max(2000).optional(),
});
export async function saveSupplierAction(input: z.input<typeof SupplierInput>) {
  return act("purchasing:write", async (actor) => {
    const v = SupplierInput.parse(input);
    const payload = { ...v, leadTimeDays: v.leadTimeDays === "" ? null : v.leadTimeDays, minimumOrderCents: v.minimumOrder };
    if (v.id) await updateSupplier(getDb(), actor, v.id, payload); else await createSupplier(getDb(), actor, payload);
  }, "Supplier saved");
}
export async function setSupplierStatusAction(id: string, status: string) {
  return act("purchasing:write", async (actor) => { await setSupplierStatus(getDb(), actor, uuid.parse(id), z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).parse(status)); }, "Supplier status updated");
}
const SupplierProductInput = z.object({
  supplierId: uuid, variantId: uuid, supplierSku: z.string().trim().max(60).optional(), purchasePrice: dollars("Purchase price"),
  currency: z.string().trim().max(6).optional(), minimumOrderQuantity: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional(),
  leadTimeDays: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional(), preferredSupplier: z.boolean().optional(),
});
export async function saveSupplierProductAction(input: z.input<typeof SupplierProductInput>) {
  return act("purchasing:write", async (actor) => {
    const v = SupplierProductInput.parse(input);
    await upsertSupplierProduct(getDb(), actor, {
      supplierId: v.supplierId, variantId: v.variantId, supplierSku: v.supplierSku, purchasePriceCents: v.purchasePrice, currency: v.currency,
      minimumOrderQuantity: v.minimumOrderQuantity === "" ? null : v.minimumOrderQuantity, leadTimeDays: v.leadTimeDays === "" ? null : v.leadTimeDays, preferredSupplier: v.preferredSupplier,
    });
  }, "Supplier price saved");
}
export async function removeSupplierProductAction(id: string) {
  return act("purchasing:write", async (actor) => { await removeSupplierProduct(getDb(), actor, uuid.parse(id)); }, "Removed");
}

/* ---------------- purchase orders (Phase 8) ---------------- */
const POItem = z.object({ variantId: uuid, supplierSku: z.string().trim().max(60).optional(), quantity: z.coerce.number().int().min(1), unitCost: dollars("Unit cost"), discount: optDollars("Discount") });
const NewPO = z.object({
  supplierId: uuid, expectedDeliveryDate: z.union([z.literal(""), z.coerce.date()]).optional(), currency: z.string().trim().max(6).optional(),
  paymentTerms: z.string().trim().max(200).optional(), notes: z.string().trim().max(2000).optional(),
  discount: optDollars("Discount"), shipping: optDollars("Shipping"), tax: optDollars("Tax"), dueDate: z.union([z.literal(""), z.coerce.date()]).optional(),
  items: z.array(POItem).min(1, "Add at least one item."),
});
function poInputFromForm(v: z.output<typeof NewPO>) {
  const items: PurchaseOrderItemInput[] = v.items.map((i) => ({ variantId: i.variantId, supplierSku: i.supplierSku, quantity: i.quantity, unitCostCents: i.unitCost, discountCents: i.discount ?? 0 }));
  return { supplierId: v.supplierId, expectedDeliveryDate: v.expectedDeliveryDate || null, currency: v.currency, paymentTerms: v.paymentTerms, notes: v.notes, discountCents: v.discount ?? 0, shippingCents: v.shipping ?? 0, taxCents: v.tax ?? 0, dueDate: v.dueDate || null, items };
}
export async function createPurchaseOrderAction(input: z.input<typeof NewPO>) {
  const res = await act("purchasing:write", async (actor) => {
    const v = NewPO.parse(input);
    const po = await createPurchaseOrder(getDb(), actor, poInputFromForm(v));
    return { id: po.id };
  }, "Purchase order created");
  return res;
}
export async function updatePurchaseOrderAction(id: string, input: z.input<typeof NewPO>) {
  return act("purchasing:write", async (actor) => { const v = NewPO.parse(input); await updatePurchaseOrder(getDb(), actor, uuid.parse(id), poInputFromForm(v)); }, "Purchase order updated");
}
export async function setPurchaseOrderStatusAction(id: string, status: string) {
  return act("purchasing:write", async (actor) => {
    await setPurchaseOrderStatus(getDb(), actor, uuid.parse(id), z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).parse(status));
  }, "Purchase order status updated");
}
const NewDoc = z.object({ purchaseOrderId: uuid, filename: z.string().trim().min(1).max(200), url: z.string().trim().min(1), type: z.enum(["quotation", "invoice", "packing_list", "receiving_document", "other"]) });
export async function addPurchaseDocumentAction(input: z.input<typeof NewDoc>) {
  return act("purchasing:write", async (actor) => { const v = NewDoc.parse(input); await addPurchaseDocument(getDb(), actor, v.purchaseOrderId, v); }, "Document added");
}
export async function removePurchaseDocumentAction(id: string) {
  return act("purchasing:write", async (actor) => { await removePurchaseDocument(getDb(), actor, uuid.parse(id)); }, "Document removed");
}
export async function sendPurchaseOrderEmailAction(id: string, recipientEmail: string) {
  return act("purchasing:write", async (actor) => { await sendPurchaseOrderEmail(getDb(), actor, uuid.parse(id), z.string().email().parse(recipientEmail)); }, "Email sent");
}
const NewPayment = z.object({ purchaseOrderId: uuid, amount: dollars("Amount"), paidAt: z.union([z.literal(""), z.coerce.date()]).optional(), note: z.string().trim().max(300).optional() });
export async function recordPurchasePaymentAction(input: z.input<typeof NewPayment>) {
  return act("purchasing:write", async (actor) => { const v = NewPayment.parse(input); await recordPurchasePayment(getDb(), actor, v.purchaseOrderId, { amountCents: v.amount, paidAt: v.paidAt || undefined, note: v.note }); }, "Payment recorded");
}

/* ---------------- receiving (Phase 8) ---------------- */
const ReceiveLineInput = z.object({ purchaseOrderItemId: uuid, acceptedQuantity: z.coerce.number().int().min(0), damagedQuantity: z.coerce.number().int().min(0).optional(), rejectedQuantity: z.coerce.number().int().min(0).optional(), notes: z.string().trim().max(300).optional() });
const ReceiveInputSchema = z.object({ purchaseOrderId: uuid, notes: z.string().trim().max(1000).optional(), lines: z.array(ReceiveLineInput).min(1) });
export async function receivePurchaseOrderAction(input: z.input<typeof ReceiveInputSchema>) {
  return act("inventory:write", async (actor) => {
    const v = ReceiveInputSchema.parse(input);
    const lines: ReceiveLine[] = v.lines;
    await receivePurchaseOrder(getDb(), actor, { purchaseOrderId: v.purchaseOrderId, notes: v.notes, lines });
  }, "Goods received");
}

/* ---------------- stocktake (Phase 8) ---------------- */
export async function startStocktakeAction(input: { locationId?: string; notes?: string }) {
  return act("inventory:write", async (actor) => {
    const st = await startStocktake(getDb(), actor, { locationId: input.locationId || null, notes: input.notes });
    return { id: st.id };
  }, "Stocktake started");
}
export async function recordCountAction(stocktakeId: string, variantId: string, countedQuantity: number) {
  return act("inventory:write", async (actor) => { await recordCount(getDb(), actor, uuid.parse(stocktakeId), uuid.parse(variantId), z.coerce.number().int().min(0).parse(countedQuantity)); }, "Count saved");
}
export async function completeStocktakeAction(id: string) {
  return act("inventory:write", async (actor) => { await completeStocktake(getDb(), actor, uuid.parse(id)); }, "Stocktake completed");
}
export async function cancelStocktakeAction(id: string) {
  return act("inventory:write", async (actor) => { await cancelStocktake(getDb(), actor, uuid.parse(id)); }, "Stocktake cancelled");
}
const StocktakeSettingsInput = z.object({ approvalThresholdUnits: z.coerce.number().int().min(0) });
export async function setStocktakeSettingsAction(input: z.input<typeof StocktakeSettingsInput>) {
  return act("inventory:write", async (actor) => { const v = StocktakeSettingsInput.parse(input); await setStocktakeSettings(getDb(), actor, v); }, "Stocktake settings saved");
}

/* ---------------- product bulk actions & import (Phase 8) ---------------- */
export async function bulkSetProductStatusAction(ids: string[], status: "active" | "archived") {
  return act("products:write", async (actor) => { await bulkSetProductStatus(getDb(), actor, ids.map((i) => uuid.parse(i)), status); }, "Products updated");
}
export async function bulkSetCategoryAction(ids: string[], categoryId: string) {
  return act("products:write", async (actor) => { await bulkSetCategory(getDb(), actor, ids.map((i) => uuid.parse(i)), uuid.parse(categoryId)); }, "Category updated");
}
export async function bulkSetCollectionAction(ids: string[], collectionId: string) {
  return act("products:write", async (actor) => { await bulkSetCollection(getDb(), actor, ids.map((i) => uuid.parse(i)), collectionId || null); }, "Collection updated");
}
export async function bulkSetReorderLevelAction(ids: string[], level: number) {
  return act("products:write", async (actor) => { await bulkSetReorderLevel(getDb(), actor, ids.map((i) => uuid.parse(i)), z.coerce.number().int().min(0).parse(level)); }, "Reorder level updated");
}
export async function validateProductImportAction(csvText: string): Promise<ActionResult<ImportPreview>> {
  return act("products:write", async () => validateImport(csvText));
}
export async function applyProductImportAction(preview: ImportPreview) {
  return act("products:write", async (actor) => applyProductImport(getDb(), actor, preview));
}
export async function setTargetStockLevelAction(variantId: string, level: number | null) {
  return act("inventory:write", async (actor) => { await setTargetStockLevel(getDb(), actor, uuid.parse(variantId), level); }, "Target stock level saved");
}

/* ---------------- store settings (Phase 8) ---------------- */
const StoreSettingsInput = z.object({ companyName: z.string().trim().max(120).optional(), companyAddress: z.string().trim().max(300).optional(), companyEmail: z.union([z.literal(""), z.string().email()]).optional(), companyPhone: z.string().trim().max(40).optional() });
export async function setStoreSettingsAction(input: z.input<typeof StoreSettingsInput>) {
  return act("settings:write", async (actor) => { const v = StoreSettingsInput.parse(input); await setStoreSettings(getDb(), actor, v); }, "Company details saved");
}

/* ---------------- finance: expense categories (Phase 9) ---------------- */
export async function createExpenseCategoryAction(name: string) {
  return act("finance:write", async (actor) => { await createExpenseCategory(getDb(), actor, z.string().min(1).max(80).parse(name)); }, "Category created");
}
export async function setExpenseCategoryActiveAction(id: string, active: boolean) {
  return act("finance:write", async (actor) => { await setExpenseCategoryActive(getDb(), actor, uuid.parse(id), active); }, "Category updated");
}

/* ---------------- finance: expenses (Phase 9) ---------------- */
const NewExpenseInput = z.object({
  categoryId: uuid, description: z.string().trim().min(1, "Enter a description.").max(500), amount: dollars("Amount"), currency: z.string().trim().max(6).optional(),
  paymentMethod: z.string().trim().max(60).optional(), supplierId: z.union([z.literal(""), uuid]).optional(), referenceNumber: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(), attachmentUrl: z.union([z.literal(""), z.string().url()]).optional(), expenseDate: z.union([z.literal(""), z.coerce.date()]).optional(),
});
function expenseInputFromForm(v: z.output<typeof NewExpenseInput>) {
  return { categoryId: v.categoryId, description: v.description, amountCents: v.amount, currency: v.currency, paymentMethod: v.paymentMethod, supplierId: v.supplierId || null, referenceNumber: v.referenceNumber, notes: v.notes, attachmentUrl: v.attachmentUrl || null, expenseDate: v.expenseDate || undefined };
}
export async function createExpenseAction(input: z.input<typeof NewExpenseInput>) {
  return act("finance:write", async (actor) => { const v = NewExpenseInput.parse(input); const row = await createExpense(getDb(), actor, expenseInputFromForm(v)); return { id: row.id }; }, "Expense created");
}
export async function updateExpenseAction(id: string, input: z.input<typeof NewExpenseInput>) {
  return act("finance:write", async (actor) => { const v = NewExpenseInput.parse(input); await updateExpense(getDb(), actor, uuid.parse(id), expenseInputFromForm(v)); }, "Expense updated");
}
export async function submitExpenseAction(id: string) {
  return act("finance:write", async (actor) => { await submitExpense(getDb(), actor, uuid.parse(id)); }, "Submitted for approval");
}
export async function approveExpenseAction(id: string) {
  return act("finance:write", async (actor) => { await approveExpense(getDb(), actor, uuid.parse(id)); }, "Expense approved");
}
export async function rejectExpenseAction(id: string, reason: string) {
  return act("finance:write", async (actor) => { await rejectExpense(getDb(), actor, uuid.parse(id), z.string().max(500).parse(reason)); }, "Expense rejected");
}
export async function markExpensePaidAction(id: string) {
  return act("finance:write", async (actor) => { await markExpensePaid(getDb(), actor, uuid.parse(id)); }, "Expense marked paid");
}
export async function cancelExpenseAction(id: string) {
  return act("finance:write", async (actor) => { await cancelExpense(getDb(), actor, uuid.parse(id)); }, "Expense cancelled");
}
export async function deleteExpenseAction(id: string) {
  return act("finance:write", async (actor) => { await deleteExpense(getDb(), actor, uuid.parse(id)); }, "Expense deleted");
}

/* ---------------- finance: tax configuration (Phase 9) ---------------- */
const TaxSettingsInput = z.object({ enabled: z.boolean().optional(), taxRatePercent: z.coerce.number().min(0).max(100).optional(), label: z.string().trim().max(80).optional() });
export async function setTaxSettingsAction(input: z.input<typeof TaxSettingsInput>) {
  return act("finance:write", async (actor) => {
    const v = TaxSettingsInput.parse(input);
    await setTaxSettings(getDb(), actor, { enabled: v.enabled, taxRateBp: v.taxRatePercent != null ? Math.round(v.taxRatePercent * 100) : undefined, label: v.label });
  }, "Tax configuration saved");
}

/* ---------------- finance: reconciliation (Phase 9) ---------------- */
export async function runStripeReconciliationAction(paymentId: string) {
  return act("finance:write", async (actor) => { await runStripeReconciliation(getDb(), actor, uuid.parse(paymentId)); }, "Reconciliation checked");
}
const ManualReconInput = z.object({ paymentId: uuid, externalAmount: z.union([z.literal(""), dollars("External amount")]).optional(), notes: z.string().trim().max(500).optional() });
export async function recordManualReconciliationAction(input: z.input<typeof ManualReconInput>) {
  return act("finance:write", async (actor) => {
    const v = ManualReconInput.parse(input);
    await recordManualReconciliation(getDb(), actor, v.paymentId, { externalAmountCents: v.externalAmount === "" || v.externalAmount == null ? null : v.externalAmount, notes: v.notes });
  }, "Reconciliation recorded");
}
export async function markReconciliationReviewedAction(id: string) {
  return act("finance:write", async (actor) => { await markReconciliationReviewed(getDb(), actor, uuid.parse(id)); }, "Marked reviewed");
}

/* ---------------- finance: report snapshots (Phase 9) ---------------- */
const SnapshotInput = z.object({ reportType: z.string().min(1), label: z.string().trim().min(1, "Enter a name.").max(160), from: z.string(), to: z.string() });
export async function saveReportSnapshotAction(input: z.input<typeof SnapshotInput>) {
  return act("finance:write", async (actor) => {
    const v = SnapshotInput.parse(input);
    const row = await saveReportSnapshot(getDb(), actor, { reportType: v.reportType as ReportKey, label: v.label, range: { from: new Date(v.from), to: new Date(v.to) } });
    return { id: row.id };
  }, "Snapshot saved");
}
export async function deleteReportSnapshotAction(id: string) {
  return act("finance:write", async (actor) => { await deleteReportSnapshot(getDb(), actor, uuid.parse(id)); }, "Snapshot deleted");
}

/* ---------------- session ---------------- */
export async function signOutAction() {
  const jar = await cookies();
  jar.delete(DEV_COOKIE);
  if (supabaseConfigured()) {
    const { createServerClient } = await import("@supabase/ssr");
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => jar.getAll(), setAll: (l) => l.forEach(({ name, value, options }) => jar.set(name, value, options)) } });
    await supabase.auth.signOut();
  }
  redirect("/admin/login");
}
/** Development only (no Supabase configured, never in production). */
export async function devSignInAction(email: string, next?: string) {
  if (!devAuthEnabled()) throw new Error("Not available.");
  (await cookies()).set(DEV_COOKIE, z.string().email().parse(email), { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(next && next.startsWith("/admin") ? next : "/admin/dashboard");
}
