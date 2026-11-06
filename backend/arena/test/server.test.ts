import { describe, expect, it } from "vitest";
import type { ArenaApi, ArenaEvent } from "../src/arena.ts";
import { configSchema } from "../src/config.ts";
import { makeApp } from "../src/server.ts";
import type { Breakdown, StateResponse } from "../src/types.ts";

const TOKEN = "test-admin-token";
const TX = `0x${"ab".repeat(32)}`;

function fakeArena() {
  const calls: string[] = [];
  let listener: ((e: ArenaEvent, d: unknown) => void) | null = null;
  const state: StateResponse = {
    block: 7,
    ts: 1,
    oracle: { raw: "224002", price: 2240.02 },
    mark: { raw: "224002", price: 2240.02 },
    pools: {
      control: { poolId: "0x1", price: 2240, gapBps: 0, liquidity: "1", feePreview: { fixedPips: 3000 } },
      aven: {
        poolId: "0x2",
        price: 2240,
        gapBps: 0,
        liquidity: "1",
        feePreview: {
          buyBase: { fee: 500, reason: "OK", gapBps: 0, premiumBps: 0, moveBps: 0, arb: false, withPressure: false },
          sellBase: { fee: 500, reason: "OK", gapBps: 0, premiumBps: 0, moveBps: 0, arb: false, withPressure: false },
        },
      },
    },
  };
  const api: ArenaApi = {
    health: () => ({ ok: true, chainId: 31337, block: 7, botEnabled: false, version: "t" }),
    config: () => ({ chainId: 31337 }),
    state: async () => state,
    stats: () => ({ since: 0, aven: { trades: 0, botProfitUsd: 0, lpFeeIncomeUsd: 0, volumeUsd: 0 }, control: { trades: 0, botProfitUsd: 0, lpFeeIncomeUsd: 0, volumeUsd: 0 }, lpKeptMoreUsd: 0, botProfitDiffUsd: 0 }),
    trades: (limit, pool) => {
      calls.push(`trades:${limit}:${pool ?? ""}`);
      return [];
    },
    botStatus: async () => ({ enabled: false, lastRunBlock: 0, lastError: null, balances: {} }),
    verify: async (tx) => (tx === TX ? { match: true, checkA: true, checkB: true, onchainFee: 500, recomputedFee: 500, swapEventFee: 500, inputs: {}, breakdown: (state.pools.aven.feePreview as { buyBase: Breakdown }).buyBase } : null),
    shock: async (o) => {
      calls.push(`shock:${o.sizeBase ?? ""}:${o.direction ?? ""}`);
      return { id: "s", ts: 1, sizeBase: o.sizeBase ?? "1", direction: o.direction ?? "buyBase", txHashes: [] };
    },
    setBot: (enabled) => {
      calls.push(`bot:${enabled}`);
      return { enabled };
    },
    resetStats: () => ({ since: 42 }),
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return { api, calls, emit: (e: ArenaEvent, d: unknown) => listener?.(e, d), hasListener: () => listener !== null };
}

const opts = { adminToken: TOKEN, corsOrigins: ["https://aven.example"], postRateLimitPerMin: 3 };
const post = (path: string, body?: unknown, token: string | null = TOKEN, ip = "1.1.1.1") =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { "x-admin-token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("GET routes (B4)", () => {
  it("health, config, state, stats, bot/status return the B4 shapes", async () => {
    const app = makeApp(fakeArena().api, opts);
    expect(await (await app.request("/health")).json()).toEqual({ ok: true, chainId: 31337, block: 7, botEnabled: false, version: "t" });
    expect((await app.request("/config")).status).toBe(200);
    const s = (await (await app.request("/state")).json()) as StateResponse;
    expect(s.pools.control.feePreview).toEqual({ fixedPips: 3000 });
    expect((await app.request("/stats")).status).toBe(200);
    expect((await app.request("/bot/status")).status).toBe(200);
  });
  it("trades: limit clamp and pool validation", async () => {
    const f = fakeArena();
    const app = makeApp(f.api, opts);
    await app.request("/trades");
    await app.request("/trades?limit=9999&pool=aven");
    await app.request("/trades?limit=abc");
    expect(f.calls).toEqual(["trades:50:", "trades:500:aven", "trades:50:"]);
    expect((await app.request("/trades?pool=binance")).status).toBe(400);
  });
  it("verify: 400 on a malformed hash, 404 when no FeeComputed, 200 on a match", async () => {
    const app = makeApp(fakeArena().api, opts);
    expect((await app.request("/verify/0x123")).status).toBe(400);
    expect((await app.request(`/verify/0x${"cd".repeat(32)}`)).status).toBe(404);
    const ok = await app.request(`/verify/${TX}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { match: boolean }).match).toBe(true);
  });
});

describe("admin + rate limit + CORS", () => {
  it("POSTs need the admin token", async () => {
    const f = fakeArena();
    const app = makeApp(f.api, opts);
    expect((await app.request(post("/bot/start", undefined, null))).status).toBe(401);
    expect((await app.request(post("/bot/start", undefined, "wrong-token-x", "2.2.2.2"))).status).toBe(401);
    expect((await app.request(post("/bot/start", undefined, TOKEN, "3.3.3.3"))).status).toBe(200);
    expect(f.calls).toEqual(["bot:true"]);
  });
  it("rate-limits POSTs per client (limit 3/min here; clients told apart behind a trusted proxy)", async () => {
    const app = makeApp(fakeArena().api, { ...opts, trustProxy: true });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.request(post("/reset-stats", undefined, TOKEN, "9.9.9.9"))).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect((await app.request(post("/reset-stats", undefined, TOKEN, "8.8.8.8"))).status).toBe(200); // other client unaffected
  });
  it("shock validates its body", async () => {
    const f = fakeArena();
    const app = makeApp(f.api, { ...opts, postRateLimitPerMin: 100 });
    expect((await app.request(post("/shock", { direction: "up" }))).status).toBe(400);
    expect((await app.request(post("/shock", { sizeBase: -1 }))).status).toBe(400);
    expect((await app.request(post("/shock", { sizeBase: "2.5", direction: "sellBase" }))).status).toBe(200);
    expect((await app.request(post("/shock", {}))).status).toBe(200);
    expect(f.calls).toEqual(["shock:2.5:sellBase", "shock::"]);
  });
  it("CORS: allowlisted origin echoed, others not", async () => {
    const app = makeApp(fakeArena().api, opts);
    const ok = await app.request("/health", { headers: { origin: "https://aven.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://aven.example");
    const bad = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("SSE /stream", () => {
  it("sends the current state first, then pushed events, and unsubscribes on abort", async () => {
    const f = fakeArena();
    const app = makeApp(f.api, { ...opts, ssePingMs: 60_000 });
    const ac = new AbortController();
    const res = await app.request("/stream", { signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await readUntil("event: state");
    for (let i = 0; i < 50 && !f.hasListener(); i++) await new Promise((r) => setTimeout(r, 10));
    f.emit("trade", { id: "t1" });
    await readUntil('"id":"t1"');
    expect(text).toContain("event: trade");
    ac.abort();
    await reader.cancel().catch(() => undefined);
    for (let i = 0; i < 50 && f.hasListener(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(f.hasListener()).toBe(false);
  });
});

describe("pre-mainnet hardening (audit 2026-11-06)", () => {
  it("without a trusted proxy, rotating X-Forwarded-For does NOT bypass the POST rate limit", async () => {
    const app = makeApp(fakeArena().api, opts);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.request(post("/reset-stats", undefined, TOKEN, `10.0.0.${i}`))).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
  it("behind a trusted proxy only the LAST X-Forwarded-For entry counts (the client controls the first ones)", async () => {
    const app = makeApp(fakeArena().api, { ...opts, trustProxy: true });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.request(post("/reset-stats", undefined, TOKEN, `spoof-${i}, 7.7.7.7`))).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
  it("unauthenticated POSTs are rejected before the limiter: they can't use up the admin's budget", async () => {
    const app = makeApp(fakeArena().api, opts);
    for (let i = 0; i < 10; i++) expect((await app.request(post("/bot/stop", undefined, "wrong-token-x"))).status).toBe(401);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await app.request(post("/bot/stop"))).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
  it("GET /verify/:tx is rate-limited per client (each uncached verify costs RPC calls)", async () => {
    const app = makeApp(fakeArena().api, { ...opts, verifyLimitPerMin: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.request(`/verify/${TX}`)).status);
    expect(codes).toEqual([200, 200, 429]);
  });
  it("caps concurrent SSE clients (503 beyond the cap), and frees the slot when a client leaves", async () => {
    const app = makeApp(fakeArena().api, { ...opts, ssePingMs: 60_000, maxSseClients: 1 });
    const ac = new AbortController();
    const first = await app.request("/stream", { signal: ac.signal });
    const reader = first.body!.getReader();
    await reader.read(); // the initial state event: the stream is live
    expect((await app.request("/stream")).status).toBe(503);
    ac.abort();
    await reader.cancel().catch(() => undefined);
    let status = 503;
    for (let i = 0; i < 50 && status === 503; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const ac2 = new AbortController();
      const r = await app.request("/stream", { signal: ac2.signal });
      status = r.status;
      ac2.abort();
      await r.body?.cancel().catch(() => undefined);
    }
    expect(status).toBe(200);
  });
});

describe("config (pre-mainnet audit)", () => {
  const base = { BOT_PK: `0x${"11".repeat(32)}`, SHOCK_PK: `0x${"22".repeat(32)}`, ARENA_ADMIN_TOKEN: "admin-token-123" };
  it("refuses mainnet (999) with NATIVE_USD = 0: the bot would value real gas at $0", () => {
    expect(() => configSchema.parse({ ...base, CHAIN_ID: "999" })).toThrow(/NATIVE_USD/);
    expect(() => configSchema.parse({ ...base, CHAIN_ID: "999", NATIVE_USD: "0" })).toThrow(/NATIVE_USD/);
    expect(configSchema.parse({ ...base, CHAIN_ID: "999", NATIVE_USD: "78.46", ARENA_ADMIN_TOKEN: "x".repeat(24) }).NATIVE_USD).toBe(78.46);
    expect(configSchema.parse({ ...base, CHAIN_ID: "998" }).NATIVE_USD).toBe(0); // testnet HYPE has no value
  });
  it("refuses a short admin token on mainnet (it guards actions that spend real gas)", () => {
    expect(() => configSchema.parse({ ...base, CHAIN_ID: "999", NATIVE_USD: "78.46" })).toThrow(/ARENA_ADMIN_TOKEN/); // 15 chars
    expect(configSchema.parse({ ...base, CHAIN_ID: "999", NATIVE_USD: "78.46", ARENA_ADMIN_TOKEN: "a".repeat(24) }).CHAIN_ID).toBe(999);
    expect(configSchema.parse({ ...base, CHAIN_ID: "998" }).ARENA_ADMIN_TOKEN).toBe("admin-token-123"); // testnet: 8+ is enough
  });
  it("ARENA_TRUST_PROXY is off unless set to 1/true", () => {
    expect(configSchema.parse(base).ARENA_TRUST_PROXY).toBe(false);
    expect(configSchema.parse({ ...base, ARENA_TRUST_PROXY: "1" }).ARENA_TRUST_PROXY).toBe(true);
    expect(configSchema.parse({ ...base, ARENA_TRUST_PROXY: "no" }).ARENA_TRUST_PROXY).toBe(false);
  });
});
