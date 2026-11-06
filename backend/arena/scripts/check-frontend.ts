/**
 * `pnpm --filter @aven/arena check:frontend`: the frontend's data and transaction paths, end to end on a local anvil
 * chain (mock precompiles, the real deploy scripts, the real Arena on a real HTTP port). ~2–3 min, no keys, no testnet.
 *
 * It sends the frontend's own transactions: the args come from frontend/src/lib/trade-math.ts (the module the Trade,
 * Swap and Pool pages use), not from a copy. Checks:
 *  1. every GET route the frontend reads answers with the fields it uses, with CORS for the frontend origin;
 *  2. /config agrees with contracts/deployments/31337.json (what `sync:deployments` gives the static site);
 *  3. the SSE stream delivers a `state` event;
 *  4. a wallet swaps on both pools in both directions: the fee the UI shows (/state feePreview) is the fee charged
 *     (FeeComputed and the PoolManager Swap event), and the real output is at most the UI's indicative quote and close
 *     to it for a small trade;
 *  5. /verify/:tx on the wallet's Aven swap is MATCH (A and B);
 *  6. add liquidity on both pools from planLiquidity: the router pulls no more than liquidityNeeds and close to the plan;
 *  7. a shock, then the bot: over HTTP, /stats shows the arb bot profiting on both pools and LPs keeping more on Aven.
 * Exit code 0 only if every check passes.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { decodeEventLog, formatUnits, parseUnits, type Hex } from "viem";
import { avenHookAbi, mockErc20Abi, poolManagerAbi, poolModifyLiquidityTestAbi, poolSwapTestAbi } from "@aven/core";
import { accountAt, startLocalChain } from "@aven/scripts/src/localChain.ts";
import { Arena } from "../src/arena.ts";
import { makeChain } from "../src/chain.ts";
import { configSchema } from "../src/config.ts";
import { makeApp } from "../src/server.ts";
import type { StateResponse, Stats, Trade, VerifyResult } from "../src/types.ts";

type Side = "buyBase" | "sellBase";
type PoolName = "aven" | "control";
type Plan = { tickLower: number; tickUpper: number; liquidity: number; baseAmount: number; quoteAmount: number };
/* The frontend module, loaded at runtime so this package's typecheck doesn't pull in the frontend's `@/` aliases. */
interface TradeMath {
  tokenSide(d: unknown, side: Side): { tokenIn: Hex; tokenOut: Hex; inDec: number; outDec: number; zeroForOne: boolean };
  feeFor(state: unknown, pool: PoolName, side: Side): number | null;
  indicativeOut(amountIn: number, side: Side, poolPrice: number, feePips: number): number;
  planLiquidity(d: unknown, pool: PoolName, poolPrice: number, rangePct: number, baseAmount: number): Plan | null;
  liquidityNeeds(d: unknown, plan: Plan): { token: Hex; sym: string; value: bigint }[];
  liquidityArgs(d: unknown, pool: PoolName, plan: Plan): readonly unknown[];
  swapArgs(d: unknown, pool: PoolName, side: Side, value: bigint): readonly unknown[];
  withGasMargin(est: bigint): bigint;
}
const tm = (await import(new URL("../../../frontend/src/lib/trade-math.ts", import.meta.url).href)) as TradeMath;

const PORT = Number(process.env.CHECK_PORT ?? 8797);
const TOKEN = "check-frontend-admin-token";
const ORIGIN = "http://localhost:3000";
const base = `http://127.0.0.1:${PORT}`;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async <T>(path: string): Promise<{ status: number; body: T; cors: string | null }> => {
  const r = await fetch(base + path, { headers: { origin: ORIGIN } });
  return { status: r.status, body: (await r.json()) as T, cors: r.headers.get("access-control-allow-origin") };
};
const post = (path: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: { "x-admin-token": TOKEN, "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });

const chain = await startLocalChain({ port: 8549, quiet: true });
let server: ReturnType<typeof serve> | null = null;
let arena: Arena | null = null;
try {
  const cfg = {
    ...configSchema.parse({
      BOT_PK: chain.keyOf(chain.bot),
      SHOCK_PK: chain.keyOf(chain.shock),
      HYPEREVM_RPC: chain.rpcUrl,
      CHAIN_ID: "31337",
      ARENA_ADMIN_TOKEN: TOKEN,
      MAX_TRADE_BASE: "100",
      MAX_TRADE_QUOTE: "250000",
      SHOCK_QUOTE: "40000",
      POLL_MS: "250",
      DATA_DIR: mkdtempSync(join(tmpdir(), "aven-check-")),
    }),
    corsOrigins: [ORIGIN],
  };
  arena = new Arena(cfg, makeChain({ rpcUrl: chain.rpcUrl, chainId: 31337, botPk: cfg.BOT_PK as Hex, shockPk: cfg.SHOCK_PK as Hex, deployments: chain.deployments }));
  await arena.start();
  server = serve({ fetch: makeApp(arena, { adminToken: TOKEN, corsOrigins: [ORIGIN], postRateLimitPerMin: 100 }).fetch, port: PORT });
  const d = chain.deployments;
  const swapRouter = d.swapRouter as Hex;
  const liquidityRouter = d.liquidityRouter as Hex;

  // 1. GET routes the frontend reads (lib/arena.tsx), with CORS for its origin.
  for (const p of ["/health", "/config", "/state", "/stats", "/trades?limit=200", "/bot/status"]) {
    const r = await get<unknown>(p);
    check(`GET ${p}`, r.status === 200 && r.cors === ORIGIN, `status ${r.status}, cors ${r.cors}`);
  }
  const state0 = (await get<StateResponse>("/state")).body;
  const fpA = state0.pools.aven.feePreview;
  check(
    "/state has the fields the UI reads",
    state0.oracle.price > 0 && state0.pools.aven.price > 0 && state0.pools.control.price > 0 && "buyBase" in fpA && "fixedPips" in state0.pools.control.feePreview,
    `oracle ${state0.oracle.price}, aven ${state0.pools.aven.price}, control ${state0.pools.control.price}`,
  );

  // 2. /config vs the deployments file.
  const conf = (await get<{ chainId: number; hook: string; poolManager: string; pools: typeof d.pools }>("/config")).body;
  check(
    "/config matches deployments/31337.json",
    conf.chainId === 31337 && conf.hook.toLowerCase() === d.hook.toLowerCase() && conf.poolManager.toLowerCase() === d.poolManager.toLowerCase() && conf.pools.aven.id === d.pools.aven.id && conf.pools.control.id === d.pools.control.id,
  );

  // 3. SSE: a `state` event arrives.
  {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let got = false;
    try {
      const r = await fetch(`${base}/stream`, { signal: ac.signal, headers: { origin: ORIGIN } });
      const reader = r.body!.getReader();
      let buf = "";
      while (!got) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        got = /event: state\ndata: \{/.test(buf);
      }
    } catch {
      /* aborted by the timer */
    }
    clearTimeout(timer);
    ac.abort();
    check("SSE /stream sends a state event", got);
  }

  // 4. A wallet trades through the UI's own args.
  const user = accountAt(5);
  const w = chain.wallet(user);
  const c = chain.publicClient;
  const send = async (address: Hex, abi: unknown, functionName: string, args: readonly unknown[], gas?: bigint) => {
    const hash = await w.writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, account: user, chain: null, ...(gas ? { gas } : {}) });
    return c.waitForTransactionReceipt({ hash, pollingInterval: 250 });
  };
  const bal = (token: Hex) => c.readContract({ address: token, abi: mockErc20Abi, functionName: "balanceOf", args: [user.address] });
  // The UI reads /state; wait until it reflects the latest block so the preview is for the current pre-state.
  const freshState = async () => {
    const head = Number(await c.getBlockNumber({ cacheTime: 0 }));
    for (let i = 0; i < 40; i++) {
      const s = (await get<StateResponse>("/state")).body;
      if (s.block >= head) return s;
      await sleep(250);
    }
    throw new Error("/state never caught up with the chain head");
  };

  let userAvenTx: Hex | null = null;
  const sizes: Record<Side, string> = { buyBase: "2000", sellBase: "1" }; // aUSD in / aETH in
  for (const pool of ["aven", "control"] as PoolName[]) {
    for (const side of ["sellBase", "buyBase"] as Side[]) {
      const t = tm.tokenSide(d, side);
      const value = parseUnits(sizes[side], t.inDec);
      await send(t.tokenIn, mockErc20Abi, "mint", [user.address, value]);
      await send(t.tokenIn, mockErc20Abi, "approve", [swapRouter, value]);
      const st = await freshState();
      const shownFee = tm.feeFor(st, pool, side)!;
      const poolPrice = st.pools[pool].price;
      const quote = tm.indicativeOut(Number(sizes[side]), side, poolPrice, shownFee);
      const args = tm.swapArgs(d, pool, side, value);
      const est = await c.estimateContractGas({ address: swapRouter, abi: poolSwapTestAbi, functionName: "swap", args: args as never, account: user });
      const outBefore = await bal(t.tokenOut);
      const r = await send(swapRouter, poolSwapTestAbi, "swap", args, tm.withGasMargin(est));
      const got = Number(formatUnits((await bal(t.tokenOut)) - outBefore, t.outDec));
      let hookFee: number | null = null;
      let swapFee: number | null = null;
      for (const l of r.logs) {
        try {
          const ev = decodeEventLog({ abi: avenHookAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "FeeComputed") hookFee = Number((ev.args as { fee: number }).fee);
        } catch {
          /* not a hook event */
        }
        try {
          const ev = decodeEventLog({ abi: poolManagerAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "Swap") swapFee = Number((ev.args as { fee: number }).fee);
        } catch {
          /* not a PoolManager event */
        }
      }
      const charged = pool === "aven" ? hookFee : swapFee;
      check(`${pool} ${side}: swap succeeds`, r.status === "success", `gas ${r.gasUsed} (limit ${tm.withGasMargin(est)})`);
      check(`${pool} ${side}: fee shown = fee charged`, charged === shownFee && swapFee === shownFee, `shown ${shownFee}, hook ${hookFee}, Swap event ${swapFee}`);
      // AMM price impact only lowers the output, and a small trade stays within 1% of the quote.
      check(`${pool} ${side}: output ≤ quote, within 1%`, got <= quote * (1 + 1e-9) && got >= quote * 0.99, `got ${got.toFixed(6)}, quote ${quote.toFixed(6)}`);
      if (pool === "aven" && !userAvenTx) userAvenTx = r.transactionHash;
    }
  }

  // 5. Verify the wallet's Aven swap (the Verify page runs the same @aven/core verify in the browser).
  {
    let v: VerifyResult | null = null;
    for (let i = 0; i < 20 && !v?.match; i++) {
      v = (await get<VerifyResult>(`/verify/${userAvenTx}`)).body;
      if (!v.match) await sleep(500);
    }
    check("/verify on the wallet's Aven swap", !!v?.match && v.checkA && v.checkB, `fee ${v?.onchainFee} vs recomputed ${v?.recomputedFee}`);
  }

  // 6. Add liquidity on both pools from the Pool page's plan.
  for (const pool of ["aven", "control"] as PoolName[]) {
    const st = await freshState();
    const plan = tm.planLiquidity(d, pool, st.pools[pool].price, 10, 2);
    if (!plan) {
      check(`${pool}: plan liquidity`, false, "no plan");
      continue;
    }
    const needs = tm.liquidityNeeds(d, plan);
    const before: bigint[] = [];
    for (const n of needs) {
      await send(n.token, mockErc20Abi, "mint", [user.address, n.value]);
      await send(n.token, mockErc20Abi, "approve", [liquidityRouter, n.value]);
      before.push(await bal(n.token));
    }
    const args = tm.liquidityArgs(d, pool, plan);
    const est = await c.estimateContractGas({ address: liquidityRouter, abi: poolModifyLiquidityTestAbi, functionName: "modifyLiquidity", args: args as never, account: user });
    const r = await send(liquidityRouter, poolModifyLiquidityTestAbi, "modifyLiquidity", args, tm.withGasMargin(est));
    const pulled = await Promise.all(needs.map(async (n, i) => before[i]! - (await bal(n.token))));
    const planned = [plan.baseAmount, plan.quoteAmount];
    const decs = needs.map((n) => (n.token === d.tokens.base ? (d.config.baseIsToken0 ? d.config.decimals0 : d.config.decimals1) : d.config.baseIsToken0 ? d.config.decimals1 : d.config.decimals0));
    const ratios = pulled.map((p, i) => Number(formatUnits(p, decs[i]!)) / planned[i]!);
    check(`${pool}: add liquidity succeeds`, r.status === "success", `ticks ${plan.tickLower}..${plan.tickUpper}`);
    check(
      `${pool}: pulled ≤ approved, 95–100.5% of plan`,
      pulled.every((p, i) => p <= needs[i]!.value) && ratios.every((x) => x >= 0.95 && x <= 1.005),
      `base ${(ratios[0]! * 100).toFixed(2)}%, quote ${(ratios[1]! * 100).toFixed(2)}% of plan`,
    );
  }

  // 7. Shock, then the bot: who earns, as the Pool page reads it from /stats.
  {
    await post("/reset-stats");
    const s = await post("/shock", {});
    check("POST /shock", s.status === 200, `status ${s.status}`);
    await post("/bot/start");
    let arbs: Trade[] = [];
    for (let i = 0; i < 120; i++) {
      arbs = (await get<Trade[]>("/trades?limit=50")).body.filter((t) => t.kind === "arb");
      if (arbs.some((t) => t.pool === "aven") && arbs.some((t) => t.pool === "control")) break;
      await sleep(500);
    }
    await post("/bot/stop");
    const st = (await get<Stats>("/stats")).body;
    check("bot arbs both pools", arbs.some((t) => t.pool === "aven") && arbs.some((t) => t.pool === "control"), `${arbs.length} arb trades`);
    check("arb bot profits on both pools", st.aven.botProfitUsd > 0 && st.control.botProfitUsd > 0, `aven $${st.aven.botProfitUsd.toFixed(2)}, plain $${st.control.botProfitUsd.toFixed(2)}`);
    check("LPs keep more on Aven", st.lpKeptMoreUsd > 0 && st.aven.lpFeeIncomeUsd > st.control.lpFeeIncomeUsd, `LP fees aven $${st.aven.lpFeeIncomeUsd.toFixed(2)} vs plain $${st.control.lpFeeIncomeUsd.toFixed(2)}; kept more $${st.lpKeptMoreUsd.toFixed(2)}`);
  }
} catch (e) {
  check("ran to completion", false, (e as Error).message.split("\n")[0] ?? String(e));
} finally {
  arena?.stop();
  server?.close();
  await chain.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[check-frontend] ${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
