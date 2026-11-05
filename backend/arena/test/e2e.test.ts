/**
 * PLAN 4.4 gate, end to end on a local anvil chain (mock precompiles, the real deploy scripts, the real Arena):
 * shock -> bot trades both pools -> the Aven trade pays a higher fee than the control trade for the same gap ->
 * /stats lpKeptMoreUsd > 0 -> /verify/:tx MATCH (A and B). Also: persistence reload. Runs only with E2E=1.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalChain, type LocalChain } from "@aven/scripts/src/localChain.ts";
import { Arena } from "../src/arena.ts";
import { makeChain } from "../src/chain.ts";
import { configSchema, type ArenaConfig } from "../src/config.ts";
import { makeApp } from "../src/server.ts";
import type { Shock, StateResponse, Stats, Trade, VerifyResult } from "../src/types.ts";

const TOKEN = "e2e-admin-token";
const enabled = process.env.E2E === "1";

describe.skipIf(!enabled)("arena e2e on a local chain", () => {
  let chain: LocalChain;
  let arena: Arena;
  let cfg: ArenaConfig;
  let app: ReturnType<typeof makeApp>;
  const auth = { "x-admin-token": TOKEN, "content-type": "application/json" };

  beforeAll(async () => {
    chain = await startLocalChain({ port: 8546, quiet: true });
    const dataDir = mkdtempSync(join(tmpdir(), "aven-arena-"));
    const parsed = configSchema.parse({
      BOT_PK: chain.keyOf(chain.bot),
      SHOCK_PK: chain.keyOf(chain.shock),
      HYPEREVM_RPC: chain.rpcUrl,
      CHAIN_ID: "31337",
      ARENA_ADMIN_TOKEN: TOKEN,
      MAX_TRADE_BASE: "100",
      MAX_TRADE_QUOTE: "250000",
      SHOCK_QUOTE: "40000",
      POLL_MS: "250",
      DATA_DIR: dataDir,
    });
    cfg = { ...parsed, corsOrigins: [] };
    arena = new Arena(cfg, makeChain({ rpcUrl: chain.rpcUrl, chainId: 31337, botPk: cfg.BOT_PK as `0x${string}`, shockPk: cfg.SHOCK_PK as `0x${string}`, deployments: chain.deployments }));
    await arena.start();
    app = makeApp(arena, { adminToken: TOKEN, corsOrigins: [], postRateLimitPerMin: 100 });
  }, 600_000);

  afterAll(async () => {
    arena?.stop();
    await chain?.stop();
  });

  it("shock -> bot taxes the arb on Aven -> LPs keep more -> verify MATCH", async () => {
    expect((await app.request("/reset-stats", { method: "POST", headers: auth })).status).toBe(200);

    // Shock: identical BUY on both pools at fair. On Aven it's a non-arb move -> base fee (premium 0 locally).
    const sres = await app.request("/shock", { method: "POST", headers: auth, body: "{}" });
    expect(sres.status).toBe(200);
    const shock = (await sres.json()) as Shock;
    expect(shock.txHashes).toHaveLength(2);
    const shockTrades = (await (await app.request("/trades?limit=10")).json()) as Trade[];
    const avenShock = shockTrades.find((t) => t.pool === "aven" && t.kind === "retail")!;
    const controlShock = shockTrades.find((t) => t.pool === "control" && t.kind === "retail")!;
    expect(avenShock.feePips).toBe(500);
    expect(controlShock.feePips).toBe(3000);
    expect(avenShock.amountIn).toBe(controlShock.amountIn); // identical shock

    // Both pools are now equally far above fair. Start the bot and wait for an arb on each.
    const st = (await (await app.request("/state")).json()) as StateResponse;
    expect(st.pools.aven.gapBps).toBe(st.pools.control.gapBps);
    expect(st.pools.aven.gapBps).toBeGreaterThan(50);
    expect((await app.request("/bot/start", { method: "POST", headers: auth })).status).toBe(200);
    let arbs: Trade[] = [];
    for (let i = 0; i < 120; i++) {
      arbs = ((await (await app.request("/trades?limit=50")).json()) as Trade[]).filter((t) => t.kind === "arb");
      if (arbs.some((t) => t.pool === "aven") && arbs.some((t) => t.pool === "control")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await app.request("/bot/stop", { method: "POST", headers: auth });
    const avenArb = arbs.find((t) => t.pool === "aven")!;
    const controlArb = arbs.find((t) => t.pool === "control")!;
    expect(avenArb, "bot never traded the Aven pool").toBeDefined();
    expect(controlArb, "bot never traded the control pool").toBeDefined();

    // Same gap, higher fee on Aven; the bot's arb is classified arb by the hook.
    expect(avenArb.direction).toBe("sellBase");
    expect(controlArb.direction).toBe("sellBase");
    expect(avenArb.feePips).toBeGreaterThan(controlArb.feePips);
    expect(avenArb.breakdown?.arb).toBe(true);
    expect(avenArb.breakdown?.reason).toBe("OK");
    expect(avenArb.verify).toEqual({ checkA: true, checkB: true });
    expect(avenArb.botProfitUsd).toBeGreaterThan(0);
    expect(controlArb.botProfitUsd).toBeGreaterThan(0);

    const stats = (await (await app.request("/stats")).json()) as Stats;
    expect(stats.lpKeptMoreUsd).toBeGreaterThan(0);
    expect(stats.aven.trades).toBeGreaterThanOrEqual(1);
    expect(stats.control.trades).toBeGreaterThanOrEqual(1);

    const v = (await (await app.request(`/verify/${avenArb.txHash}`)).json()) as VerifyResult;
    expect(v).toMatchObject({ match: true, checkA: true, checkB: true, onchainFee: avenArb.feePips, recomputedFee: avenArb.feePips, swapEventFee: avenArb.feePips });

    // After the arb, neither pool is left with a profitable gap (each stopped near its own p*).
    const after = (await (await app.request("/state")).json()) as StateResponse;
    expect(Math.abs(after.pools.control.gapBps)).toBeLessThanOrEqual(31); // p* = +30 bp for 0.30%
    expect(Math.abs(after.pools.aven.gapBps)).toBeLessThanOrEqual(Math.ceil(avenArb.feePips / 100) + 1);
    console.log(`[e2e] aven arb fee ${avenArb.feePips} vs control ${controlArb.feePips}; lpKeptMoreUsd ${stats.lpKeptMoreUsd.toFixed(2)}; bot profit aven ${avenArb.botProfitUsd.toFixed(2)} vs control ${controlArb.botProfitUsd.toFixed(2)}`);
  }, 300_000);

  it("persists trades and reloads them on restart", async () => {
    const again = new Arena(cfg, makeChain({ rpcUrl: chain.rpcUrl, chainId: 31337, botPk: cfg.BOT_PK as `0x${string}`, shockPk: cfg.SHOCK_PK as `0x${string}`, deployments: chain.deployments }));
    await again.start();
    expect(again.trades(500).length).toBe(arena.trades(500).length);
    again.stop();
  }, 120_000);
});
