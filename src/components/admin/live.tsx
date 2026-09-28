"use client";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

type Live = { connected: boolean; refresh: () => void; refreshing: boolean; lastEvent: string | null };
const Ctx = createContext<Live>({ connected: false, refresh: () => {}, refreshing: false, lastEvent: null });

/**
 * One EventSource per tab (/api/admin/events, backed by Postgres LISTEN). When an order is paid or stock changes,
 * the current page re-renders on the server with fresh numbers: revenue, orders, profit, stock, alerts.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [refreshing, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = () => start(() => router.refresh());
  useEffect(() => {
    let es: EventSource | null = null, retry: ReturnType<typeof setTimeout> | null = null, closed = false;
    const connect = () => {
      es = new EventSource("/api/admin/events");
      es.onopen = () => setConnected(true);
      es.onmessage = (m) => {
        try { const e = JSON.parse(m.data) as { type: string }; if (e.type === "hello") return; setLastEvent(e.type); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent("sauri:data"));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => start(() => router.refresh()), 800); // coalesce bursts (one order = several stock events)
      };
      es.onerror = () => { setConnected(false); es?.close(); if (!closed) retry = setTimeout(connect, 5000); };
    };
    connect();
    return () => { closed = true; es?.close(); if (retry) clearTimeout(retry); if (timer.current) clearTimeout(timer.current); };
  }, [router]);
  return <Ctx.Provider value={{ connected, refresh, refreshing, lastEvent }}>{children}</Ctx.Provider>;
}
export const useLive = () => useContext(Ctx);

/** Refresh button + "Updated 10:42:07" (server render time) + live indicator. */
export function RefreshControl({ renderedAt }: { renderedAt: string }) {
  const { connected, refresh, refreshing } = useLive();
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5" title={connected ? "Updates automatically when orders arrive or stock changes" : "Live updates unavailable; use Refresh"}>
        <span className={cn("size-2 rounded-full", connected ? "bg-pos" : "bg-subtle")} aria-hidden />
        {connected ? "Live" : "Offline"}
      </span>
      <span aria-live="polite">Updated {renderedAt}</span>
      <Button size="sm" onClick={refresh} disabled={refreshing} aria-label="Refresh data"><RotateCw className={cn(refreshing && "animate-spin")} /><span className="hidden sm:inline">Refresh</span></Button>
    </div>
  );
}
