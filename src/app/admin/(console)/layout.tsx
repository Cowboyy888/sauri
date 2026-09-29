import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getDb } from "@/lib/db/client";
import { getStaff } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";
import { AdminShell, type NavItem } from "@/components/admin/shell";
import { LiveProvider } from "@/components/admin/live";
import { Toaster } from "@/components/admin/toast";
import { signOutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s | SAURI Admin" }, robots: { index: false, follow: false } };

/** Sidebar per brief §4. Items the role can't open are not shown; every page ALSO checks on the server. */
const NAV: (NavItem & { perm: Permission })[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "dashboard", perm: "dashboard:read" },
  { href: "/admin/analytics/sales", label: "Sales", icon: "sales", perm: "sales:read", match: ["/admin/analytics/sales"] },
  { href: "/admin/orders", label: "Orders", icon: "orders", perm: "orders:read" },
  { href: "/admin/fulfillment", label: "Fulfillment", icon: "fulfillment", perm: "inventory:read" },
  { href: "/admin/returns", label: "Returns", icon: "returns", perm: "orders:read" },
  { href: "/admin/products", label: "Products", icon: "products", perm: "products:read" },
  { href: "/admin/inventory", label: "Inventory", icon: "inventory", perm: "inventory:read" },
  { href: "/admin/customers", label: "Customers", icon: "customers", perm: "customers:read", match: ["/admin/customers", "/admin/customers/segments"] },
  { href: "/admin/loyalty", label: "Loyalty", icon: "loyalty", perm: "loyalty:read" },
  { href: "/admin/marketing/abandoned-carts", label: "Marketing", icon: "marketing", perm: "customers:read" },
  { href: "/admin/analytics/products", label: "Analytics", icon: "analytics", perm: "sales:read", match: ["/admin/analytics/products", "/admin/analytics/customers", "/admin/analytics/channels", "/admin/analytics/shipping", "/admin/analytics/returns", "/admin/analytics/retention"] },
  { href: "/admin/discounts", label: "Discounts", icon: "discounts", perm: "discounts:read" },
  { href: "/admin/reports", label: "Reports", icon: "reports", perm: "reports:read" },
  { href: "/admin/reviews", label: "Reviews", icon: "reviews", perm: "reviews:read" },
  { href: "/admin/content", label: "Content", icon: "content", perm: "content:read" },
  { href: "/admin/settings", label: "Settings", icon: "settings", perm: "settings:read", match: ["/admin/settings", "/admin/audit-log"] },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff(getDb());
  if (!staff) redirect(`/admin/login?next=${encodeURIComponent((await headers()).get("x-sauri-path") ?? "/admin/dashboard")}`);
  const nav = NAV.filter((n) => can(staff.role, n.perm)).map(({ perm: _p, ...n }) => (void _p, n));
  const scopes = [can(staff.role, "orders:read") && "orders", can(staff.role, "products:read") && "products, SKUs", can(staff.role, "customers:read") && "customers"].filter(Boolean) as string[];
  return (
    <LiveProvider>
      <AdminShell nav={nav} user={{ name: staff.name, email: staff.email, role: staff.role }} signOut={signOutAction} searchScopes={scopes.length ? scopes : ["the admin"]}>
        {children}
      </AdminShell>
      <Toaster />
    </LiveProvider>
  );
}
