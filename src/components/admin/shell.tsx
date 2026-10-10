"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, BookOpen, Boxes, ChevronsLeft, ChevronsRight, Gem, LayoutDashboard, LineChart, LogOut, Menu as MenuIcon, Percent,
  Receipt, Settings, ShoppingBag, Star, UserRound, Users, FileSpreadsheet, History, Truck, Undo2, Award, ShoppingCart, Building2, ClipboardList, Landmark,
} from "lucide-react";
import { Dialog, DialogContent } from "../ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu";
import { cn } from "../ui/cn";
import { GlobalSearch } from "./global-search";
import { NotificationDropdown } from "./notifications";
import { DateRangePicker } from "./date-range-picker";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; match?: string[] };
const ICONS = { dashboard: LayoutDashboard, sales: LineChart, orders: ShoppingBag, products: Gem, inventory: Boxes, customers: Users, analytics: BarChart3, discounts: Percent, reports: FileSpreadsheet, reviews: Star, content: BookOpen, settings: Settings, audit: History, receipt: Receipt, fulfillment: Truck, returns: Undo2, loyalty: Award, marketing: ShoppingCart, suppliers: Building2, purchases: ClipboardList, finance: Landmark };
export type ShellUser = { name: string; email: string; role: string };

const RANGE_PATHS = ["/admin/dashboard", "/admin/analytics", "/admin/reports", "/admin/orders", "/admin/products", "/admin/finance"];

function NavList({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = (it.match ?? [it.href]).some((p) => path === p || path.startsWith(p + "/"));
        return (
          <li key={it.href}>
            <Link href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? it.label : undefined}
              className={cn("flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-muted hover:bg-line-soft hover:text-fg", active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent", collapsed && "justify-center px-0")}>
              <Icon className="size-[18px] shrink-0" aria-hidden />
              <span className={cn(collapsed && "sr-only")}>{it.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserBlock({ user, collapsed, signOut }: { user: ShellUser; collapsed?: boolean; signOut: () => Promise<void> }) {
  const initials = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className={cn("border-t border-line pt-3", collapsed ? "grid justify-center gap-2" : "")}>
      <div className={cn("flex items-center gap-2.5", collapsed ? "justify-center" : "px-1")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-fg text-xs font-semibold text-white" aria-hidden>{initials}</span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.role.charAt(0) + user.role.slice(1).toLowerCase()}</p>
          </div>
        )}
      </div>
      <div className={cn("mt-2 flex gap-1", collapsed ? "flex-col items-center" : "px-1")}>
        <Link href="/admin/profile" title="Profile" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted hover:bg-line-soft hover:text-fg"><UserRound className="size-4" /><span className={cn(collapsed && "sr-only")}>Profile</span></Link>
        <form action={signOut}><button title="Log out" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted hover:bg-line-soft hover:text-fg"><LogOut className="size-4" /><span className={cn(collapsed && "sr-only")}>Log out</span></button></form>
      </div>
    </div>
  );
}

export function AdminShell({ nav, user, signOut, searchScopes, children }: { nav: NavItem[]; user: ShellUser; signOut: () => Promise<void>; searchScopes: string[]; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // Radix menus generate ids that can differ between server and client render; mount them in the browser only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const path = usePathname();
  useEffect(() => { try { setCollapsed(localStorage.getItem("sauri:nav") === "1"); } catch { /* storage unavailable */ } }, []);
  const toggle = () => { setCollapsed((c) => { try { localStorage.setItem("sauri:nav", c ? "0" : "1"); } catch { /* ignore */ } return !c; }); };
  // Date range applies to analytics-style pages (and a product's analytics); not to order detail or forms.
  const showRange = RANGE_PATHS.some((p) => path === p || path.startsWith(p + "/")) && !/^\/admin\/orders\/[^/]+$/.test(path) && path !== "/admin/products/new";

  return (
    <div className="admin min-h-dvh md:flex">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      {/* Sidebar: full ≥1280px (or icon rail if the user collapses it), icon rail 768–1279px, drawer below 768px. */}
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface p-3 md:flex", collapsed ? "w-[64px]" : "w-[64px] xl:w-[232px]")} aria-label="Admin navigation">
        <div className={cn("mb-4 flex h-9 items-center", collapsed ? "justify-center" : "justify-center xl:justify-between xl:px-1.5")}>
          <Link href="/admin/dashboard" className="font-display text-[17px] tracking-[0.28em]" aria-label="SAURI admin home">
            <span className={cn(collapsed ? "" : "xl:hidden")}>S</span><span className={cn("hidden", !collapsed && "xl:inline")}>SAURI</span>
          </Link>
          <button onClick={toggle} className={cn("hidden rounded p-1 text-subtle hover:bg-line-soft hover:text-fg", !collapsed && "xl:block")} aria-label="Collapse sidebar"><ChevronsLeft className="size-4" /></button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto"><div className="hidden xl:block"><NavList items={nav} collapsed={collapsed} /></div><div className="xl:hidden"><NavList items={nav} collapsed /></div></nav>
        {collapsed && <button onClick={toggle} className="mx-auto mb-2 hidden rounded p-1 text-subtle hover:bg-line-soft hover:text-fg xl:block" aria-label="Expand sidebar"><ChevronsRight className="size-4" /></button>}
        <div className="hidden xl:block">{!collapsed ? <UserBlock user={user} signOut={signOut} /> : <UserBlock user={user} collapsed signOut={signOut} />}</div>
        <div className="xl:hidden"><UserBlock user={user} collapsed signOut={signOut} /></div>
      </aside>

      <Dialog open={drawer} onOpenChange={setDrawer}>
        <DialogContent title="Navigation" side="left">
          <div className="flex h-full flex-col p-3">
            <p className="mb-4 px-1.5 font-display text-[17px] tracking-[0.28em]">SAURI</p>
            <nav className="flex-1 overflow-y-auto"><NavList items={nav} onNavigate={() => setDrawer(false)} /></nav>
            <UserBlock user={user} signOut={signOut} />
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-[rgba(245,245,242,.92)] px-3 backdrop-blur md:px-5">
          <button onClick={() => setDrawer(true)} className="rounded-md p-2 text-fg hover:bg-line-soft md:hidden" aria-label="Open navigation"><MenuIcon className="size-5" /></button>
          <GlobalSearch scopes={searchScopes} />
          <div className="ml-auto flex items-center gap-1.5">
            {showRange && <DateRangePicker className="hidden lg:flex" />}
            {mounted ? <NotificationDropdown /> : <span className="size-9" aria-hidden />}
            {mounted ? <Menu>
              <MenuTrigger className="grid size-9 place-items-center rounded-full hover:bg-line-soft" aria-label={`Account: ${user.name}`}>
                <span className="grid size-7 place-items-center rounded-full bg-fg text-[11px] font-semibold text-white">{user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel><span className="block font-medium text-fg">{user.name}</span>{user.email}<br />Role: {user.role.toLowerCase()}</MenuLabel>
                <MenuSeparator />
                <MenuItem asChild><Link href="/admin/profile"><UserRound />Profile</Link></MenuItem>
                <MenuItem onSelect={() => void signOut()}><LogOut />Log out</MenuItem>
              </MenuContent>
            </Menu> : <span className="size-9" aria-hidden />}
          </div>
        </header>
        {showRange && <div className="border-b border-line bg-surface px-3 py-2 lg:hidden"><DateRangePicker /></div>}
        <main id="admin-main" className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-3 pb-16 pt-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
