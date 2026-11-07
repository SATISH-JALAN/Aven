"use client";
/**
 * Direct chain reads from the browser (no Arena service needed): block polling, previewFee, and verification of any
 * tx with the exact TypeScript port (@aven/core/verify). HyperEVM's RPC has no websockets, so everything polls.
 */
import { useSyncExternalStore } from "react";
import { createPublicClient, defineChain, getAbiItem, type Hex, type PublicClient } from "viem";
import { avenHookAbi } from "@aven/core/abi";
import { verifyTx, type VerifyResult, type VerifyTarget } from "@aven/core/verify";
import { config, type Deployments } from "@/config";
import { balancedTransport, rpcBalancer } from "@/lib/rpc";

export const appChain = defineChain({
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: config.rpcUrls } },
  ...(config.explorer ? { blockExplorers: { default: { name: "Explorer", url: config.explorer } } } : {}),
  ...(config.multicall3 ? { contracts: { multicall3: { address: config.multicall3 } } } : {}),
  testnet: config.testnet,
});

let client: PublicClient | null = null;
export function publicClient(): PublicClient {
  // cacheTime 0 + 250 ms receipt polling: viem's 4 s defaults miss blocks on a 1 s chain (docs/LOADTEST.md fixes 1–2).
  // The transport balances over every endpoint in config.rpcUrls (src/lib/rpc.ts); reads made in the same tick go
  // out as one Multicall3 call where the chain has it.
  client ??= createPublicClient({
    chain: appChain,
    transport: balancedTransport(config.rpcUrls),
    batch: config.multicall3 ? { multicall: { wait: 8 } } : undefined,
    cacheTime: 0,
    pollingInterval: 250,
  }) as PublicClient;
  return client;
}

export type RpcStatus = {
  block: bigint | null;
  error: string | null;
  updatedAt: number | null;
  /** Endpoints not cooling down after a throttle or failure, out of `total`. */
  healthy: number;
  total: number;
};

// One shared eth_blockNumber poller for the whole app (nav, banner, pages), started on first subscriber.
let rpcState: RpcStatus = { block: null, error: null, updatedAt: null, healthy: config.rpcUrls.length, total: config.rpcUrls.length };
const rpcListeners = new Set<() => void>();
let rpcTimer: ReturnType<typeof setInterval> | null = null;
async function rpcTick() {
  // Hidden tabs don't poll: the public RPCs' limits are per IP, shared by every open tab.
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const total = config.rpcUrls.length;
  try {
    const b = await publicClient().getBlockNumber({ cacheTime: 0 });
    // Never step back: two endpoints can be a block apart; the head shown only moves forward.
    const block = rpcState.block !== null && rpcState.block > b ? rpcState.block : b;
    rpcState = { block, error: null, updatedAt: Date.now(), healthy: rpcBalancer()?.healthy() ?? total, total };
  } catch (e) {
    rpcState = { ...rpcState, error: (e as Error).message.split(/\r?\n/)[0] ?? "RPC error", healthy: rpcBalancer()?.healthy() ?? 0, total };
  }
  rpcListeners.forEach((l) => l());
}
function rpcSubscribe(l: () => void) {
  rpcListeners.add(l);
  if (!rpcTimer) {
    void rpcTick();
    rpcTimer = setInterval(rpcTick, config.blockPollMs);
  }
  return () => {
    rpcListeners.delete(l);
    if (!rpcListeners.size && rpcTimer) {
      clearInterval(rpcTimer);
      rpcTimer = null;
    }
  };
}
const SERVER_RPC: RpcStatus = { block: null, error: null, updatedAt: null, healthy: config.rpcUrls.length, total: config.rpcUrls.length };

/** Latest block via eth_blockNumber. `error` is set while the RPC is down; the last good block is kept. */
export function useBlockNumber(): RpcStatus {
  return useSyncExternalStore(rpcSubscribe, () => rpcState, () => SERVER_RPC);
}

export function verifyTarget(d: Deployments): VerifyTarget {
  return { hook: d.hook, poolManager: d.poolManager, avenPoolId: d.pools.aven.id, config: d.config, params: d.params };
}

export const verifyTxInBrowser = (tx: Hex, d: Deployments) => verifyTx(publicClient(), tx, verifyTarget(d));

/**
 * Verify a known list of swaps (the Arena's trades, or a same-chain recording's), one every `gapMs`. A scan since
 * deployment doesn't fit mainnet: `eth_getLogs` is capped at 50 blocks (recon B.3), so it grows by ~1,700 calls a
 * day, and the public RPC allows 100 requests/min per IP (recon §E.4). Each verify is 2 calls (receipt + slot0);
 * spread over every endpoint in config.rpcUrls that's well inside each endpoint's limit at the default gap.
 */
export async function verifyKnownInBrowser(d: Deployments, hashes: Hex[], onProgress?: (done: number, total: number) => void, gapMs = config.rpcUrls.length > 1 ? 600 : 3_000) {
  const c = publicClient();
  const t = verifyTarget(d);
  let count = 0;
  let checkA = 0;
  let checkB = 0;
  const mismatches: VerifyResult[] = [];
  for (let i = 0; i < hashes.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    const { results } = await verifyTx(c, hashes[i]!, t);
    for (const r of results) {
      count++;
      if (r.checkA) checkA++;
      if (r.checkB) checkB++;
      if (!r.match) mismatches.push(r);
    }
    onProgress?.(i + 1, hashes.length);
  }
  return { count, checkA, checkB, mismatches, txs: hashes.length };
}

/** The newest FeeComputed tx within the last `lookback` blocks (≤ 50-block chunks, newest first). */
export async function latestFeeComputedTx(d: Deployments, lookback = 2_000n): Promise<Hex | null> {
  const c = publicClient();
  const head = await c.getBlockNumber({ cacheTime: 0 });
  const floor = BigInt(d.deployedAtBlock) > head - lookback ? BigInt(d.deployedAtBlock) : head - lookback;
  const event = getAbiItem({ abi: avenHookAbi, name: "FeeComputed" });
  for (let to = head; to >= floor; to -= config.logChunk) {
    const from = to - config.logChunk + 1n > floor ? to - config.logChunk + 1n : floor;
    const logs = await c.getLogs({ address: d.hook, event, fromBlock: from, toBlock: to });
    const last = logs.at(-1);
    if (last?.transactionHash) return last.transactionHash;
    if (from === floor) break;
  }
  return null;
}

/** Live previewFee for both directions straight from the hook (same values the next swap would pay, I6). */
export async function previewBoth(d: Deployments) {
  const c = publicClient();
  const key = d.pools.aven.key;
  const [z, o] = await Promise.all(
    [true, false].map((zeroForOne) =>
      c.readContract({ address: d.hook, abi: avenHookAbi, functionName: "previewFee", args: [key, zeroForOne] }),
    ),
  );
  return { zeroForOne: z, oneForZero: o };
}
