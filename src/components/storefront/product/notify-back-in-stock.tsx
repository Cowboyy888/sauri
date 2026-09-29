"use client";
import { useState, useTransition } from "react";
import { subscribeBackInStockAction } from "@/app/(shop)/account/actions";

/** "Notify me when available" (brief §40) — a real, working subscription; no automation beyond it fires
 *  once, the moment the variant's available stock actually crosses back above zero (docs/CRM.md). */
export function NotifyBackInStock({ variantId }: { variantId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [email, setEmail] = useState("");

  if (state === "done") return <p className="mt-3 font-sans text-sm text-ink">We&rsquo;ll email you when this is back in stock.</p>;
  return (
    <form
      className="mt-3 flex gap-2"
      action={() => start(async () => {
        const r = await subscribeBackInStockAction({ variantId, email });
        setState(r.ok ? "done" : "error");
      })}
    >
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="h-11 flex-1 border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none" />
      <button type="submit" disabled={pending} className="h-11 whitespace-nowrap border border-ink px-4 font-sans text-xs uppercase tracking-widest text-ink transition-colors hover:bg-ink hover:text-warm-white disabled:opacity-50">{pending ? "…" : "Notify me"}</button>
      {state === "error" && <p className="font-sans text-xs text-error">Enter a valid email.</p>}
    </form>
  );
}
