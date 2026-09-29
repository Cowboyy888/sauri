"use client";
import { useTransition } from "react";
import { setReviewStatusAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { toast } from "./toast";

/** Approve / Reject / Hide / Restore (brief §22) — only the transitions valid from the current status are
 *  offered; the server (`moderateReview`) enforces the same allow-list regardless. */
export function ReviewActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const set = (s: "published" | "rejected" | "hidden") => start(async () => { const r = await setReviewStatusAction(id, s); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); });
  return (
    <span className="inline-flex gap-1">
      {status === "pending" && <Button size="sm" variant="primary" disabled={pending} onClick={() => set("published")}>Approve</Button>}
      {status === "pending" && <Button size="sm" variant="danger" disabled={pending} onClick={() => set("rejected")}>Reject</Button>}
      {status === "published" && <Button size="sm" disabled={pending} onClick={() => set("hidden")}>Hide</Button>}
      {(status === "hidden" || status === "rejected") && <Button size="sm" variant="primary" disabled={pending} onClick={() => set("published")}>Restore</Button>}
    </span>
  );
}
