/** Role-based access control. Checked on the server in every admin action and route. */
import { ForbiddenError } from "../errors";

export type Role = "OWNER" | "ADMIN" | "SALES" | "INVENTORY" | "VIEWER";
export type Area = "dashboard" | "sales" | "orders" | "customers" | "products" | "inventory" | "discounts" | "reports" | "reviews" | "content" | "audit" | "settings" | "system";
export type Permission = `${Area}:read` | `${Area}:write`;

const R = (...a: Area[]) => a.flatMap((x) => [`${x}:read`, `${x}:write`] as Permission[]);
const RO = (...a: Area[]) => a.map((x) => `${x}:read` as Permission);
const ALL: Area[] = ["dashboard", "sales", "orders", "customers", "products", "inventory", "discounts", "reports", "reviews", "content", "audit", "settings", "system"];

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(R(...ALL)),
  // Everything except sensitive system settings (roles, data reset, integrations).
  ADMIN: new Set([...R(...ALL.filter((a) => a !== "system" && a !== "settings")), ...RO("settings")]),
  SALES: new Set([...RO("dashboard", "sales"), ...R("orders", "customers")]),
  INVENTORY: new Set([...RO("dashboard"), ...R("inventory", "products")]),
  VIEWER: new Set(RO("dashboard")),
};

export const can = (role: Role, p: Permission) => PERMISSIONS[role].has(p);

export type Actor = { userId: string | null; name: string; role: Role };
export const SYSTEM_ACTOR: Actor = { userId: null, name: "System", role: "OWNER" };
export const STOREFRONT_ACTOR: Actor = { userId: null, name: "Storefront", role: "OWNER" };

export function assertCan(actor: Actor, p: Permission): void {
  if (!can(actor.role, p)) throw new ForbiddenError(`The ${actor.role.toLowerCase()} role cannot perform ${p}.`);
}
