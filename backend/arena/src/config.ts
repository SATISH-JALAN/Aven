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
  DATA_DIR: z.string().default(`${backendDir}data/arena`),
  DEPLOYMENTS_DIR: z.string().optional(),
});

export type ArenaConfig = z.infer<typeof configSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ArenaConfig {
  const c = configSchema.parse(env);
  return { ...c, corsOrigins: c.ARENA_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) };
}
