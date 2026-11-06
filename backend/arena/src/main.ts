/**
 * Entry point: `pnpm --filter @aven/arena start` (or `dev`). Reads backend/.env and contracts/deployments/<CHAIN_ID>.json,
 * starts the poller/bot loops and serves the API on ARENA_PORT (default 8787). Run it on a laptop and expose it with
 * `cloudflared tunnel --url http://localhost:8787` (Vercel can't host the loop, ARCHITECTURE §12).
 */
import { serve } from "@hono/node-server";
import { loadDeployments } from "@aven/core";
import { Arena } from "./arena.ts";
import { makeChain } from "./chain.ts";
import { loadConfig, loadDotEnv } from "./config.ts";
import { makeApp } from "./server.ts";

loadDotEnv();
const cfg = loadConfig();
const deployments = loadDeployments(cfg.CHAIN_ID, cfg.DEPLOYMENTS_DIR);
const chain = makeChain({ rpcUrl: cfg.HYPEREVM_RPC, chainId: cfg.CHAIN_ID, botPk: cfg.BOT_PK as `0x${string}`, shockPk: cfg.SHOCK_PK as `0x${string}`, deployments });
const arena = new Arena(cfg, chain);
await arena.start();
const app = makeApp(arena, {
  adminToken: cfg.ARENA_ADMIN_TOKEN,
  corsOrigins: cfg.corsOrigins,
  postRateLimitPerMin: cfg.POST_RATE_LIMIT_PER_MIN,
  trustProxy: cfg.ARENA_TRUST_PROXY,
  maxSseClients: cfg.ARENA_MAX_SSE_CLIENTS,
  verifyLimitPerMin: cfg.ARENA_VERIFY_LIMIT_PER_MIN,
});
serve({ fetch: app.fetch, port: cfg.ARENA_PORT });
console.log(`[arena] chain ${cfg.CHAIN_ID}, hook ${deployments.hook}, listening on :${cfg.ARENA_PORT} (bot ${chain.bot.account.address}, shock ${chain.shock.account.address})`);

const shutdown = () => {
  arena.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
