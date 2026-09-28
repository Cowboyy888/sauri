"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, CreditCard, PackageX, ShoppingBag, Star, Undo2, Info } from "lucide-react";
import { Menu, MenuContent, MenuTrigger } from "../ui/menu";
import * as M from "@radix-ui/react-dropdown-menu";
import { cn } from "../ui/cn";

type Item = { id: number; type: string; label: string; title: string; body: string; href: string; read: boolean; ago: string };
const ICON: Record<string, typeof Bell> = { new_order: ShoppingBag, large_order: ShoppingBag, low_stock: AlertTriangle, out_of_stock: PackageX, payment_failed: CreditCard, refund: Undo2, review: Star, system: Info };
const TONE: Record<string, string> = { low_stock: "text-warn", out_of_stock: "text-neg", payment_failed: "text-neg", refund: "text-neg", large_order: "text-accent", new_order: "text-accent" };

export function NotificationDropdown() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]), [unread, setUnread] = useState(0), [error, setError] = useState(false);
  const load = useCallback(() => {
    fetch("/api/admin/notifications").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { setItems(d.items); setUnread(d.unread); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); const h = () => load(); window.addEventListener("sauri:data", h); return () => window.removeEventListener("sauri:data", h); }, [load]);
  const mark = (ids: number[] | "all") => fetch("/api/admin/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).then(load);
  return (
    <Menu onOpenChange={(o) => o && load()}>
      <MenuTrigger className="relative grid size-9 place-items-center rounded-md text-fg hover:bg-line-soft" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-[17px] place-items-center rounded-full bg-neg px-1 text-[10px] font-semibold leading-[17px] text-white">{unread > 99 ? "99+" : unread}</span>}
      </MenuTrigger>
      <MenuContent className="w-[min(380px,calc(100vw-16px))] p-0">
        <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5">
          <p className="text-[13px] font-semibold">Notifications</p>
          {unread > 0 && <button onClick={() => mark("all")} className="text-xs font-medium text-accent hover:underline">Mark all as read</button>}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {error ? <p className="px-3 py-6 text-center text-[13px] text-muted">Unable to load notifications.</p>
            : !items.length ? <p className="px-3 py-6 text-center text-[13px] text-muted">Nothing new.</p>
            : items.map((n) => {
              const Icon = ICON[n.type] ?? Info;
              return (
                <M.Item key={n.id} onSelect={() => { if (!n.read) void mark([n.id]); router.push(n.href); }}
                  className="flex cursor-pointer gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-line-soft">
                  <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted", TONE[n.type])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className={cn("truncate text-[13px]", n.read ? "text-muted" : "font-medium text-fg")}>{n.title}</span>{!n.read && <span className="size-1.5 shrink-0 rounded-full bg-info" aria-label="unread" />}</span>
                    <span className="block truncate text-xs text-muted">{n.body}</span>
                    <span className="mt-0.5 block text-[11px] text-subtle">{n.label} · {n.ago}</span>
                  </span>
                </M.Item>
              );
            })}
        </div>
      </MenuContent>
    </Menu>
  );
}
