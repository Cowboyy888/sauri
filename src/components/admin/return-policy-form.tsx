"use client";
import { useState, useTransition } from "react";
import { setReturnPolicyAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { toast } from "./toast";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);
const Check = ({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) => (
  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[#2f5d50]" />{label}</label>
);

export type ReturnPolicyValue = {
  returnWindowDays: number; exchangeEnabled: boolean; refundEnabled: boolean; returnShippingPolicy: "customer" | "company" | "free";
  finalSaleTags: string[]; eligibleCategorySlugs: string[] | null;
};

export function ReturnPolicyForm({ policy, categories }: { policy: ReturnPolicyValue; categories: { slug: string; name: string }[] }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [restrict, setRestrict] = useState(policy.eligibleCategorySlugs !== null);
  return (
    <form
      className="grid max-w-2xl grid-cols-1 gap-3.5"
      action={(fd) => start(async () => {
        setErr(null);
        const selected = fd.getAll("categories").map(String);
        const r = await setReturnPolicyAction({
          returnWindowDays: s(fd, "returnWindowDays") || "0", exchangeEnabled: fd.get("exchangeEnabled") === "on", refundEnabled: fd.get("refundEnabled") === "on",
          returnShippingPolicy: s(fd, "returnShippingPolicy") as "customer", finalSaleTags: s(fd, "finalSaleTags"),
          eligibleCategorySlugs: restrict ? selected.join(",") : "",
        } as never);
        if (r.ok) toast(r.message ?? "Saved"); else setErr(r.error);
      })}
    >
      <Field label="Return window (days)" hint="How long after delivery a customer may request a return"><Input name="returnWindowDays" type="number" min={0} max={365} required defaultValue={policy.returnWindowDays} className="max-w-[140px]" /></Field>
      <div className="grid gap-2">
        <Check name="refundEnabled" label="Refunds accepted" defaultChecked={policy.refundEnabled} />
        <Check name="exchangeEnabled" label="Exchanges accepted" defaultChecked={policy.exchangeEnabled} />
      </div>
      <Field label="Return shipping" hint="Who pays for shipping the item back"><Select name="returnShippingPolicy" defaultValue={policy.returnShippingPolicy} className="max-w-[240px]"><option value="customer">Customer pays</option><option value="company">We pay</option><option value="free">Always free</option></Select></Field>
      <Field label="Final-sale tags" hint="Comma-separated product tags that are never returnable"><Input name="finalSaleTags" defaultValue={policy.finalSaleTags.join(", ")} placeholder="final-sale, clearance" /></Field>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} className="size-4 accent-[#2f5d50]" />Restrict eligible categories</label>
      {restrict && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-line-soft p-3 sm:grid-cols-3">
          {categories.map((c) => (
            <label key={c.slug} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="categories" value={c.slug} defaultChecked={policy.eligibleCategorySlugs?.includes(c.slug)} className="size-4 accent-[#2f5d50]" />{c.name}</label>
          ))}
        </div>
      )}
      <Err e={err} />
      <Button type="submit" variant="primary" disabled={pending} className="justify-self-start">{pending ? "Saving…" : "Save return policy"}</Button>
    </form>
  );
}
