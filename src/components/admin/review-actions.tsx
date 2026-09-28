"use client";
import { useTransition } from "react";
import { setReviewStatusAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { toast } from "./toast";

export function ReviewActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const set = (s: "published" | "hidden") => start(async () => { const r = await setReviewStatusAction(id, s); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); });
  return (
    <span className="inline-flex gap-1">
      {status !== "published" && <Button size="sm" variant="primary" disabled={pending} onClick={() => set("published")}>Publish</Button>}
      {status !== "hidden" && <Button size="sm" disabled={pending} onClick={() => set("hidden")}>Hide</Button>}
    </span>
  );
}
