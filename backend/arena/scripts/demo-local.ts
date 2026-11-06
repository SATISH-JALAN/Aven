/**
 * `pnpm --filter @aven/arena demo:local`: the full demo with no keys or testnet. Starts a local anvil chain (mock
 * precompiles, real deploy scripts), runs the Arena service in-process on a real HTTP port, runs the demo over HTTP,
 * prints the summary and saves frontend/public/arena-fallback.json labelled as a LOCAL-chain recording. Replace it
 * with a testnet recording (`pnpm demo`) once the testnet deploy exists.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { startLocalChain } from "@aven/scripts/src/localChain.ts";
import { runDemo, summarize } from "@aven/scripts/src/demo.ts";
import { Arena } from "../src/arena.ts";
import { makeChain } from "../src/chain.ts";
import { configSchema } from "../src/config.ts";
import { makeApp } from "../src/server.ts";

const PORT = Number(process.env.DEMO_PORT ?? 8799);
const TOKEN = "demo-local-admin-token";
const chain = await startLocalChain({ port: 8548 });
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
      POLL_MS: "250",
      DATA_DIR: mkdtempSync(join(tmpdir(), "aven-demo-")),
    }),
    corsOrigins: [],
  };
  arena = new Arena(cfg, makeChain({ rpcUrl: chain.rpcUrl, chainId: 31337, botPk: cfg.BOT_PK as `0x${string}`, shockPk: cfg.SHOCK_PK as `0x${string}`, deployments: chain.deployments }));
  await arena.start();
  server = serve({ fetch: makeApp(arena, { adminToken: TOKEN, corsOrigins: [], postRateLimitPerMin: 100 }).fetch, port: PORT });
  const rec = await runDemo({ baseUrl: `http://127.0.0.1:${PORT}`, adminToken: TOKEN, log: (s) => console.log(`[demo] ${s}`) });
  const outDir = fileURLToPath(new URL("../../../frontend/public/", import.meta.url));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "arena-fallback.json"),
    `${JSON.stringify({ ...rec, source: "LOCAL anvil chain 31337 (mock HyperCore precompiles at testnet-ETH prices, real deploy scripts and Arena service) — replace with a testnet recording via `pnpm demo`" }, null, 1)}\n`,
  );
  console.log(summarize(rec));
  console.log("[demo] saved frontend/public/arena-fallback.json (local-chain recording)");
} finally {
  arena?.stop();
  server?.close();
  await chain.stop();
}
