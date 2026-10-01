"use client";
import { useEffect } from "react";
import { track } from "@/lib/storefront/track-client";

/** Only fires when the slug resolves to a real `collections` row (brief §12) — category pages and virtual
 *  nav entries like "All Jewelry" are out of scope for /admin/analytics/collections; see docs/PHASE_7_AUDIT.md. */
export function TrackCollectionView({ collectionId }: { collectionId?: string }) {
  useEffect(() => { if (collectionId) track("collection_viewed", { collectionId }); }, [collectionId]);
  return null;
}
