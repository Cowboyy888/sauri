"use client";
/**
 * Client-side event capture (brief §46, §49) — mirrors the existing AttributionCapture pattern: no
 * interpretation happens here, everything is just copied from the current page and sent to
 * /api/marketing/events, fire-and-forget. `sauri_session` is a rolling 30-minute-idle session id, entirely
 * separate from the (90-day, overwritten-only-on-a-fresh-signal) attribution cookie.
 */
const SESSION_COOKIE = "sauri_session";
const SESSION_MAX_AGE_MIN = 30;

function readCookie(name: string): string | undefined {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

function sessionId(): string {
  const existing = readCookie(SESSION_COOKIE);
  const id = existing || crypto.randomUUID();
  writeCookie(SESSION_COOKIE, id, SESSION_MAX_AGE_MIN * 60); // refresh on every event: rolling idle window
  return id;
}

export type TrackType =
  | "page_view" | "product_viewed" | "collection_viewed" | "search" | "wishlist_added" | "cart_added" | "cart_removed"
  | "coupon_applied" | "coupon_failed" | "promotion_viewed" | "email_clicked";

export type TrackData = {
  productId?: string; collectionId?: string; searchQuery?: string; resultsCount?: number; metadata?: Record<string, unknown>;
};

export function track(type: TrackType, data: TrackData = {}) {
  try {
    const params = new URLSearchParams(window.location.search);
    const payload = {
      eventId: crypto.randomUUID(), sessionId: sessionId(), type,
      path: window.location.pathname, referrer: document.referrer || undefined,
      utmSource: params.get("utm_source") ?? undefined, utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined, utmTerm: params.get("utm_term") ?? undefined, utmContent: params.get("utm_content") ?? undefined,
      ...data,
    };
    const body = JSON.stringify({ events: [payload] });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/marketing/events", new Blob([body], { type: "application/json" }));
    else fetch("/api/marketing/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Analytics is best-effort; never let it affect the page.
  }
}
