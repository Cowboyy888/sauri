/**
 * Customer acquisition attribution (brief §8-9). The client only ever copies `document.referrer` and the
 * current URL's query string into a cookie (`components/storefront/attribution-capture.tsx`) — all
 * interpretation (which enum source that maps to) happens here, server-side, at read time. This keeps the
 * mapping logic in one place and out of the client bundle. See docs/CRM.md.
 */
import "server-only";
import { cookies } from "next/headers";

export const ATTRIBUTION_COOKIE = "sauri_attribution";

export type AttributionSource = "WEBSITE" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "GOOGLE" | "REFERRAL" | "PHYSICAL_STORE" | "WHOLESALE" | "DIRECT" | "EMAIL" | "OTHER";
export type AttributionDetails = { utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string; referrer?: string };
export type Attribution = { source: AttributionSource; details: AttributionDetails };

const SOURCE_HOSTS: [RegExp, AttributionSource][] = [
  [/instagram/i, "INSTAGRAM"], [/facebook|fb\.com/i, "FACEBOOK"], [/tiktok/i, "TIKTOK"], [/google/i, "GOOGLE"],
];

/** Maps whatever the client captured into one of the fixed acquisition-source values (brief §8). `utm_medium
 *  = email` (brief §22-25's email campaigns) beats everything else, since a "source" value for an email
 *  send is often the campaign name itself, not a recognizable platform. A `ref` query param (an affiliate/
 *  referral link) beats a bare referrer; an unrecognized external referrer with no UTM data is "REFERRAL";
 *  no referrer and no UTM at all is "DIRECT" (typed the URL, opened a bookmark). */
export function classifyAttribution(details: AttributionDetails, ownHost: string): AttributionSource {
  if (details.utmMedium?.toLowerCase() === "email") return "EMAIL";
  const utmSource = details.utmSource?.toLowerCase();
  if (utmSource) { for (const [re, source] of SOURCE_HOSTS) if (re.test(utmSource)) return source; return "OTHER"; }
  if (details.referrer) {
    try {
      const refHost = new URL(details.referrer).hostname;
      if (refHost === ownHost) return "DIRECT"; // internal navigation, not a new touch
      for (const [re, source] of SOURCE_HOSTS) if (re.test(refHost)) return source;
      return "REFERRAL";
    } catch { /* not a valid URL — fall through to DIRECT */ }
  }
  return "DIRECT";
}

/** Reads and interprets the attribution cookie set by the client on this request, if any. */
export async function readAttribution(ownHost: string): Promise<Attribution | null> {
  const raw = (await cookies()).get(ATTRIBUTION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const details = JSON.parse(decodeURIComponent(raw)) as AttributionDetails;
    return { source: classifyAttribution(details, ownHost), details };
  } catch {
    return null;
  }
}
