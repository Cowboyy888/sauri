"use client";
import { useEffect } from "react";

const COOKIE = "sauri_attribution";
const MAX_AGE_DAYS = 90;

/** Copies `document.referrer` and `?utm_*`/`?ref` into a cookie the server can read at checkout — no
 *  interpretation happens here (see lib/storefront/attribution.ts). Only overwrites the cookie when this
 *  page load carries a fresh, meaningful signal (a UTM param, or a referrer from a different site), so
 *  clicking around the store afterward doesn't erase the original attribution. */
export function AttributionCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const utmSource = params.get("utm_source") ?? undefined;
      const utmMedium = params.get("utm_medium") ?? undefined;
      const utmCampaign = params.get("utm_campaign") ?? undefined;
      const utmTerm = params.get("utm_term") ?? undefined;
      const utmContent = params.get("utm_content") ?? undefined;
      const ref = params.get("ref") ?? undefined;
      const referrer = document.referrer || undefined;
      const ownHost = window.location.hostname;
      const referrerIsExternal = referrer && (() => { try { return new URL(referrer).hostname !== ownHost; } catch { return false; } })();
      const hasSignal = !!(utmSource || ref || referrerIsExternal);
      const already = document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`));
      if (!hasSignal && already) return;
      const details = { utmSource: utmSource ?? ref, utmMedium, utmCampaign, utmTerm, utmContent, referrer };
      document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(details))}; path=/; max-age=${MAX_AGE_DAYS * 86400}; samesite=lax`;
    } catch {
      // Attribution is best-effort; never let a cookie failure affect the page.
    }
  }, []);
  return null;
}
