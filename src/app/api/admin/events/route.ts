import { Client } from "pg";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { EVENTS_CHANNEL } from "@/lib/audit";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events for the dashboard. Business transactions call pg_notify('sauri_events') and Postgres
 * delivers them here only after COMMIT. One LISTEN connection per open admin tab.
 * On Supabase use the Session pooler or direct connection (LISTEN does not work through the Transaction pooler).
 */
export const GET = route(async (req: Request) => {
  await requireStaff(getDb(), "dashboard:read");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const enc = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = async () => { if (heartbeat) clearInterval(heartbeat); client.removeAllListeners(); await client.end().catch(() => {}); };
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (s: string) => { try { ctrl.enqueue(enc.encode(s)); } catch { void close(); } };
      client.on("notification", (m) => { if (m.payload) send(`data: ${m.payload}\n\n`); });
      client.on("error", () => { void close(); try { ctrl.close(); } catch { /* closed */ } });
      await client.query(`LISTEN ${EVENTS_CHANNEL}`);
      send(`retry: 5000\ndata: {"type":"hello"}\n\n`);
      heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      req.signal.addEventListener("abort", () => { void close(); try { ctrl.close(); } catch { /* closed */ } });
    },
    cancel: () => close(),
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
});
