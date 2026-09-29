"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestCancellationAction } from "@/app/(shop)/account/actions";

/** Customer self-cancellation (brief §18) — only offered while the order is still eligible; the server
 *  re-checks the same rule regardless of what this button shows. */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)} className="font-sans text-xs uppercase tracking-widest text-ink/60 underline-offset-4 hover:text-ink hover:underline">Cancel this order</button>;
  }
  return (
    <div className="mt-2 border border-ink/15 p-4">
      <p className="font-sans text-sm text-ink">Cancel this order? This can’t be undone.</p>
      {err && <p className="mt-2 font-sans text-sm text-error">{err}</p>}
      <div className="mt-3 flex gap-3">
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="font-sans text-xs uppercase tracking-widest text-ink/60 hover:text-ink">Keep order</button>
        <button
          type="button" disabled={pending}
          onClick={() => start(async () => {
            setErr(null);
            const r = await requestCancellationAction(orderId);
            if (r.ok) router.refresh(); else setErr(r.error);
          })}
          className="font-sans text-xs uppercase tracking-widest text-error underline-offset-4 hover:underline"
        >
          {pending ? "Cancelling…" : "Yes, cancel order"}
        </button>
      </div>
    </div>
  );
}
