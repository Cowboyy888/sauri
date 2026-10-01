"use client";
import { useEffect } from "react";
import { track } from "@/lib/storefront/track-client";

/** One `search` event per real query (brief §36-38); the query itself is short, customer-entered text —
 *  not sensitive, and already visible in the page URL. */
export function TrackSearch({ query, resultsCount }: { query: string; resultsCount: number }) {
  useEffect(() => { if (query.trim().length >= 2) track("search", { searchQuery: query.trim(), resultsCount }); }, [query, resultsCount]);
  return null;
}
