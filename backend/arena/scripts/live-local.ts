/**
 * `pnpm live` (= `pnpm --filter @aven/arena live`): the live demo without testnet HYPE (docs/DEPLOYMENTS.md §A).
 *
 * 1. Reads Hyperliquid MAINNET's live oracle + mark for the perp (default ETH, index 1, szDecimals 4) from the info API.
 * 2. Starts a local anvil chain (chain 31337, 1 s blocks like HyperEVM small blocks), etches MockHyperCorePx at the
 *    HyperCore precompile addresses 0x806/0x807/0x80a and runs the five UNCHANGED deploy scripts (pools start at the
 *    live oracle price).
 * 3. Starts the price relay: every second the API's oracle + mark go into 0x807/0x806, so the unchanged AvenHook reads
 *    exactly what it would read on HyperEVM (recon C.3: precompile == info API after scaling).
 * 4. Starts the Arena service (bot, shock, stats, HTTP + SSE API) and a read-only public RPC proxy.
 *
 * Everything for this run goes to backend/data/arena/live/<run>/ (deployments snapshot, relay.jsonl, trades.jsonl).
 * `--record`: run the scripted demo once, save frontend/public/arena-fallback.json, then exit.
 *
 * Env (all optional): ARENA_PORT 8787, ARENA_ADMIN_TOKEN (random if unset, printed once), ARENA_CORS_ORIGINS
 * (http://localhost:3000), LIVE_RPC_PORT 8545 (anvil, always 127.0.0.1), LIVE_PUBLIC_RPC_PORT 8546 (read-only proxy),
 * LIVE_HOST (bind address of the proxy; 0.0.0.0 on a VM), HL_INFO_API_MAINNET, LIVE_PERP_INDEX 1, LIVE_COIN ETH,
 * LIVE_SZ_DECIMALS 4, RELAY_MS 1000, RELAY_STALE_MS 15000, and the Arena knobs (MAX_TRADE_BASE 100,
 * MAX_TRADE_QUOTE 250000, SHOCK_QUOTE, SHOCK_BASE, MIN_NATIVE_BALANCE, POLL_MS, POST_RATE_LIMIT_PER_MIN).
 * backend/.env is NOT read: its keys and RPC are for testnet.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { contractsDir } from "../../core/scripts/run.ts";
import { startLocalChain } from "@aven/scripts/src/localChain.ts";
import { runDemo, summarize } from "@aven/scripts/src/demo.ts";
import { HL_INFO_API_MAINNET, PriceRelay, fetchPerpPrices, type RelayLogEntry } from "@aven/scripts/src/priceRelay.ts";
import { startReadOnlyRpc } from "@aven/scripts/src/readOnlyRpc.ts";
import { Arena } from "../src/arena.ts";
import { makeChain } from "../src/chain.ts";
import { backendDir, configSchema } from "../src/config.ts";
import { makeApp } from "../src/server.ts";

const env = process.env;
const RECORD = process.argv.includes("--record");
const perpIndex = Number(env.LIVE_PERP_INDEX ?? 1);
const coin = env.LIVE_COIN ?? "ETH";
const szDecimals = Number(env.LIVE_SZ_DECIMALS ?? 4);
const apiUrl = env.HL_INFO_API_MAINNET ?? HL_INFO_API_MAINNET;
const rpcPort = Number(env.LIVE_RPC_PORT ?? 8545);
const publicRpcPort = Number(env.LIVE_PUBLIC_RPC_PORT ?? 8546);
const host = env.LIVE_HOST; // only the proxy and the Arena listen beyond localhost; anvil never does
const adminToken = env.ARENA_ADMIN_TOKEN ?? randomBytes(16).toString("hex");
const source = () => fetchPerpPrices({ apiUrl, perpIndex, coin, szDecimals });

// 0a. Ports must be free. On Windows, closing the terminal (instead of Ctrl+C) leaves anvil running; a new run would
//     then talk to the OLD chain on 8545 and deploy onto it. Refuse to start instead.
const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createNetServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
const ports: Array<[string, number]> = [["anvil (LIVE_RPC_PORT)", rpcPort], ["public RPC (LIVE_PUBLIC_RPC_PORT)", publicRpcPort], ["Arena (ARENA_PORT)", Number(env.ARENA_PORT ?? 8787)]];
const busy = [];
for (const [name, p] of ports) if (!(await portFree(p))) busy.push(`${p} ${name}`);
if (busy.length > 0) {
  console.error(`[live] port(s) in use: ${busy.join(", ")}. Probably an earlier \`pnpm live\` that was not stopped with Ctrl+C.`);
  console.error("[live] Stop it (PowerShell: Get-Process anvil | Stop-Process; then the old node process), or pick other ports, and retry.");
  process.exit(1); // nothing is open yet, so exiting here is safe
}

// 0b. Live price first: fail fast (and clearly) if the API is unreachable or the index is not the expected asset.
const first = await source();
console.log(`[live] ${apiUrl} ${coin} (perp ${perpIndex}, szDecimals ${szDecimals}): oracle ${first.oraclePx}, mark ${first.markPx}`);

const run = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(backendDir, "data", "arena", "live", run);
mkdirSync(runDir, { recursive: true });
const relayLog = join(runDir, "relay.jsonl");
const logEntry = (e: RelayLogEntry & { note?: string }) => appendFileSync(relayLog, `${JSON.stringify(e)}\n`);

// 1-2. Chain + mocks + the five deploy scripts (initial mock prices = the live read, so pools open at the live oracle).
const chain = await startLocalChain({ port: rpcPort, perpIndex, coin, szDecimals, oracleRaw: first.oracleRaw, markRaw: first.markRaw });
logEntry({ t: new Date().toISOString(), block: "0", event: "price", oracleRaw: first.oracleRaw.toString(), markRaw: first.markRaw.toString(), oraclePx: first.oraclePx, markPx: first.markPx, note: "startup: set before the deploy scripts (covers the Smoke swaps)" });
copyFileSync(join(contractsDir, "deployments", "31337.json"), join(runDir, "31337.json")); // snapshot: other local runs overwrite the shared file

let relay: PriceRelay | null = null;
let arena: Arena | null = null;
let server: ReturnType<typeof serve> | null = null;
let proxy: ReturnType<typeof startReadOnlyRpc> | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("[live] stopping");
  if (statusTimer) clearInterval(statusTimer);
  relay?.stop();
  arena?.stop();
  (server as unknown as { closeAllConnections?: () => void })?.closeAllConnections?.();
  server?.close();
  proxy?.closeAllConnections();
  proxy?.close();
  await chain.stop();
  setTimeout(() => process.exit(process.exitCode ?? 0), 2_000).unref(); // only if something still holds the loop
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

try {
  // 3. Relay.
  let lastWarn = 0;
  relay = new PriceRelay({
    source,
    write: chain.writePrices,
    setFailure: chain.setReadFailure,
    blockNumber: () => chain.publicClient.getBlockNumber({ cacheTime: 0 }),
    log: (e) => {
      logEntry(e);
      if (e.event !== "price") console.log(`[relay] ${e.event} at block ${e.block}${e.reason ? `: ${e.reason}` : ""}`);
    },
    onError: (e) => {
      if (Date.now() - lastWarn > 10_000) console.warn(`[relay] ${String((e as Error)?.message ?? e).slice(0, 160)}`), (lastWarn = Date.now());
    },
    intervalMs: Number(env.RELAY_MS ?? 1_000),
    staleMs: Number(env.RELAY_STALE_MS ?? 15_000),
  });
  relay.start();

  // 4. Arena (testnet keys are never read: the bot/shock are anvil accounts 1/2 derived at runtime).
  const knobs = ["ARENA_PORT", "ARENA_CORS_ORIGINS", "SHOCK_QUOTE", "SHOCK_BASE", "MIN_NATIVE_BALANCE", "POLL_MS", "POST_RATE_LIMIT_PER_MIN"] as const;
  const parsed = configSchema.parse({
    ...Object.fromEntries(knobs.filter((k) => env[k] !== undefined).map((k) => [k, env[k]])),
    MAX_TRADE_BASE: env.MAX_TRADE_BASE ?? "100", // the local pools hold 400 aETH (LIQ_BASE): the e2e-proven sizes
    MAX_TRADE_QUOTE: env.MAX_TRADE_QUOTE ?? "250000",
    BOT_PK: chain.keyOf(chain.bot),
    SHOCK_PK: chain.keyOf(chain.shock),
    HYPEREVM_RPC: chain.rpcUrl,
    CHAIN_ID: "31337",
    ARENA_ADMIN_TOKEN: adminToken,
    NATIVE_USD: "0",
    DATA_DIR: runDir,
  });
  const cfg = { ...parsed, corsOrigins: parsed.ARENA_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) };
  arena = new Arena(cfg, makeChain({ rpcUrl: chain.rpcUrl, chainId: 31337, botPk: cfg.BOT_PK as `0x${string}`, shockPk: cfg.SHOCK_PK as `0x${string}`, deployments: chain.deployments }));
  await arena.start();
  server = serve({ fetch: makeApp(arena, { adminToken, corsOrigins: cfg.corsOrigins, postRateLimitPerMin: cfg.POST_RATE_LIMIT_PER_MIN }).fetch, port: cfg.ARENA_PORT, ...(host ? { hostname: host } : { hostname: "127.0.0.1" }) });
  proxy = startReadOnlyRpc({ upstream: chain.rpcUrl, port: publicRpcPort, host: host ?? "127.0.0.1", corsOrigins: cfg.corsOrigins });

  const d = chain.deployments;
  console.log(
    [
      "",
      "[live] READY. Every price comes from Hyperliquid mainnet; the chain is local (badge: \"Live prices · local chain\").",
      `  Arena API        http://${host ?? "127.0.0.1"}:${cfg.ARENA_PORT}   (NEXT_PUBLIC_ARENA_API)`,
      `  public RPC       http://${host ?? "127.0.0.1"}:${publicRpcPort}   (NEXT_PUBLIC_RPC, read-only; NEXT_PUBLIC_CHAIN_ID=31337)`,
      `  anvil (private)  ${chain.rpcUrl}`,
      `  admin token      ${env.ARENA_ADMIN_TOKEN ? "(from ARENA_ADMIN_TOKEN)" : adminToken}`,
      `  hook ${d.hook}  aven pool ${d.pools.aven.id}`,
      `  run data         ${runDir}`,
      `  verify a swap    CHAIN_ID=31337 DEPLOYMENTS_DIR=${runDir} pnpm verify <tx>`,
      `  source check     pnpm live:check ${runDir}`,
      "",
    ].join("\n"),
  );

  statusTimer = setInterval(async () => {
    try {
      const s = relay!.status();
      const b = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
      console.log(`[live] block ${b} · oracle ${s.last?.oraclePx ?? "?"} mark ${s.last?.markPx ?? "?"} · relay writes ${s.writes} errors ${s.errors}${s.failing ? " · READS FAILING (stale API)" : ""} · arb trades ${arena!.trades(100_000).length}`);
    } catch {
      /* status only */
    }
  }, 30_000);

  if (RECORD) {
    const rec = await runDemo({ baseUrl: `http://127.0.0.1:${cfg.ARENA_PORT}`, adminToken, log: (s) => console.log(`[demo] ${s}`) });
    const outDir = fileURLToPath(new URL("../../../frontend/public/", import.meta.url));
    mkdirSync(outDir, { recursive: true });
    const sourceLabel = `Recorded run: LOCAL anvil chain 31337 with live Hyperliquid MAINNET ${coin} oracle/mark (perp ${perpIndex}) relayed into the HyperCore precompile addresses 0x807/0x806 every second; unchanged AvenHook, deploy scripts and Arena service`;
    writeFileSync(join(outDir, "arena-fallback.json"), `${JSON.stringify({ ...rec, source: sourceLabel }, null, 1)}\n`);
    writeFileSync(join(runDir, "demo-record.json"), `${JSON.stringify({ ...rec, source: sourceLabel }, null, 1)}\n`);
    console.log(summarize(rec));
    console.log("[live] saved frontend/public/arena-fallback.json");
    await shutdown();
  }
} catch (e) {
  console.error("[live] failed:", e);
  process.exitCode = 1;
  await shutdown();
}
