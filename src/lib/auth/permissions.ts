/**
 * Role-based access control (docs/ROLES_AND_PERMISSIONS.md).
 * Enforced on the server: in route handlers via requireStaff(), and again inside every service via assertCan().
 * Hiding a button in the UI is never the protection.
 */
import { ForbiddenError } from "../errors";

export type Role = "OWNER" | "ADMIN" | "SALES" | "INVENTORY" | "VIEWER";
export const AREAS = ["dashboard", "sales", "orders", "customers", "products", "inventory", "discounts", "reports", "reviews", "content", "audit", "staff", "settings", "loyalty", "marketing", "purchasing", "finance"] as const;
export type Area = (typeof AREAS)[number];
export type Permission = `${Area}:read` | `${Area}:write`;

const RW = (...a: Area[]) => a.flatMap((x) => [`${x}:read`, `${x}:write`] as Permission[]);
const RO = (...a: Area[]) => a.map((x) => `${x}:read` as Permission);

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  // Full access.
  OWNER: new Set(RW(...AREAS)),
  // Phase 2 brief §46: dashboard, sales, orders, products, inventory, customers, reports.
  // Discounts, reviews, content, audit log, staff and settings are OWNER-only.
  // Phase 6 brief §42: "full customer management" — loyalty *balances* are visible (read), but tiers,
  // earning rules, rewards and manual point adjustments stay OWNER-only, same as discounts (money-adjacent).
  // Phase 7 brief §44: ADMIN manages campaigns and promotions — a new, separate `marketing` area (the
  // pre-existing `discounts` area stays OWNER-only; see docs/PHASE_7_AUDIT.md).
  // Phase 8 brief §50: "Products, suppliers, purchasing" — a new `purchasing` area (suppliers + PO
  // creation/approval). Receiving/stocktake stay on `inventory:write`, which ADMIN already has.
  // Phase 9 brief §7: "OWNER/ADMIN: create, edit, approve, reject, delete/void, mark paid, view reports."
  // Other roles: "follow existing RBAC" — the pre-existing `reports` area is already OWNER/ADMIN-only, so
  // `finance` gets the same treatment as `reports`/`discounts`, not broadened to SALES/INVENTORY/VIEWER.
  ADMIN: new Set([...RW("dashboard", "sales", "orders", "products", "inventory", "customers", "reports", "marketing", "purchasing", "finance"), ...RO("loyalty")]),
  // Dashboard, sales, orders, customers, and (Phase 6 brief §42) customer profiles/communication.
  // Phase 7 brief §44: "view customer campaign data where permitted" — read-only marketing.
  // Phase 8 brief §50: read-only purchasing (supplier/PO context); products/inventory stay out of scope for
  // SALES, an unchanged Phase 2 boundary this phase doesn't reopen — see docs/PHASE_8_AUDIT.md.
  SALES: new Set([...RO("dashboard", "sales", "loyalty", "marketing", "purchasing"), ...RW("orders", "customers")]),
  // Dashboard, products, inventory (incl. stock movements).
  // Phase 8 brief §50: "Receiving, stocktake, inventory" — INVENTORY receives against an already-approved PO
  // and runs stocktakes via `inventory:write` (unchanged), and can see POs/suppliers (`purchasing:read`),
  // but cannot create a supplier or approve a PO (`purchasing:write` stays OWNER/ADMIN).
  INVENTORY: new Set([...RO("dashboard", "purchasing"), ...RW("products", "inventory")]),
  // Dashboard, read-only. Phase 7 brief §44: "read-only analytics" extends to marketing; Phase 8 brief §50
  // extends the same read-only posture to purchasing.
  VIEWER: new Set(RO("dashboard", "marketing", "purchasing")),
};

export const can = (role: Role, p: Permission) => PERMISSIONS[role].has(p);

export type Actor = { userId: string | null; name: string; role: Role };
/** Anonymous shoppers. May only create PENDING web orders; payment confirmation comes from the provider. */
export const STOREFRONT_ACTOR: Actor = Object.freeze({ userId: null, name: "Storefront", role: "VIEWER" as Role });
/** Trusted automated processes only (payment webhook, reservation expiry sweep) — never derived from a
 *  request. Full permissions, since these run without a human in the loop and must not be blocked by role. */
export const SYSTEM_ACTOR: Actor = Object.freeze({ userId: null, name: "System", role: "OWNER" as Role });

export function assertCan(actor: Actor, p: Permission): void {
  if (!can(actor.role, p)) throw new ForbiddenError(`The ${actor.role.toLowerCase()} role cannot perform ${p}.`);
}
