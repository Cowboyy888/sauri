"use client";
import { useTransition } from "react";
import { setCrmSettingsAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { toast } from "./toast";
import type { CrmSettings } from "@/lib/crm/segments";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export function CrmSettingsForm({ settings }: { settings: CrmSettings }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      action={(fd) => start(async () => {
        const r = await setCrmSettingsAction({
          newCustomerDays: s(fd, "newCustomerDays"), inactiveDays: s(fd, "inactiveDays"), highValueThresholdCents: (Number(s(fd, "highValueThreshold")) * 100).toString(),
          recentPurchaserDays: s(fd, "recentPurchaserDays"), frequentBuyerDays: s(fd, "frequentBuyerDays"), frequentBuyerMinOrders: s(fd, "frequentBuyerMinOrders"),
          recencyRecentMaxDays: s(fd, "recencyRecentMaxDays"), recencyAtRiskMinDays: s(fd, "recencyAtRiskMinDays"), recencyInactiveMinDays: s(fd, "recencyInactiveMinDays"),
          frequencyFrequentMinOrders: s(fd, "frequencyFrequentMinOrders"), monetaryHighValueCents: (Number(s(fd, "monetaryHighValue")) * 100).toString(),
        } as never);
        if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false);
      })}
    >
      <Field label="New customer window (days)"><Input name="newCustomerDays" type="number" min={0} defaultValue={settings.newCustomerDays} /></Field>
      <Field label="Inactive after (days)"><Input name="inactiveDays" type="number" min={0} defaultValue={settings.inactiveDays} /></Field>
      <Field label="High-value threshold (USD)"><Input name="highValueThreshold" type="number" min={0} step="0.01" defaultValue={(settings.highValueThresholdCents / 100).toFixed(2)} /></Field>
      <Field label="Recent-purchaser window (days)"><Input name="recentPurchaserDays" type="number" min={0} defaultValue={settings.recentPurchaserDays} /></Field>
      <Field label="Frequent-buyer window (days)"><Input name="frequentBuyerDays" type="number" min={0} defaultValue={settings.frequentBuyerDays} /></Field>
      <Field label="Frequent-buyer min. orders"><Input name="frequentBuyerMinOrders" type="number" min={1} defaultValue={settings.frequentBuyerMinOrders} /></Field>
      <Field label="RFM: Recent if ≤ (days)"><Input name="recencyRecentMaxDays" type="number" min={0} defaultValue={settings.rfm.recencyRecentMaxDays} /></Field>
      <Field label="RFM: At Risk if ≥ (days)"><Input name="recencyAtRiskMinDays" type="number" min={0} defaultValue={settings.rfm.recencyAtRiskMinDays} /></Field>
      <Field label="RFM: Inactive if ≥ (days)"><Input name="recencyInactiveMinDays" type="number" min={0} defaultValue={settings.rfm.recencyInactiveMinDays} /></Field>
      <Field label="RFM: Frequent min. orders"><Input name="frequencyFrequentMinOrders" type="number" min={1} defaultValue={settings.rfm.frequencyFrequentMinOrders} /></Field>
      <Field label="RFM: High-value threshold (USD)"><Input name="monetaryHighValue" type="number" min={0} step="0.01" defaultValue={(settings.rfm.monetaryHighValueCents / 100).toFixed(2)} /></Field>
      <Button type="submit" variant="primary" disabled={pending} className="self-end justify-self-start">{pending ? "Saving…" : "Save thresholds"}</Button>
    </form>
  );
}
