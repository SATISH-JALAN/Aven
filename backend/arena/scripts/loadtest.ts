/**
 * `pnpm --filter @aven/arena loadtest`: PLAN 7.1(b), 7.2, 7.3 on a fresh local anvil chain (~6 min).
 *   A. on-chain burst: 7 wallets fire 40 swaps each without waiting -> every receipt, verify --all, top-of-block per block
 *   B. Arena API load (autocannon) while the bot runs and the oracle moves; 200 concurrent SSE clients; POST rate limit;
 *      bot keeps up with the chain; memory before/after
 *   C. bot under stress: repeated shocks while the RPC (via a proxy) is flaky, then down, then healthy; the loop must
 *      survive, recover and keep nonces consistent; auto-pause on low balance
 * Writes backend/data/load/loadtest.json (docs/LOADTEST.md is generated from it + onchain.json).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import { serve } from "@hono/node-server";
import { createWalletClient, decodeEventLog, http, nonceManager, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { avenHookAbi, mockErc20Abi, poolSwapTestAbi, verifyAll } from "@aven/core";
import { accountAt, privateKeyOf, startLocalChain } from "@aven/scripts/src/localChain.ts";
import { Arena } from "../src/arena.ts";
import { makeChain } from "../src/chain.ts";
import { configSchema, type ArenaConfig } from "../src/config.ts";
import { makeApp } from "../src/server.ts";

const log = (s: string) => console.log(`[load] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown> = { startedAt: new Date().toISOString() };
const TOKEN = "loadtest-admin-token";
const PORT = 8800;
const PROXY_PORT = 8551;

const chain = await startLocalChain({ port: 8550, quiet: true });
const d = chain.deployments;
const target = { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params };

// ---------------------------------------------------------------------------------------------- RPC fault proxy
type Mode = "healthy" | "flaky" | "down";
let mode: Mode = "healthy";
const proxyStats = { requests: 0, failed503: 0, hung: 0 };
const proxy = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  proxyStats.requests++;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = Math.random();
  if (mode === "down" || (mode === "flaky" && r < 0.2)) {
    proxyStats.failed503++;
    res.writeHead(503).end("injected outage");
    return;
  }
  if (mode === "flaky" && r < 0.3) {
    proxyStats.hung++;
    await sleep(20_000); // longer than the Arena's 15 s RPC timeout
    if (!res.writableEnded) res.writeHead(504).end("injected timeout");
    return;
  }
  try {
    const up = await fetch(chain.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
    res.writeHead(up.status, { "content-type": "application/json" }).end(await up.text());
  } catch {
    res.writeHead(502).end("upstream error");
  }
});
proxy.listen(PROXY_PORT);

// ---------------------------------------------------------------------------------------------- Arena (in-process)
const mkCfg = (over: Record<string, string> = {}): ArenaConfig => ({
  ...configSchema.parse({
    BOT_PK: chain.keyOf(chain.bot),
    SHOCK_PK: chain.keyOf(chain.shock),
    HYPEREVM_RPC: `http://127.0.0.1:${PROXY_PORT}`,
    CHAIN_ID: "31337",
    ARENA_ADMIN_TOKEN: TOKEN,
    MAX_TRADE_BASE: "100",
    MAX_TRADE_QUOTE: "250000",
    SHOCK_QUOTE: "20000",
    POLL_MS: "500",
    POST_RATE_LIMIT_PER_MIN: "30",
    DATA_DIR: mkdtempSync(join(tmpdir(), "aven-load-")),
    ...over,
  }),
  corsOrigins: [],
});
const cfg = mkCfg();
const mkArena = (c: ArenaConfig, rpc = c.HYPEREVM_RPC) =>
  new Arena(c, makeChain({ rpcUrl: rpc, chainId: 31337, botPk: c.BOT_PK as Hex, shockPk: c.SHOCK_PK as Hex, deployments: d }));
const arena = mkArena(cfg);
await arena.start();
const server = serve({ fetch: makeApp(arena, { adminToken: TOKEN, corsOrigins: [], postRateLimitPerMin: 30 }).fetch, port: PORT });
const base = `http://127.0.0.1:${PORT}`;
const lastError = () => (arena as unknown as { lastError: string | null }).lastError;
const errorSamples = new Set<string>();
const sampler = setInterval(() => {
  const e = lastError();
  if (e) errorSamples.add(e.slice(0, 160));
}, 200);

try {
  // ============================================================================================ A. on-chain burst
  log("A. on-chain burst: 7 wallets x 40 swaps, fired without waiting ...");
  const startBlock = await chain.publicClient.getBlockNumber();
  const wallets = [3, 4, 5, 6, 7, 8, 9].map((i) => {
    const account = privateKeyToAccount(privateKeyOf(accountAt(i)), { nonceManager });
    return { account, wallet: createWalletClient({ account, chain: foundry, transport: http(chain.rpcUrl) }) };
  });
  for (const w of wallets) {
    for (const token of [d.tokens.base, d.tokens.quote] as Address[]) {
      const dec = token === d.tokens.base ? 18 : 6;
      await chain.publicClient.waitForTransactionReceipt({ hash: await w.wallet.writeContract({ address: token, abi: mockErc20Abi, functionName: "mint", args: [w.account.address, 10n ** BigInt(dec + 7)], chain: foundry, account: w.account }) });
      await chain.publicClient.waitForTransactionReceipt({ hash: await w.wallet.writeContract({ address: token, abi: mockErc20Abi, functionName: "approve", args: [d.swapRouter as Address, 2n ** 255n], chain: foundry, account: w.account }) });
    }
  }
  const key = d.pools.aven.key as never;
  const hashes: Hex[] = [];
  const t0 = Date.now();
  await Promise.all(
    wallets.map(async (w, wi) => {
      for (let i = 0; i < 40; i++) {
        const sell = (wi + i) % 2 === 0;
        const zeroForOne = sell ? d.config.baseIsToken0 : !d.config.baseIsToken0;
        const amount = sell ? 10n ** 16n * BigInt(1 + ((wi * 7 + i * 13) % 20)) : 10n ** 6n * BigInt(20 + ((wi * 11 + i * 17) % 400));
        hashes.push(
          await w.wallet.writeContract({
            address: d.swapRouter as Address,
            abi: poolSwapTestAbi,
            functionName: "swap",
            args: [key, { zeroForOne, amountSpecified: -amount, sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n }, { takeClaims: false, settleUsingBurn: false }, "0x"],
            chain: foundry,
            account: w.account,
            gas: 400_000n,
          }),
        );
      }
    }),
  );
  const sendMs = Date.now() - t0;
  const receipts = await Promise.all(hashes.map((hash) => chain.publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })));
  const ok = receipts.filter((r) => r.status === "success");
  const perBlock = new Map<bigint, { swaps: number; gas: bigint; tops: Set<string> }>();
  for (const r of ok) {
    const b = perBlock.get(r.blockNumber) ?? { swaps: 0, gas: 0n, tops: new Set<string>() };
    b.swaps++;
    b.gas += r.gasUsed;
    for (const l of r.logs) {
      if (l.address.toLowerCase() !== d.hook.toLowerCase()) continue;
      const ev = decodeEventLog({ abi: avenHookAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "FeeComputed") b.tops.add(String((ev.args as { sqrtPriceTopX96: bigint }).sqrtPriceTopX96));
    }
    perBlock.set(r.blockNumber, b);
  }
  const vA = await verifyAll(chain.publicClient, target, { fromBlock: startBlock });
  const blocks = [...perBlock.values()];
  results.onchainBurst = {
    sent: hashes.length,
    sendMs,
    success: ok.length,
    reverted: receipts.length - ok.length,
    blocks: blocks.length,
    maxSwapsPerBlock: Math.max(...blocks.map((b) => b.swaps)),
    maxBlockGasOfSwaps: Number(blocks.reduce((m, b) => (b.gas > m ? b.gas : m), 0n)),
    blocksWithMoreThanOneTopPrice: blocks.filter((b) => b.tops.size > 1).length,
    verify: { events: vA.count, checkA: vA.checkA, checkB: vA.checkB, mismatches: vA.mismatches.length },
  };
  log(`A done: ${JSON.stringify(results.onchainBurst)}`);

  // ============================================================================================ B. API load
  log("B. API load: autocannon on 5 GET routes (15 s each, 50 connections) + 200 SSE clients, bot running ...");
  await fetch(`${base}/bot/start`, { method: "POST", headers: { "x-admin-token": TOKEN, "x-forwarded-for": "10.0.0.1" } });
  let driving = true;
  const driver = (async () => {
    let k = 0;
    while (driving) {
      const o = BigInt(224_002 + (k % 2 === 0 ? 2_500 : -2_500)); // oracle alternates +-1.1%
      await chain.setPrices(o, o).catch(() => undefined);
      k++;
      await sleep(4_000);
    }
  })();
  const sse = Array.from({ length: 200 }, () => {
    const ac = new AbortController();
    const st = { events: 0, ac, error: false };
    fetch(`${base}/stream`, { signal: ac.signal })
      .then(async (r) => {
        const reader = r.body!.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          st.events += (dec.decode(value).match(/^event:/gm) ?? []).length;
        }
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") st.error = true;
      });
    return st;
  });
  await sleep(1_500);
  const subsDuring = arena.subscriberCount;
  global.gc?.();
  const memBefore = process.memoryUsage();
  const headBefore = await chain.publicClient.getBlockNumber();
  const iterBefore = arena.stats_.iterations;
  const tradesBefore = arena.trades(10_000).length;
  const routes = ["/health", "/config", "/stats", "/trades?limit=50", "/state"];
  const api: Record<string, unknown> = {};
  for (const route of routes) {
    const r = await autocannon({ url: `${base}${route}`, connections: 50, duration: 15 });
    api[route] = { reqPerSec: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, errors: r.errors, timeouts: r.timeouts, non2xx: r.non2xx, total: r.requests.total };
    log(`  ${route}: ${JSON.stringify(api[route])}`);
  }
  const headAfter = await chain.publicClient.getBlockNumber();
  global.gc?.();
  const memAfter = process.memoryUsage();
  const status = await (await fetch(`${base}/bot/status`)).json();
  // POST rate limit: 60 POSTs from one client, limit 30/min
  const codes: number[] = [];
  for (let i = 0; i < 60; i++) codes.push((await fetch(`${base}/reset-stats`, { method: "POST", headers: { "x-admin-token": TOKEN, "x-forwarded-for": "10.9.9.9" } })).status);
  for (const s of sse) s.ac.abort();
  await sleep(1_500);
  results.apiLoad = {
    routes: api,
    sse: { clients: sse.length, subscribersDuringLoad: subsDuring, subscribersAfterClose: arena.subscriberCount, minEventsPerClient: Math.min(...sse.map((s) => s.events)), clientErrors: sse.filter((s) => s.error).length },
    bot: { chainBlocksDuringLoad: Number(headAfter - headBefore), botIterationsDuringLoad: arena.stats_.iterations - iterBefore, lastRunBlock: (status as { lastRunBlock: number }).lastRunBlock, headAfter: Number(headAfter), arbTradesDuringLoad: arena.trades(10_000).length - tradesBefore },
    rateLimit: { sent: 60, ok: codes.filter((c) => c === 200).length, limited: codes.filter((c) => c === 429).length },
    memoryMB: { heapBefore: +(memBefore.heapUsed / 2 ** 20).toFixed(1), heapAfter: +(memAfter.heapUsed / 2 ** 20).toFixed(1), rssBefore: +(memBefore.rss / 2 ** 20).toFixed(1), rssAfter: +(memAfter.rss / 2 ** 20).toFixed(1), gcExposed: typeof global.gc === "function" },
  };
  driving = false;
  await driver;

  // ============================================================================================ C. bot under stress
  log("C. bot under stress: shocks while the RPC is flaky -> down -> healthy ...");
  const stressStart = Date.now();
  const shocks: Array<{ phase: string; ok: boolean; error?: string }> = [];
  let healthOk = 0;
  let healthFail = 0;
  let probing = true;
  const prober = (async () => {
    while (probing) {
      try {
        healthOk += (await fetch(`${base}/health`)).ok ? 1 : 0;
      } catch {
        healthFail++;
      }
      await sleep(500);
    }
  })();
  const phases: Array<[Mode, number]> = [["healthy", 1], ["flaky", 3], ["down", 1], ["healthy", 2]];
  let n = 0;
  for (const [m, count] of phases) {
    mode = m;
    for (let i = 0; i < count; i++) {
      try {
        await arena.shock({ direction: n++ % 2 === 0 ? "buyBase" : "sellBase", sizeBase: "6" });
        shocks.push({ phase: m, ok: true });
      } catch (e) {
        shocks.push({ phase: m, ok: false, error: (e as Error).message.split("\n")[0]!.slice(0, 120) });
      }
      await sleep(m === "down" ? 10_000 : 6_000);
    }
  }
  mode = "healthy";
  const recoveredAt = Date.now();
  await sleep(10_000); // let the bot catch up after recovery
  probing = false;
  await prober;
  const arbsAfterRecovery = arena.trades(10_000).filter((t) => t.kind === "arb" && t.ts >= recoveredAt - 2_000).length;
  const vC = await verifyAll(chain.publicClient, target, { fromBlock: startBlock });
  const nonceErrors = [...errorSamples].filter((e) => /nonce/i.test(e));

  // auto-pause: same chain, bot must refuse to trade when its native balance is below the threshold
  const pauseArena = mkArena(mkCfg({ MIN_NATIVE_BALANCE: "1000000000" }), chain.rpcUrl);
  await pauseArena.start();
  pauseArena.setBot(true);
  await pauseArena.botIteration(await chain.publicClient.getBlockNumber());
  const pauseStatus = await pauseArena.botStatus();
  pauseArena.stop();

  results.stress = {
    shocks,
    proxy: { ...proxyStats },
    health: { ok: healthOk, failed: healthFail },
    loop: { iterations: arena.stats_.iterations, iterationErrors: arena.stats_.iterationErrors, pollErrors: arena.stats_.pollErrors },
    arbTradesAfterRecovery: arbsAfterRecovery,
    distinctErrorsSeen: [...errorSamples].slice(0, 12),
    nonceErrors: nonceErrors.length,
    verifyAllSinceStart: { events: vC.count, checkA: vC.checkA, checkB: vC.checkB, mismatches: vC.mismatches.length },
    autoPause: { enabledAfter: pauseStatus.enabled, lastError: pauseStatus.lastError },
    durationSec: Math.round((Date.now() - stressStart) / 1000),
  };
  log(`C done: ${JSON.stringify({ ...(results.stress as object), distinctErrorsSeen: undefined })}`);
} finally {
  clearInterval(sampler);
  arena.stop();
  server.close();
  proxy.close();
  await chain.stop();
}

results.finishedAt = new Date().toISOString();
const out = fileURLToPath(new URL("../../data/load/", import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "loadtest.json"), `${JSON.stringify(results, null, 2)}\n`);
log("wrote backend/data/load/loadtest.json");
