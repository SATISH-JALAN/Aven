/**
 * The one config file: chain, RPC, Arena service, addresses, perp index, token decimals, links.
 * Addresses come from src/config/deployments.json (copied from contracts/deployments/<chainId>.json, ARCHITECTURE
 * §8.3, by `pnpm --filter @aven/web sync:deployments`). In LIVE mode the Arena's /config can fill them in at runtime;
 * in RECORDED mode they come from the recorded run.
 */
import deploymentsJson from "@/config/deployments.json";

export type Hex = `0x${string}`;

export interface PoolKeyJson {
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
}

export interface FeeConfig {
  perpIndex: number;
  szDecimals: number;
  baseIsToken0: boolean;
  decimals0: number;
  decimals1: number;
}

export interface FeeParams {
  baseFee: number;
  minFee: number;
  maxFee: number;
  fallbackFee: number;
  gapWeight: number;
  premiumWeight: number;
  stressThresholdBps: number;
  stressWeight: number;
  stressTauSec: number;
  maxGapBps: number;
  precompileGas: number;
}

/** contracts/deployments/<chainId>.json (§8.3). */
export interface Deployments {
  chainId: number;
  deployedAtBlock: number;
  explorer?: string;
  tokens: { base: Hex; quote: Hex; baseSymbol: string; quoteSymbol: string };
  poolManager: Hex;
  swapRouter: Hex;
  liquidityRouter: Hex;
  hook: Hex;
  hookSalt?: Hex;
  pools: { aven: { id: Hex; key: PoolKeyJson }; control: { id: Hex; key: PoolKeyJson } };
  config: FeeConfig;
  params: FeeParams;
}

/** ARCHITECTURE §6.2 defaults (used only to label the parameter table when no deployment is known). */
export const DEFAULT_PARAMS: FeeParams = {
  baseFee: 500,
  minFee: 500,
  maxFee: 10_000,
  fallbackFee: 3_000,
  gapWeight: 50,
  premiumWeight: 50,
  stressThresholdBps: 50,
  stressWeight: 20,
  stressTauSec: 60,
  maxGapBps: 2_000,
  precompileGas: 30_000,
};

const CHAINS: Record<number, { name: string; explorer: string | null; testnet: boolean }> = {
  998: { name: "HyperEVM testnet", explorer: null, testnet: true }, // no testnet explorer (MEMORY.md 2026-11-06)
  999: { name: "HyperEVM", explorer: "https://hyperevmscan.io", testnet: false },
  31337: { name: "Local anvil", explorer: null, testnet: true },
};

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 999); // live chain: HyperEVM mainnet (AGENTS.md §2)
const env = {
  // Aven is deployed on HyperEVM mainnet (999), so that's the default. The public RPC allows 100 requests/min per IP,
  // which one browser stays under; set NEXT_PUBLIC_RPC to a dedicated endpoint for heavier use.
  chainId,
  rpcUrl: process.env.NEXT_PUBLIC_RPC || (chainId === 999 ? "https://rpc.hyperliquid.xyz/evm" : "https://rpc.hyperliquid-testnet.xyz/evm"),
  arenaApi: (process.env.NEXT_PUBLIC_ARENA_API || "").replace(/\/$/, ""),
  mode: (process.env.NEXT_PUBLIC_MODE || "") as "" | "live" | "recorded",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "",
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/SATISH-JALAN/Aven",
  videoUrl: process.env.NEXT_PUBLIC_VIDEO_URL || "",
};

/**
 * Public HyperEVM mainnet RPCs, fastest first (recon §F, measured 2026-11-07): every one answers chain 999 with open
 * CORS, reads the HyperCore precompiles, serves receipts, historical eth_getLogs and JSON-RPC batches. The browser
 * balances over all of them (src/lib/rpc.ts). rpc.hyperlend.finance was rejected: it answered "upstream rate limited".
 */
const MAINNET_RPCS = [
  "https://rpc.hyperliquid.xyz/evm",
  "https://hyperliquid.drpc.org",
  "https://rpc.purroofgroup.com",
  "https://999.rpc.thirdweb.com",
  "https://hyperliquid.rpc.blxrbdn.com",
  "https://hyperliquid-json-rpc.stakely.io",
  "https://rpc.hypurrscan.io",
];
/** NEXT_PUBLIC_RPCS (comma list) replaces the list; NEXT_PUBLIC_RPC goes first. Other chains use NEXT_PUBLIC_RPC only. */
const rpcUrls = (() => {
  const listed = (process.env.NEXT_PUBLIC_RPCS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = [env.rpcUrl, ...(listed.length ? listed : env.chainId === 999 ? MAINNET_RPCS : [])];
  return [...new Set(all)];
})();

const chain = CHAINS[env.chainId] ?? { name: `Chain ${env.chainId}`, explorer: null, testnet: true };
const deployments = (deploymentsJson as Record<string, Deployments>)[String(env.chainId)] ?? null;

export const config = {
  ...env,
  chainName: chain.name,
  testnet: chain.testnet,
  /** Block explorer base URL, or null when none exists (tx links then go to our own /verify/<tx> page). */
  explorer: deployments?.explorer?.startsWith("http") ? deployments.explorer : chain.explorer,
  deployments,
  /** Every RPC endpoint the browser balances over (src/lib/rpc.ts). */
  rpcUrls,
  /** Arena /state fallback polling interval. HyperEVM's RPC has no websockets (recon B.2). */
  pollMs: 2_000,
  /**
   * Block-head polling: one block per second on HyperEVM's small blocks, so 1 s. Affordable because the head poll is
   * spread over every endpoint in `rpcUrls` (2 hedged calls/s ≈ 17 requests/min per endpoint with 7 endpoints).
   */
  blockPollMs: rpcUrls.length > 1 ? 1_000 : 2_000,
  /** Multicall3 (canonical address, code checked on 999 on 2026-11-07); lets one block's reads go out as one call. */
  multicall3: env.chainId === 999 ? ("0xcA11bde05977b3631167028862bE2a173976CA11" as const) : null,
  /** eth_getLogs chunk size (recon B.3). */
  logChunk: 50n,
  /**
   * Hyperliquid info API (read-only market data for the Trade page: candles, order book, funding, open interest).
   * Testnet for the testnet and local chains (local mocks run at testnet-ETH prices), mainnet for 999. CORS is open
   * (`access-control-allow-origin: *`, checked 2026-11-06), so the browser calls it directly.
   */
  hlApi: env.chainId === 999 ? "https://api.hyperliquid.xyz/info" : "https://api.hyperliquid-testnet.xyz/info",
  /** The perp the hook reads (AGENTS.md §2: live asset = ETH; perp index 1 on mainnet, 4 on testnet). */
  hlCoin: "ETH",
  feedbackUrl: `${env.repoUrl}/blob/main/FEEDBACK.md`,
  sourceUrl: (path: string, line?: number) => `${env.repoUrl}/blob/main/${path}${line ? `#L${line}` : ""}`,
} as const;

/** Lines in contracts/src/AvenFairValue.sol, for "see the exact code" links (keep in sync when the file changes). */
export const FV_LINES = {
  readPrices: 122,
  step2: 179,
  step3: 186,
  step4: 191,
  step5: 204,
  step6: 208,
  step7: 213,
  step8: 218,
  advanceAnchor: 236,
} as const;
export const FV_PATH = "contracts/src/AvenFairValue.sol";

export function txHref(tx: string): { href: string; external: boolean } {
  return config.explorer ? { href: `${config.explorer}/tx/${tx}`, external: true } : { href: `/verify/${tx}`, external: false };
}

export function addressHref(addr: string): string | null {
  return config.explorer ? `${config.explorer}/address/${addr}` : null;
}
