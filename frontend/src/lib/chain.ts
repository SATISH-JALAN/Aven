"use client";
/**
 * Direct chain reads from the browser (no Arena service needed): block polling, previewFee, and verification of any
 * tx with the exact TypeScript port (@aven/core/verify). HyperEVM's RPC has no websockets, so everything polls.
 */
import { useSyncExternalStore } from "react";
import { createPublicClient, defineChain, getAbiItem, http, type Hex, type PublicClient } from "viem";
import { avenHookAbi } from "@aven/core/abi";
import { verifyAll, verifyTx, type VerifyTarget } from "@aven/core/verify";
import { config, type Deployments } from "@/config";

export const appChain = defineChain({
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  ...(config.explorer ? { blockExplorers: { default: { name: "Explorer", url: config.explorer } } } : {}),
  testnet: config.testnet,
});

let client: PublicClient | null = null;
export function publicClient(): PublicClient {
  // cacheTime 0 + 250 ms receipt polling: viem's 4 s defaults miss blocks on a 1 s chain (docs/LOADTEST.md fixes 1–2).
  client ??= createPublicClient({ chain: appChain, transport: http(config.rpcUrl, { timeout: 12_000 }), cacheTime: 0, pollingInterval: 250 }) as PublicClient;
  return client;
}

export type RpcStatus = { block: bigint | null; error: string | null; updatedAt: number | null };

// One shared eth_blockNumber poller for the whole app (nav, banner, pages), started on first subscriber.
let rpcState: RpcStatus = { block: null, error: null, updatedAt: null };
const rpcListeners = new Set<() => void>();
let rpcTimer: ReturnType<typeof setInterval> | null = null;
async function rpcTick() {
  try {
    const b = await publicClient().getBlockNumber({ cacheTime: 0 });
    rpcState = { block: b, error: null, updatedAt: Date.now() };
  } catch (e) {
    rpcState = { ...rpcState, error: (e as Error).message.split(/\r?\n/)[0] ?? "RPC error" };
  }
  rpcListeners.forEach((l) => l());
}
function rpcSubscribe(l: () => void) {
  rpcListeners.add(l);
  if (!rpcTimer) {
    void rpcTick();
    rpcTimer = setInterval(rpcTick, config.pollMs);
  }
  return () => {
    rpcListeners.delete(l);
    if (!rpcListeners.size && rpcTimer) {
      clearInterval(rpcTimer);
      rpcTimer = null;
    }
  };
}
const SERVER_RPC: RpcStatus = { block: null, error: null, updatedAt: null };

/** Latest block via eth_blockNumber. `error` is set while the RPC is down; the last good block is kept. */
export function useBlockNumber(): RpcStatus {
  return useSyncExternalStore(rpcSubscribe, () => rpcState, () => SERVER_RPC);
}

export function verifyTarget(d: Deployments): VerifyTarget {
  return { hook: d.hook, poolManager: d.poolManager, avenPoolId: d.pools.aven.id, config: d.config, params: d.params };
}

export const verifyTxInBrowser = (tx: Hex, d: Deployments) => verifyTx(publicClient(), tx, verifyTarget(d));

export const verifyAllInBrowser = (d: Deployments, onProgress?: (block: bigint, head: bigint) => void) =>
  (async () => {
    const c = publicClient();
    const head = await c.getBlockNumber({ cacheTime: 0 });
    return verifyAll(c, verifyTarget(d), {
      fromBlock: BigInt(d.deployedAtBlock),
      toBlock: head,
      chunk: config.logChunk,
      onProgress: (b) => onProgress?.(b, head),
    });
  })();

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
