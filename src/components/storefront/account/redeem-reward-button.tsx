"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { redeemRewardAction } from "@/app/(shop)/account/actions";

export function RedeemRewardButton({ rewardId, pointsCost, available }: { rewardId: string; pointsCost: number; available: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ code: string } | { error: string } | null>(null);
  const affordable = available >= pointsCost;

  if (result && "code" in result) return <p className="font-sans text-xs text-ink">Code: <b>{result.code}</b> — use it at checkout.</p>;
  return (
    <div className="text-right">
      <button
        type="button" disabled={!affordable || pending}
        onClick={() => start(async () => {
          const r = await redeemRewardAction(rewardId);
          if (r.ok && r.data) { setResult({ code: r.data.code }); router.refresh(); } else if (!r.ok) setResult({ error: r.error });
        })}
        className="h-9 border border-ink px-4 font-sans text-xs uppercase tracking-widest text-ink transition-colors hover:bg-ink hover:text-warm-white disabled:cursor-not-allowed disabled:border-ink/20 disabled:text-ink/35"
      >
        {pending ? "Redeeming…" : "Redeem"}
      </button>
      {result && "error" in result && <p className="mt-1 font-sans text-xs text-error">{result.error}</p>}
    </div>
  );
}
