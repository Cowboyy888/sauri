import { AccessDeniedView } from "./states";
const AREA: Record<string, string> = { sales: "sales analytics", orders: "orders", customers: "customers", products: "products", inventory: "inventory", discounts: "discounts", reports: "reports", reviews: "reviews", content: "content", audit: "the audit log", settings: "settings", staff: "staff management", dashboard: "the dashboard" };
export function AccessDenied({ role, permission }: { role: string; permission: string }) {
  return <AccessDeniedView role={role} area={AREA[permission.split(":")[0]!] ?? "this page"} />;
}
