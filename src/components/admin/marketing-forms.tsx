"use client";
import { useState, useTransition } from "react";
import {
  createCampaignAction, updateCampaignAction, setCampaignStatusAction, logCampaignCostAction,
  savePromotionAction, setPromotionActiveAction, deletePromotionAction,
  createEmailCampaignAction, sendEmailCampaignNowAction, cancelEmailCampaignAction,
  sendAbandonedCartRecoveryAction, setMarketingSettingsAction,
} from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "./toast";
import { buildCampaignUrl } from "@/lib/marketing/campaigns";
import type { CampaignRow, CampaignStatus } from "@/lib/marketing/campaigns";
import type { MarketingSettings } from "@/lib/marketing/settings";
import { SEGMENT_LABELS } from "@/lib/crm/segments";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const sa = (fd: FormData, k: string) => fd.getAll(k).map(String).join(",");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);

/* ------------------------------------------------------------------ campaigns */
export function NewCampaignButton() {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant="primary" onClick={() => setOpen(true)}>New campaign</Button>
      <DialogContent title="New campaign" description="The campaign ID is matched against utm_campaign, case-insensitively.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await createCampaignAction({ name: s(fd, "name"), slug: s(fd, "slug"), source: s(fd, "source"), medium: s(fd, "medium"), budget: s(fd, "budget"), description: s(fd, "description"), startDate: s(fd, "startDate"), endDate: s(fd, "endDate") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Created"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Campaign name"><Input name="name" required placeholder="Summer Sale" /></Field>
            <Field label="Campaign ID" hint="Matches utm_campaign"><Input name="slug" required placeholder="SUMMER2026" style={{ textTransform: "uppercase" }} /></Field>
            <Field label="Source"><Input name="source" required placeholder="instagram" /></Field>
            <Field label="Medium"><Input name="medium" required placeholder="social" /></Field>
            <Field label="Budget (USD)"><Input name="budget" type="number" min={0} step="0.01" /></Field>
            <Field label="Start date"><Input name="startDate" type="date" /></Field>
            <Field label="End date"><Input name="endDate" type="date" /></Field>
          </div>
          <Field label="Description"><Textarea name="description" rows={2} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditCampaignButton({ campaign }: { campaign: CampaignRow }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Edit</Button>
      <DialogContent title={`Edit ${campaign.name}`}>
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await updateCampaignAction(campaign.id, { name: s(fd, "name"), slug: campaign.slug, source: s(fd, "source"), medium: s(fd, "medium"), budget: s(fd, "budget"), description: s(fd, "description"), startDate: s(fd, "startDate"), endDate: s(fd, "endDate") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Updated"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Campaign name"><Input name="name" required defaultValue={campaign.name} /></Field>
            <Field label="Campaign ID"><Input value={campaign.slug} disabled /></Field>
            <Field label="Source"><Input name="source" required defaultValue={campaign.source} /></Field>
            <Field label="Medium"><Input name="medium" required defaultValue={campaign.medium} /></Field>
            <Field label="Budget (USD)"><Input name="budget" type="number" min={0} step="0.01" defaultValue={campaign.budgetCents != null ? campaign.budgetCents / 100 : undefined} /></Field>
            <Field label="Start date"><Input name="startDate" type="date" defaultValue={campaign.startDate ? new Date(campaign.startDate).toISOString().slice(0, 10) : undefined} /></Field>
            <Field label="End date"><Input name="endDate" type="date" defaultValue={campaign.endDate ? new Date(campaign.endDate).toISOString().slice(0, 10) : undefined} /></Field>
          </div>
          <Field label="Description"><Textarea name="description" rows={2} defaultValue={campaign.description} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEXT_STATUS: Record<CampaignStatus, CampaignStatus[]> = { DRAFT: ["ACTIVE", "ARCHIVED"], ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"], PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"], COMPLETED: ["ARCHIVED"], ARCHIVED: [] };
export function CampaignStatusControl({ id, status }: { id: string; status: CampaignStatus }) {
  const [pending, start] = useTransition();
  const options = NEXT_STATUS[status];
  if (!options.length) return <span className="text-xs text-subtle">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((next) => (
        <Button key={next} size="sm" disabled={pending} onClick={() => start(async () => { const r = await setCampaignStatusAction(id, next); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error, false); })}>
          {next.charAt(0) + next.slice(1).toLowerCase()}
        </Button>
      ))}
    </div>
  );
}

export function LogCostButton({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Log spend</Button>
      <DialogContent title="Log campaign spend" description="Manually entered actual spend (brief §28) — never fabricated.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await logCampaignCostAction({ campaignId, amount: s(fd, "amount"), incurredAt: s(fd, "incurredAt"), note: s(fd, "note") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Logged"); } else setErr(r.error);
        })}>
          <Field label="Amount (USD)"><Input name="amount" type="number" min={0.01} step="0.01" required /></Field>
          <Field label="Date"><Input name="incurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="Note"><Input name="note" maxLength={300} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Log spend</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignUrlBuilder({ campaigns }: { campaigns: CampaignRow[] }) {
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        setErr(null);
        setResult(buildCampaignUrl({ url: s(fd, "url"), source: s(fd, "source"), medium: s(fd, "medium"), campaign: s(fd, "campaign"), term: s(fd, "term"), content: s(fd, "content") }));
      } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Invalid input."); setResult(null); }
    }}>
      <Field label="Destination URL"><Input name="url" required placeholder="https://sauri.example/collections/rings" /></Field>
      <Field label="Campaign"><Select name="campaign" required defaultValue=""><option value="" disabled>Choose a campaign</option>{campaigns.map((c) => <option key={c.id} value={c.slug}>{c.name} ({c.slug})</option>)}</Select></Field>
      <Field label="Source"><Input name="source" required placeholder="instagram" /></Field>
      <Field label="Medium"><Input name="medium" required placeholder="social" /></Field>
      <Field label="Term (optional)"><Input name="term" /></Field>
      <Field label="Content (optional)"><Input name="content" /></Field>
      <div className="sm:col-span-2"><Button type="submit" variant="primary">Generate URL</Button></div>
      {err && <p className="sm:col-span-2 text-[13px] text-neg">{err}</p>}
      {result && (
        <div className="sm:col-span-2 flex items-center gap-2 rounded-md border border-line bg-canvas p-3">
          <code className="min-w-0 flex-1 truncate text-[12.5px]">{result}</code>
          <Button type="button" size="sm" onClick={() => { navigator.clipboard?.writeText(result); toast("Copied"); }}>Copy</Button>
        </div>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ promotions & coupons */
export type PromotionFormOption = { id: string; name: string };
export function PromotionFormButton({ mode, initial, products, collections, campaigns, label }: {
  mode: "create" | "edit"; label: string;
  initial?: { id: string; code: string; name: string | null; type: string; value: number; eligibleProductIds: string[]; eligibleCollectionIds: string[]; eligibleSegments: string[]; firstOrderOnly: boolean; minSubtotalCents: number; maxDiscountCents: number | null; usageLimit: number | null; perCustomerLimit: number | null; campaignId: string | null };
  products: PromotionFormOption[]; collections: PromotionFormOption[]; campaigns: PromotionFormOption[];
}) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [type, setType] = useState(initial?.type ?? "percent");
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant={mode === "create" ? "primary" : "secondary"} size={mode === "create" ? "md" : "sm"} onClick={() => setOpen(true)}>{label}</Button>
      <DialogContent title={mode === "create" ? "New promotion" : "Edit promotion"} description="Every rule below is enforced server-side at checkout.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await savePromotionAction({
            id: initial?.id, name: s(fd, "name"), code: s(fd, "code"), type: s(fd, "type") as "percent", value: s(fd, "value") || "0",
            eligibleProductIds: sa(fd, "eligibleProductIds"), eligibleCollectionIds: sa(fd, "eligibleCollectionIds"), eligibleSegments: fd.getAll("eligibleSegments").map(String),
            firstOrderOnly: fd.get("firstOrderOnly") === "on", minSubtotal: s(fd, "min"), maxDiscount: s(fd, "max"),
            usageLimit: s(fd, "limit"), perCustomerLimit: s(fd, "per"), campaignId: s(fd, "campaignId"),
          } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Internal name"><Input name="name" defaultValue={initial?.name ?? ""} maxLength={120} /></Field>
            <Field label="Code"><Input name="code" required disabled={mode === "edit"} defaultValue={initial?.code} pattern="[A-Za-z0-9]{3,20}" style={{ textTransform: "uppercase" }} placeholder="SUMMER2026" /></Field>
            <Field label="Type"><Select name="type" value={type} onChange={(e) => setType(e.target.value)}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option><option value="free_shipping">Free shipping</option></Select></Field>
            {type !== "free_shipping" && <Field label={type === "percent" ? "Percent off" : "Amount off (USD)"}><Input name="value" type="number" min={type === "percent" ? 1 : 0.01} max={type === "percent" ? 100 : undefined} step={type === "percent" ? 1 : "0.01"} defaultValue={initial ? (type === "fixed" ? initial.value / 100 : initial.value) : undefined} required /></Field>}
            <Field label="Minimum order (USD)"><Input name="min" type="number" min={0} step="0.01" defaultValue={initial ? initial.minSubtotalCents / 100 : undefined} /></Field>
            <Field label="Maximum discount (USD)"><Input name="max" type="number" min={0} step="0.01" defaultValue={initial?.maxDiscountCents != null ? initial.maxDiscountCents / 100 : undefined} /></Field>
            <Field label="Total uses"><Input name="limit" type="number" min={1} defaultValue={initial?.usageLimit ?? undefined} placeholder="Unlimited" /></Field>
            <Field label="Uses per customer"><Input name="per" type="number" min={1} defaultValue={initial?.perCustomerLimit ?? undefined} placeholder="Unlimited" /></Field>
            <Field label="Linked campaign"><Select name="campaignId" defaultValue={initial?.campaignId ?? ""}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          </div>
          <Field label="Eligible products" hint="Leave empty for all products"><Select name="eligibleProductIds" multiple size={4} className="h-auto py-1" defaultValue={initial?.eligibleProductIds}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Eligible collections" hint="Leave empty for all collections"><Select name="eligibleCollectionIds" multiple size={3} className="h-auto py-1" defaultValue={initial?.eligibleCollectionIds}>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Eligible customer segments" hint="Leave empty for everyone"><Select name="eligibleSegments" multiple size={4} className="h-auto py-1" defaultValue={initial?.eligibleSegments}>{Object.entries(SEGMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="firstOrderOnly" defaultChecked={initial?.firstOrderOnly} /> First-order customers only</label>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{mode === "create" ? "Create" : "Save"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PromotionActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await setPromotionActiveAction(id, !active); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); })}>{active ? "Pause" : "Activate"}</Button>;
}
export function DeletePromotionButton({ id, usedCount }: { id: string; usedCount: number }) {
  const [pending, start] = useTransition();
  if (usedCount > 0) return null;
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await deletePromotionAction(id); if (r.ok) toast(r.message ?? "Deleted"); else toast(r.error, false); })}>Delete</Button>;
}

/* ------------------------------------------------------------------ email campaigns */
export function NewEmailCampaignButton({ categories, campaigns }: { categories: PromotionFormOption[]; campaigns: PromotionFormOption[] }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [audienceType, setAudienceType] = useState("segment");
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant="primary" onClick={() => setOpen(true)}>New email</Button>
      <DialogContent title="New email campaign" description="Only sent to customers with marketing consent, checked again at send time.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await createEmailCampaignAction({ name: s(fd, "name"), subject: s(fd, "subject"), previewText: s(fd, "previewText"), content: s(fd, "content"), audienceType: s(fd, "audienceType"), segmentKey: s(fd, "segmentKey"), categoryId: s(fd, "categoryId"), campaignId: s(fd, "campaignId") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Created"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Linked campaign (optional)"><Select name="campaignId" defaultValue=""><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Subject"><Input name="subject" required maxLength={200} /></Field>
            <Field label="Preview text"><Input name="previewText" maxLength={200} /></Field>
            <Field label="Audience">
              <Select name="audienceType" value={audienceType} onChange={(e) => setAudienceType(e.target.value)}>
                <option value="segment">Customer segment</option>
                <option value="loyalty_members">Loyalty members</option>
                <option value="bought_category">Bought a category</option>
                <option value="has_wishlist_items">Has wishlist items</option>
              </Select>
            </Field>
            {audienceType === "segment" && <Field label="Segment"><Select name="segmentKey"><option value="">Choose</option>{Object.entries(SEGMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>}
            {audienceType === "bought_category" && <Field label="Category"><Select name="categoryId"><option value="">Choose</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          </div>
          <Field label="Content"><Textarea name="content" rows={6} required /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Create draft</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function SendEmailCampaignButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => { const r = await sendEmailCampaignNowAction(id); if (r.ok) toast(r.message ?? "Sent"); else toast(r.error, false); })}>Send now</Button>;
}
export function CancelEmailCampaignButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await cancelEmailCampaignAction(id); if (r.ok) toast(r.message ?? "Cancelled"); else toast(r.error, false); })}>Cancel</Button>;
}

/* ------------------------------------------------------------------ abandoned cart & settings */
export function SendRecoveryButton({ cartId }: { cartId: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await sendAbandonedCartRecoveryAction(cartId); if (r.ok) toast(r.message ?? "Sent"); else toast(r.error, false); })}>Send recovery email</Button>;
}

export function MarketingSettingsForm({ settings }: { settings: MarketingSettings }) {
  const [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" action={(fd) => start(async () => {
      const r = await setMarketingSettingsAction({
        attributionModel: s(fd, "attributionModel"), allowLoyaltyWithCoupon: fd.get("allowLoyaltyWithCoupon") === "on",
        allowRewardWithPromotion: fd.get("allowRewardWithPromotion") === "on", allowFreeShippingRewardWithCoupon: fd.get("allowFreeShippingRewardWithCoupon") === "on",
        abandonedCartAutomationEnabled: fd.get("abandonedCartAutomationEnabled") === "on",
      } as never);
      if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false);
    })}>
      <Field label="Attribution model" hint="LINEAR and POSITION_BASED are not yet implemented (docs/ATTRIBUTION.md)">
        <Select name="attributionModel" defaultValue={settings.attributionModel}><option value="LAST_TOUCH">Last touch</option><option value="FIRST_TOUCH">First touch</option></Select>
      </Field>
      <div className="grid gap-2 self-end">
        <p className="text-[13px] font-medium">Discount stacking policy</p>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="allowLoyaltyWithCoupon" defaultChecked={settings.stacking.allowLoyaltyWithCoupon} /> Allow loyalty points with a coupon</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="allowRewardWithPromotion" defaultChecked={settings.stacking.allowRewardWithPromotion} /> Allow a loyalty reward with a promotion</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="allowFreeShippingRewardWithCoupon" defaultChecked={settings.stacking.allowFreeShippingRewardWithCoupon} /> Allow a free-shipping reward with a coupon</label>
      </div>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="abandonedCartAutomationEnabled" defaultChecked={settings.abandonedCartAutomation.enabled} /> Enable abandoned-cart recovery automation (requires a scheduler — see docs/MARKETING.md)</label>
      <div><Button type="submit" variant="primary" disabled={pending}>Save marketing settings</Button></div>
    </form>
  );
}
