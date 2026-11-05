/**
 * HTTP + SSE API, exactly docs/spec/API.md (B4). POST routes need `x-admin-token`; CORS is an allowlist; POSTs are
 * rate-limited per client. The app takes an ArenaApi so tests can inject a fake service.
 */
import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ArenaApi, ArenaEvent } from "./arena.ts";

export interface ServerOptions {
  adminToken: string;
  corsOrigins: string[];
  postRateLimitPerMin: number;
  ssePingMs?: number;
  clientIp?: (c: Context) => string;
}

const TX = /^0x[0-9a-fA-F]{64}$/;

function tokenOk(given: string | undefined, want: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function makeApp(arena: ArenaApi, opts: ServerOptions): Hono {
  const app = new Hono();
  const ip = opts.clientIp ?? ((c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local");
  const hits = new Map<string, { n: number; windowStart: number }>();

  app.use("*", cors({ origin: (o) => (opts.corsOrigins.includes(o) ? o : null), allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type", "x-admin-token"] }));

  // Admin + rate limit on every POST.
  app.use("*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const key = ip(c);
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.windowStart >= 60_000) hits.set(key, { n: 1, windowStart: now });
    else if (++h.n > opts.postRateLimitPerMin) return c.json({ error: "rate limited" }, 429);
    if (!tokenOk(c.req.header("x-admin-token"), opts.adminToken)) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  app.onError((err, c) => c.json({ error: err.message.split("\n")[0] }, 500));

  app.get("/health", (c) => c.json(arena.health()));
  app.get("/config", (c) => c.json(arena.config()));
  app.get("/state", async (c) => c.json(await arena.state()));
  app.get("/stats", (c) => c.json(arena.stats()));
  app.get("/trades", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
    const pool = c.req.query("pool");
    if (pool !== undefined && pool !== "aven" && pool !== "control") return c.json({ error: "pool must be aven or control" }, 400);
    return c.json(arena.trades(limit, pool));
  });
  app.get("/bot/status", async (c) => c.json(await arena.botStatus()));
  app.get("/verify/:tx", async (c) => {
    const tx = c.req.param("tx");
    if (!TX.test(tx)) return c.json({ error: "tx must be a 0x-prefixed 32-byte hash" }, 400);
    const r = await arena.verify(tx as `0x${string}`);
    return r ? c.json(r) : c.json({ error: "no FeeComputed event in this tx" }, 404);
  });

  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      const queue: Array<{ event: ArenaEvent; data: string }> = [];
      let wake: (() => void) | null = null;
      const unsubscribe = arena.subscribe((event, data) => {
        if (queue.length > 200) queue.shift(); // slow client: drop oldest, never block the service
        queue.push({ event, data: JSON.stringify(data) });
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      try {
        await stream.writeSSE({ event: "state", data: JSON.stringify(await arena.state()) });
      } catch {
        /* state unavailable right now; updates follow */
      }
      const ping = setInterval(() => {
        queue.push({ event: "bot", data: JSON.stringify({ ping: Date.now() }) });
        wake?.();
      }, opts.ssePingMs ?? 15_000);
      try {
        while (!closed) {
          while (queue.length && !closed) {
            const m = queue.shift()!;
            await stream.writeSSE({ event: m.event, data: m.data });
          }
          if (!closed) await new Promise<void>((r) => (wake = r));
          wake = null;
        }
      } finally {
        clearInterval(ping);
        unsubscribe();
      }
    }),
  );

  app.post("/shock", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sizeBase?: unknown; direction?: unknown };
    const direction = body.direction;
    if (direction !== undefined && direction !== "buyBase" && direction !== "sellBase") return c.json({ error: "direction must be buyBase or sellBase" }, 400);
    const sizeBase = body.sizeBase === undefined ? undefined : String(body.sizeBase);
    if (sizeBase !== undefined && !(Number(sizeBase) > 0)) return c.json({ error: "sizeBase must be > 0" }, 400);
    return c.json(await arena.shock({ ...(sizeBase ? { sizeBase } : {}), ...(direction ? { direction } : {}) }));
  });
  app.post("/bot/start", (c) => c.json(arena.setBot(true)));
  app.post("/bot/stop", (c) => c.json(arena.setBot(false)));
  app.post("/reset-stats", (c) => c.json(arena.resetStats()));

  return app;
}
