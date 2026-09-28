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
import { createDiscount, setDiscountActive } from "@/lib/discounts/service";
import { addProductImage, addStaff, addVariant, createProduct, deleteProduct, duplicateProduct, removeProductImage, setProductArchived, setReviewStatus, updateContent, updateProduct, updateStaff, updateVariant } from "@/lib/catalog/service";

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

/* ---------------- products ---------------- */
const csv = z.string().optional().transform((s) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30));
const NewProduct = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(120), slug: z.string().trim().max(80).optional(), shortDescription: z.string().trim().max(200).optional(), description: z.string().trim().max(5000).optional(),
  categoryId: uuid, collectionId: z.union([z.literal(""), uuid]).optional(), status: z.enum(["draft", "active", "archived"]),
  featured: z.boolean().optional(), bestSeller: z.boolean().optional(), newArrival: z.boolean().optional(),
  material: z.enum(["yg", "wg", "vm", "ss"]), color: z.string().trim().max(40).optional(), size: z.string().trim().max(20).optional(), gemstone: z.string().trim().max(40).optional(),
  sku: z.string().trim().min(3, "Enter a SKU.").max(40), barcode: z.string().trim().max(40).optional(),
  costPrice: dollars("Cost price"), sellingPrice: dollars("Selling price"), compareAtPrice: optDollars("Compare-at price"),
  weightGrams: z.union([z.literal(""), z.coerce.number().min(0).max(10_000)]).optional(), reorderLevel: z.coerce.number().int().min(0).max(10_000).optional(),
  seoTitle: z.string().trim().max(70).optional(), seoDescription: z.string().trim().max(160).optional(), tags: csv, imageUrls: z.string().optional().transform((s) => (s ?? "").split(/\s+/).map((x) => x.trim()).filter(Boolean).slice(0, 12)),
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
  seoTitle: z.string().trim().max(70).optional(), seoDescription: z.string().trim().max(160).optional(), tags: z.string().optional(),
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
const NewVariant = z.object({ productId: uuid, sku: z.string().trim().min(3).max(40), material: z.enum(["yg", "wg", "vm", "ss"]), size: z.string().trim().max(20).optional(), color: z.string().trim().max(40).optional(), gemstone: z.string().trim().max(40).optional(), barcode: z.string().trim().max(40).optional(), sellingPrice: dollars("Selling price"), costPrice: dollars("Cost price"), compareAtPrice: optDollars("Compare-at price"), reorderLevel: z.coerce.number().int().min(0).optional() });
export async function addVariantAction(input: z.input<typeof NewVariant>) {
  return act("products:write", async (actor) => { const v = NewVariant.parse(input); await addVariant(getDb(), actor, v.productId, { ...v, sellingPriceCents: v.sellingPrice, costPriceCents: v.costPrice, compareAtPriceCents: v.compareAtPrice }); }, "Variant added. Restock it to start selling.");
}
export async function duplicateProductAction(id: string) { return act("products:write", async (actor) => ({ id: (await duplicateProduct(getDb(), actor, uuid.parse(id))).id }), "Draft copy created"); }
export async function archiveProductAction(id: string, archived: boolean) { return act("products:write", async (actor) => { await setProductArchived(getDb(), actor, uuid.parse(id), archived); }, archived ? "Product archived" : "Product restored"); }
export async function deleteProductAction(id: string) { return act("products:write", async (actor) => { await deleteProduct(getDb(), actor, uuid.parse(id)); }, "Product deleted"); }
export async function addImageAction(productId: string, url: string, alt: string) { return act("products:write", async (actor) => { await addProductImage(getDb(), actor, uuid.parse(productId), z.string().max(500).parse(url), z.string().max(200).parse(alt)); }, "Image added"); }
export async function removeImageAction(imageId: string) { return act("products:write", async (actor) => { await removeProductImage(getDb(), actor, uuid.parse(imageId)); }, "Image removed"); }

/* ---------------- reviews, content, discounts, staff ---------------- */
export async function setReviewStatusAction(id: string, status: "published" | "hidden") { return act("reviews:write", async (actor) => { await setReviewStatus(getDb(), actor, uuid.parse(id), z.enum(["published", "hidden"]).parse(status)); }, status === "published" ? "Review published" : "Review hidden"); }
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
