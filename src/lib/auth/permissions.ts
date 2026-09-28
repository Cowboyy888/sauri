/**
 * Role-based access control (docs/ROLES_AND_PERMISSIONS.md).
 * Enforced on the server: in route handlers via requireStaff(), and again inside every service via assertCan().
 * Hiding a button in the UI is never the protection.
 */
import { ForbiddenError } from "../errors";

export type Role = "OWNER" | "ADMIN" | "SALES" | "INVENTORY" | "VIEWER";
export const AREAS = ["dashboard", "sales", "orders", "customers", "products", "inventory", "discounts", "reports", "reviews", "content", "audit", "staff", "settings"] as const;
export type Area = (typeof AREAS)[number];
export type Permission = `${Area}:read` | `${Area}:write`;

const RW = (...a: Area[]) => a.flatMap((x) => [`${x}:read`, `${x}:write`] as Permission[]);
const RO = (...a: Area[]) => a.map((x) => `${x}:read` as Permission);

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  // Full access.
  OWNER: new Set(RW(...AREAS)),
  // Phase 2 brief §46: dashboard, sales, orders, products, inventory, customers, reports.
  // Discounts, reviews, content, audit log, staff and settings are OWNER-only.
  ADMIN: new Set(RW("dashboard", "sales", "orders", "products", "inventory", "customers", "reports")),
  // Dashboard, sales, orders, customers.
  SALES: new Set([...RO("dashboard", "sales"), ...RW("orders", "customers")]),
  // Dashboard, products, inventory (incl. stock movements).
  INVENTORY: new Set([...RO("dashboard"), ...RW("products", "inventory")]),
  // Dashboard, read-only.
  VIEWER: new Set(RO("dashboard")),
};

export const can = (role: Role, p: Permission) => PERMISSIONS[role].has(p);

export type Actor = { userId: string | null; name: string; role: Role };
/** Anonymous shoppers. May only create PENDING web orders; payment confirmation comes from the provider. */
export const STOREFRONT_ACTOR: Actor = Object.freeze({ userId: null, name: "Storefront", role: "VIEWER" as Role });

export function assertCan(actor: Actor, p: Permission): void {
  if (!can(actor.role, p)) throw new ForbiddenError(`The ${actor.role.toLowerCase()} role cannot perform ${p}.`);
}
