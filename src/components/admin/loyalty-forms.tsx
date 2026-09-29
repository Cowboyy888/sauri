"use client";
import { useState, useTransition } from "react";
import { saveRewardAction, saveTierAction, setLoyaltySettingsAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "./toast";
import type { LoyaltyTier } from "@/lib/loyalty/service";
import type { loyaltyRewards } from "@/lib/db/schema";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);
const Check = ({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) => (
  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[#2f5d50]" />{label}</label>
);

export function LoyaltySettingsForm({ enabled, pointsPerDollar }: { enabled: boolean; pointsPerDollar: number }) {
  const [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_140px_auto]" action={(fd) => start(async () => {
      const r = await setLoyaltySettingsAction({ enabled: fd.get("enabled") === "on", pointsPerDollar: s(fd, "pointsPerDollar") || "0" });
      if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false);
    })}>
      <Check name="enabled" label="Loyalty program enabled" defaultChecked={enabled} />
      <Field label="Points per $1 spent"><Input name="pointsPerDollar" type="number" min={0} step="0.1" defaultValue={pointsPerDollar} /></Field>
      <Button type="submit" disabled={pending} className="self-end">{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

function TierForm({ tier, onDone }: { tier?: LoyaltyTier; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const benefits = (tier?.benefits ?? {}) as { bonusPointsMultiplier?: number; earlyAccess?: boolean; freeShipping?: boolean };
  return (
    <form className="grid gap-3" action={(fd) => start(async () => {
      setErr(null);
      const r = await saveTierAction({
        id: tier?.id, name: s(fd, "name"), minSpend: s(fd, "minSpend") || "0", bonusPointsMultiplier: s(fd, "bonusPointsMultiplier") || "1",
        earlyAccess: fd.get("earlyAccess") === "on", freeShipping: fd.get("freeShipping") === "on", active: fd.get("active") === "on",
      });
      if (r.ok) { toast("Saved"); onDone(); } else setErr(r.error);
    })}>
      <Field label="Name"><Input name="name" required defaultValue={tier?.name} /></Field>
      <Field label="Minimum lifetime spend (USD)"><Input name="minSpend" type="number" min={0} step="0.01" defaultValue={tier ? (tier.minSpendCents / 100).toFixed(2) : undefined} /></Field>
      <Field label="Bonus points multiplier"><Input name="bonusPointsMultiplier" type="number" min={1} step="0.1" defaultValue={benefits.bonusPointsMultiplier ?? 1} /></Field>
      <div className="grid gap-2">
        <Check name="earlyAccess" label="Early access to new arrivals" defaultChecked={benefits.earlyAccess} />
        <Check name="freeShipping" label="Free shipping" defaultChecked={benefits.freeShipping} />
        <Check name="active" label="Active" defaultChecked={tier?.active ?? true} />
      </div>
      <Err e={err} />
      <div className="flex justify-end gap-2"><Button type="button" onClick={onDone}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save tier"}</Button></div>
    </form>
  );
}
export function TierDialog({ tier, trigger }: { tier?: LoyaltyTier; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <DialogContent title={tier ? `Edit ${tier.name}` : "New tier"}><TierForm tier={tier} onDone={() => setOpen(false)} /></DialogContent>
    </Dialog>
  );
}

type Reward = typeof loyaltyRewards.$inferSelect;
function RewardForm({ reward, onDone }: { reward?: Reward; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState(reward?.rewardType ?? "fixed");
  return (
    <form className="grid gap-3" action={(fd) => start(async () => {
      setErr(null);
      const r = await saveRewardAction({
        id: reward?.id, name: s(fd, "name"), description: s(fd, "description"), pointsCost: s(fd, "pointsCost") || "0",
        rewardType: s(fd, "rewardType") as "fixed", rewardValue: s(fd, "rewardValue") || "0", active: fd.get("active") === "on",
      });
      if (r.ok) { toast("Saved"); onDone(); } else setErr(r.error);
    })}>
      <Field label="Name"><Input name="name" required defaultValue={reward?.name} placeholder="e.g. $10 off" /></Field>
      <Field label="Description"><Input name="description" defaultValue={reward?.description} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Points cost"><Input name="pointsCost" type="number" min={1} required defaultValue={reward?.pointsCost} /></Field>
        <Field label="Type"><Select name="rewardType" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="fixed">Fixed amount off</option><option value="percent">Percentage off</option><option value="free_shipping">Free shipping</option></Select></Field>
      </div>
      {type !== "free_shipping" && <Field label={type === "percent" ? "Percent off" : "Amount off (USD)"}><Input name="rewardValue" type="number" min={0} step={type === "percent" ? 1 : 0.01} defaultValue={reward ? (type === "fixed" ? reward.rewardValue / 100 : reward.rewardValue) : undefined} /></Field>}
      <Check name="active" label="Active" defaultChecked={reward?.active ?? true} />
      <Err e={err} />
      <div className="flex justify-end gap-2"><Button type="button" onClick={onDone}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save reward"}</Button></div>
    </form>
  );
}
export function RewardDialog({ reward, trigger }: { reward?: Reward; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <DialogContent title={reward ? `Edit ${reward.name}` : "New reward"}><RewardForm reward={reward} onDone={() => setOpen(false)} /></DialogContent>
    </Dialog>
  );
}
