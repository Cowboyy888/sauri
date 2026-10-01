"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/storefront/track-client";

/** Fires one `page_view` per navigation — the basis for "sessions" and every funnel/conversion-rate figure
 *  (brief §9, §33). Reads the query string from `window.location` (not `useSearchParams()`, which would
 *  force this component under a Suspense boundary) — same approach as AttributionCapture. */
export function AnalyticsCapture() {
  const pathname = usePathname();
  useEffect(() => { track("page_view"); }, [pathname]);
  return null;
}
