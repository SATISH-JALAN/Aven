/**
 * Demo run against a live Arena service (P13, ARCHITECTURE §12), over HTTP only (docs/spec/API.md):
 * stop bot -> reset stats -> shock both pools -> start bot -> wait for an arb on each pool -> stop bot -> collect
 * stats, state, trades and a /verify result. The returned record is what frontend/public/arena-fallback.json holds
 * (badge "Recorded run").
 */
export interface DemoOptions {
  baseUrl: string;
  adminToken: string;
  shock?: { sizeBase?: string; direction?: "buyBase" | "sellBase" };
  timeoutMs?: number;
  log?: (s: string) => void;
}

type Json = Record<string, unknown>;
type Trade = Json & { pool: "aven" | "control"; kind: string; ts: number; txHash: string; feePips: number; botProfitUsd: number; lpFeeIncomeUsd: number };

export async function runDemo(o: DemoOptions) {
  const log = o.log ?? (() => undefined);
  const get = async (path: string) => {
    const r = await fetch(`${o.baseUrl}${path}`);
    if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
    return r.json() as Promise<Json>;
  };
  const post = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${o.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": o.adminToken }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${path}: ${r.status} ${await r.text()}`);
    return r.json() as Promise<Json>;
  };

  const health = await get("/health");
  const config = await get("/config");
  log(`arena ok: chain ${health.chainId}, block ${health.block}`);
  await post("/bot/stop");
  const { since } = (await post("/reset-stats")) as { since: number };
  const before = await get("/state");
  log("shock: identical swap on both pools ...");
  const shock = await post("/shock", o.shock ?? {});
  const afterShock = await get("/state");
  await post("/bot/start");
  log("bot started; waiting for an arb on each pool ...");
  const deadline = Date.now() + (o.timeoutMs ?? 120_000);
  let trades: Trade[] = [];
  for (;;) {
    trades = ((await get("/trades?limit=200")) as unknown as Trade[]).filter((t) => t.ts >= since);
    const arbs = trades.filter((t) => t.kind === "arb");
    if (arbs.some((t) => t.pool === "aven") && arbs.some((t) => t.pool === "control")) break;
    if (Date.now() > deadline) {
      await post("/bot/stop");
      throw new Error("timed out waiting for the bot to trade both pools");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await post("/bot/stop");
  const stats = await get("/stats");
  const after = await get("/state");
  const avenArb = trades.find((t) => t.pool === "aven" && t.kind === "arb")!;
  const controlArb = trades.find((t) => t.pool === "control" && t.kind === "arb")!;
  const verify = await get(`/verify/${avenArb.txHash}`);
  return {
    badge: "Recorded run",
    recordedAt: new Date().toISOString(),
    chainId: health.chainId,
    arenaVersion: health.version,
    config,
    shock,
    state: { before, afterShock, after },
    trades: trades.sort((a, b) => a.ts - b.ts),
    stats,
    highlight: { avenArb, controlArb, verify },
  };
}

export type DemoRecord = Awaited<ReturnType<typeof runDemo>>;

/** One-screen summary for the terminal. */
export function summarize(d: DemoRecord): string {
  const s = d.stats as { lpKeptMoreUsd: number; botProfitDiffUsd: number; aven: Json; control: Json };
  const { avenArb, controlArb, verify } = d.highlight;
  const gap = (d.state.afterShock as { pools: { aven: { gapBps: number } } }).pools.aven.gapBps;
  const v = verify as { match: boolean; checkA: boolean; checkB: boolean; onchainFee: number; recomputedFee: number; swapEventFee: number };
  return [
    `Aven Arena demo (chain ${d.chainId}, ${d.recordedAt})`,
    `  shock: identical swap on both pools -> both ${gap} bp off fair`,
    `  bot arb fee      Aven ${avenArb.feePips} pips   vs   control ${controlArb.feePips} pips`,
    `  bot profit       Aven $${avenArb.botProfitUsd.toFixed(2)}   vs   control $${controlArb.botProfitUsd.toFixed(2)}`,
    `  LP fee income    Aven $${avenArb.lpFeeIncomeUsd.toFixed(2)}   vs   control $${controlArb.lpFeeIncomeUsd.toFixed(2)}`,
    `  LPs kept $${s.lpKeptMoreUsd.toFixed(2)} more on Aven (bot trades since reset)`,
    `  verify ${avenArb.txHash}: ${v.match ? "MATCH" : "MISMATCH"} (A ${v.checkA}, B ${v.checkB}; on-chain ${v.onchainFee}, recomputed ${v.recomputedFee}, Swap event ${v.swapEventFee})`,
  ].join("\n");
}
