"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReturnRequestAction } from "@/app/(shop)/account/actions";

const inputCls = "h-11 w-full border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none";
const labelCls = "font-sans text-xs uppercase tracking-widest text-ink/50";
const REASONS: [string, string][] = [["wrong_size", "Wrong size"], ["changed_mind", "Changed my mind"], ["damaged", "Arrived damaged"], ["defective", "Defective"], ["wrong_item", "Wrong item received"], ["not_as_expected", "Not as expected"], ["other", "Other"]];

export type EligibleItem = { orderItemId: string; productName: string; sku: string; variant: string; remaining: number; eligible: boolean; reason: string | null };
type Line = { selected: boolean; quantity: number; reason: string; description: string; photoUrls: string };

export function ReturnRequestForm({ orderId, items }: { orderId: string; items: EligibleItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(items.map((i) => [i.orderItemId, { selected: false, quantity: i.remaining, reason: "wrong_size", description: "", photoUrls: "" }])));
  const patch = (id: string, p: Partial<Line>) => setLines((s) => ({ ...s, [id]: { ...s[id]!, ...p } }));

  const eligibleItems = items.filter((i) => i.eligible);
  const ineligibleItems = items.filter((i) => !i.eligible);

  const submit = () => start(async () => {
    setErr(null);
    const chosen = eligibleItems.filter((i) => lines[i.orderItemId]!.selected);
    if (!chosen.length) { setErr("Select at least one item to return."); return; }
    const r = await createReturnRequestAction({
      orderId,
      items: chosen.map((i) => {
        const l = lines[i.orderItemId]!;
        return {
          orderItemId: i.orderItemId, quantity: l.quantity, reason: l.reason as "wrong_size", description: l.description || undefined,
          photoUrls: l.photoUrls.split(/\s+/).map((s) => s.trim()).filter(Boolean),
        };
      }),
      customerNotes: notes || undefined,
    } as never);
    if (r.ok) router.push(`/account/orders/${orderId}`); else setErr(r.error);
  });

  return (
    <div className="grid gap-6">
      {ineligibleItems.length > 0 && (
        <div className="border border-ink/10 bg-canvas p-3 font-sans text-xs text-ink/50">
          {ineligibleItems.map((i) => <p key={i.orderItemId}>{i.productName} — {i.reason}</p>)}
        </div>
      )}
      {eligibleItems.map((i) => {
        const l = lines[i.orderItemId]!;
        return (
          <div key={i.orderItemId} className="border border-ink/15 p-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={l.selected} onChange={(e) => patch(i.orderItemId, { selected: e.target.checked })} className="mt-1 size-4" />
              <span className="font-sans text-sm">
                <span className="block text-ink">{i.productName}</span>
                <span className="block text-ink/50">{i.variant} · {i.sku} · up to {i.remaining} unit{i.remaining === 1 ? "" : "s"}</span>
              </span>
            </label>
            {l.selected && (
              <div className="mt-3 grid gap-3 pl-7">
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1"><span className={labelCls}>Quantity</span>
                    <input type="number" min={1} max={i.remaining} value={l.quantity} onChange={(e) => patch(i.orderItemId, { quantity: Number(e.target.value) })} className={inputCls} />
                  </label>
                  <label className="grid gap-1"><span className={labelCls}>Reason</span>
                    <select value={l.reason} onChange={(e) => patch(i.orderItemId, { reason: e.target.value })} className={inputCls}>
                      {REASONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="grid gap-1"><span className={labelCls}>Description (optional)</span>
                  <textarea rows={2} value={l.description} onChange={(e) => patch(i.orderItemId, { description: e.target.value })} className={inputCls + " h-auto py-2"} />
                </label>
                <label className="grid gap-1"><span className={labelCls}>Photo URLs (optional, one per line)</span>
                  <textarea rows={2} value={l.photoUrls} onChange={(e) => patch(i.orderItemId, { photoUrls: e.target.value })} placeholder="https://…" className={inputCls + " h-auto py-2"} />
                </label>
              </div>
            )}
          </div>
        );
      })}
      <label className="grid gap-1"><span className={labelCls}>Anything else we should know? (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls + " h-auto py-2"} />
      </label>
      {err && <p className="font-sans text-sm text-error">{err}</p>}
      <button type="button" disabled={pending} onClick={submit} className="h-11 border border-ink bg-ink px-6 font-sans text-xs uppercase tracking-widest text-warm-white transition-colors hover:bg-ink/85 disabled:opacity-50">
        {pending ? "Submitting…" : "Submit return request"}
      </button>
    </div>
  );
}
