"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type T = { id: number; text: string; ok: boolean };
export const toast = (text: string, ok = true) => window.dispatchEvent(new CustomEvent("sauri:toast", { detail: { text, ok } }));

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ text: string; ok: boolean }>).detail; const id = Date.now() + Math.random(); setItems((x) => [...x, { id, ...d }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500); };
    window.addEventListener("sauri:toast", h); return () => window.removeEventListener("sauri:toast", h);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[70] grid gap-2">
      {items.map((t) => (
        <div key={t.id} className="admin admin-toast-in pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border border-line bg-surface px-3.5 py-2.5 text-[13px] shadow-[0_10px_30px_rgba(0,0,0,.14)]">
          {t.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pos" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-neg" />}{t.text}
        </div>
      ))}
    </div>
  );
}
