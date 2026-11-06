/** Arena configuration from backend/.env (+ contracts/deployments/<chainId>.json). Validated with zod. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const backendDir = fileURLToPath(new URL("../../", import.meta.url));

/** Minimal .env loader (KEY=VALUE lines; existing process env wins). Keys are never logged. */
export function loadDotEnv(path = `${backendDir}.env`): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, k, v] = m;
    if (process.env[k!] === undefined) process.env[k!] = v!.replace(/^["']|["']$/g, "");
  }
}

const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte private key");

export const configSchema = z.object({
  BOT_PK: hexKey,
  SHOCK_PK: hexKey,
  HYPEREVM_RPC: z.string().url().default("https://rpc.hyperliquid-testnet.xyz/evm"),
  CHAIN_ID: z.coerce.number().int().positive().default(998),
  ARENA_PORT: z.coerce.number().int().positive().default(8787),
  ARENA_ADMIN_TOKEN: z.string().min(8, "ARENA_ADMIN_TOKEN must be at least 8 chars"),
  ARENA_CORS_ORIGINS: z.string().default("http://localhost:3000"),
  /** max exact-input per bot trade, in base / quote token units (human) */
  MAX_TRADE_BASE: z.coerce.number().positive().default(5),
  MAX_TRADE_QUOTE: z.coerce.number().positive().default(10_000),
  /** default shock: buy base with this much quote (MEMORY.md: shock buys so the bot's arb is a sell) */
  SHOCK_QUOTE: z.coerce.number().positive().default(40_000),
  SHOCK_BASE: z.coerce.number().positive().default(15),
  /** auto-pause when the bot holds less native gas token than this (human units) */
  MIN_NATIVE_BALANCE: z.coerce.number().min(0).default(0.01),
  /** USD per native token for the gas term of profit (testnet HYPE has no value: default 0) */
  NATIVE_USD: z.coerce.number().min(0).default(0),
  POLL_MS: z.coerce.number().int().positive().default(500),
  POST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  /**
   * Gas price cap in gwei for bot trades and shocks; 0 = no cap. Required (> 0) on mainnet 999, where the base fee was
   * measured at 0.10-10.8 gwei within 3 hours (2026-11-06). Suggested: 2.
   */
  MAX_GAS_PRICE_GWEI: z.coerce.number().min(0).default(0),
  /** Trust X-Forwarded-For (its LAST entry, the one our own proxy adds). Only behind a proxy such as cloudflared. */
  ARENA_TRUST_PROXY: z
    .string()
    .default("0")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  /** Max concurrent SSE clients (each holds a socket). */
  ARENA_MAX_SSE_CLIENTS: z.coerce.number().int().positive().default(500),
  /** GET /verify/:tx per client per minute (uncached verifies cost several RPC calls). */
  ARENA_VERIFY_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  DATA_DIR: z.string().default(`${backendDir}data/arena`),
  DEPLOYMENTS_DIR: z.string().optional(),
}).superRefine((c, ctx) => {
  // Mainnet: gas is real money. With NATIVE_USD = 0 the bot would value gas at $0 and send trades whose profit
  // doesn't cover their real HYPE gas cost (pre-mainnet audit, docs/SECURITY.md).
  if (c.CHAIN_ID === 999 && !(c.NATIVE_USD > 0)) {
    ctx.addIssue({ code: "custom", path: ["NATIVE_USD"], message: "NATIVE_USD must be > 0 on mainnet (999): set it to the HYPE price in USD" });
  }
  if (c.CHAIN_ID === 999 && !(c.MAX_GAS_PRICE_GWEI > 0)) {
    ctx.addIssue({ code: "custom", path: ["MAX_GAS_PRICE_GWEI"], message: "MAX_GAS_PRICE_GWEI must be > 0 on mainnet (999), e.g. 2: the base fee spikes past 10 gwei" });
  }
  // Mainnet: the admin token guards actions that spend real gas, so it must be long and random (e.g. openssl rand -hex 24).
  if (c.CHAIN_ID === 999 && c.ARENA_ADMIN_TOKEN.length < 24) {
    ctx.addIssue({ code: "custom", path: ["ARENA_ADMIN_TOKEN"], message: "ARENA_ADMIN_TOKEN must be at least 24 random characters on mainnet (999)" });
  }
});

export type ArenaConfig = z.infer<typeof configSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ArenaConfig {
  const c = configSchema.parse(env);
  return { ...c, corsOrigins: c.ARENA_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) };
}
