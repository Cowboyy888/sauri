import "server-only";
/**
 * Run a section's data load; on failure, log it and let the section render its ErrorState instead of taking the
 * whole page down (brief §44). In development, ?fail=sales,inventory forces named sections to fail so the
 * error states can be reviewed.
 */
export async function safe<T>(key: string, fn: () => Promise<T>, fail?: string): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    if (process.env.NODE_ENV !== "production" && fail?.split(",").includes(key)) throw new Error(`Simulated failure: ${key}`);
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error(`[admin:${key}]`, e);
    return { ok: false };
  }
}
