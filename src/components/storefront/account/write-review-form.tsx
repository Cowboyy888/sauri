"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewAction } from "@/app/(shop)/account/actions";

const inputCls = "h-11 w-full border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none";

export function WriteReviewForm({ orderId, productId, productName }: { orderId: string; productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!open) return (
    <div className="flex items-center justify-between gap-3 border border-ink/10 p-3">
      <span className="font-sans text-sm">{productName}</span>
      <button type="button" onClick={() => setOpen(true)} className="font-sans text-xs uppercase tracking-widest text-ink underline-offset-4 hover:underline">Write a review</button>
    </div>
  );

  return (
    <div className="border border-ink/10 p-3">
      <p className="font-sans text-sm">{productName}</p>
      <form
        className="mt-3 grid gap-2"
        action={(fd) => start(async () => {
          setErr(null);
          const r = await createReviewAction({ orderId, productId, rating, title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? "") });
          if (r.ok) { setOpen(false); router.refresh(); } else setErr(r.error);
        })}
      >
        <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} className={n <= rating ? "text-champagne" : "text-ink/25"}>★</button>
        ))}</div>
        <input name="title" placeholder="Review title" required maxLength={120} className={inputCls} />
        <textarea name="body" placeholder="Share your experience" required rows={3} maxLength={2000} className={inputCls + " h-auto py-2"} />
        {err && <p className="font-sans text-xs text-error">{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="h-10 border border-ink/20 px-4 font-sans text-xs uppercase tracking-widest text-ink/60">Cancel</button>
          <button type="submit" disabled={pending} className="h-10 border border-ink bg-ink px-4 font-sans text-xs uppercase tracking-widest text-warm-white disabled:opacity-50">{pending ? "Submitting…" : "Submit review"}</button>
        </div>
      </form>
    </div>
  );
}
