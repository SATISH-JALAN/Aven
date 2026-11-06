/**
 * Verifier (ARCHITECTURE §7.3, I8). For a tx: decode every FeeComputed and its matching PoolManager Swap log
 * (same PoolId, the next Swap after it), rebuild Inputs (readOk = reason != READ_FAILED), recompute with the exact
 * TS port, then:
 *   check A: recomputed fee == FeeComputed.fee
 *   check B: Swap.fee == calculateSwapFee(protocolFee, FeeComputed.fee)  (== fee when the protocol fee is 0)
 * Limit (stated in §7.3): this proves the fee is the formula applied to the logged inputs and that the PoolManager
 * charged exactly that; it does not prove the logged oracle/mark equal HyperCore history. The protocol fee is read
 * from the current slot0 (the RPC serves latest state only, recon B.3); our deployment never sets one.
 */
import {
  decodeEventLog,
  getAbiItem,
  isAddressEqual,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { avenHookAbi, poolManagerAbi } from "./abi.ts";
import { Reason, calculateSwapFee, compute, reasonName, type Breakdown, type Config, type Inputs, type Params } from "./fee.ts";
import { readSlot0 } from "./pool.ts";

export interface FeeComputedEvent {
  poolId: Hex;
  sender: Address;
  fee: number;
  reason: number;
  zeroForOne: boolean;
  oracleRaw: bigint;
  markRaw: bigint;
  anchorMarkRaw: bigint;
  sqrtPriceX96: bigint;
  sqrtPriceTopX96: bigint;
}

export interface VerifyResult {
  match: boolean;
  checkA: boolean;
  checkB: boolean;
  onchainFee: number;
  recomputedFee: number;
  swapEventFee: number | null;
  inputs: Record<string, string>;
  breakdown: {
    fee: number;
    reason: "OK" | "READ_FAILED" | "GAP_TOO_LARGE";
    gapBps: number;
    premiumBps: number;
    moveBps: number;
    arb: boolean;
    withPressure: boolean;
  };
  txHash?: Hex;
  logIndex?: number;
}

type AnyLog = Pick<Log, "address" | "data" | "topics"> & { logIndex?: number | null; transactionHash?: Hex | null };

export function decodeFeeComputed(log: AnyLog): FeeComputedEvent | null {
  try {
    const ev = decodeEventLog({ abi: avenHookAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    if (ev.eventName !== "FeeComputed") return null;
    return ev.args as unknown as FeeComputedEvent;
  } catch {
    return null;
  }
}

function decodeSwap(log: AnyLog): { id: Hex; fee: number } | null {
  try {
    const ev = decodeEventLog({ abi: poolManagerAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    if (ev.eventName !== "Swap") return null;
    const a = ev.args as unknown as { id: Hex; fee: number };
    return { id: a.id, fee: Number(a.fee) };
  } catch {
    return null;
  }
}

export function inputsFromEvent(e: FeeComputedEvent): Inputs {
  return {
    oracleRaw: e.oracleRaw,
    markRaw: e.markRaw,
    anchorMarkRaw: e.anchorMarkRaw,
    sqrtPriceX96: e.sqrtPriceX96,
    sqrtPriceTopX96: e.sqrtPriceTopX96,
    zeroForOne: e.zeroForOne,
    readOk: e.reason !== Reason.READ_FAILED,
  };
}

export function breakdownToJson(b: Breakdown): VerifyResult["breakdown"] {
  return {
    fee: b.fee,
    reason: reasonName(b.reason),
    gapBps: Number(b.gapBps),
    premiumBps: Number(b.premiumBps),
    moveBps: Number(b.moveBps),
    arb: b.arb,
    withPressure: b.withPressure,
  };
}

/** Pure core: verify every FeeComputed in `logs` (one tx's receipt logs, in order). */
export function verifyLogs(
  logs: readonly AnyLog[],
  opts: { hook: Address; poolManager: Address; config: Config; params: Params; protocolFee?: number },
): VerifyResult[] {
  const out: VerifyResult[] = [];
  logs.forEach((log, i) => {
    if (!isAddressEqual(log.address, opts.hook)) return;
    const e = decodeFeeComputed(log);
    if (!e) return;
    let swapEventFee: number | null = null;
    for (let j = i + 1; j < logs.length; j++) {
      const l = logs[j]!;
      if (!isAddressEqual(l.address, opts.poolManager)) continue;
      const s = decodeSwap(l);
      if (s && s.id.toLowerCase() === e.poolId.toLowerCase()) {
        swapEventFee = s.fee;
        break;
      }
    }
    const inputs = inputsFromEvent(e);
    const b = compute(opts.config, opts.params, inputs);
    const checkA = b.fee === e.fee && b.reason === e.reason;
    const expectedSwapFee = calculateSwapFee(opts.protocolFee ?? 0, e.zeroForOne, e.fee);
    const checkB = swapEventFee !== null && swapEventFee === expectedSwapFee;
    out.push({
      match: checkA && checkB,
      checkA,
      checkB,
      onchainFee: e.fee,
      recomputedFee: b.fee,
      swapEventFee,
      inputs: {
        poolId: e.poolId,
        sender: e.sender,
        zeroForOne: String(e.zeroForOne),
        reason: reasonName(e.reason),
        oracleRaw: e.oracleRaw.toString(),
        markRaw: e.markRaw.toString(),
        anchorMarkRaw: e.anchorMarkRaw.toString(),
        sqrtPriceX96: e.sqrtPriceX96.toString(),
        sqrtPriceTopX96: e.sqrtPriceTopX96.toString(),
        readOk: String(inputs.readOk),
      },
      breakdown: breakdownToJson(b),
      ...(log.transactionHash ? { txHash: log.transactionHash } : {}),
      ...(log.logIndex != null ? { logIndex: log.logIndex } : {}),
    });
  });
  return out;
}

export interface VerifyTarget {
  hook: Address;
  poolManager: Address;
  avenPoolId: Hex;
  config: Config;
  params: Params;
}

type Client = Pick<PublicClient, "getTransactionReceipt" | "readContract" | "getLogs" | "getBlockNumber">;

/** Verify one tx. `match` is true only if the tx has at least one FeeComputed and every one matches. */
export async function verifyTx(client: Client, txHash: Hex, t: VerifyTarget): Promise<{ match: boolean; results: VerifyResult[] }> {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const { protocolFee } = await readSlot0(client, t.poolManager, t.avenPoolId);
  const results = verifyLogs(receipt.logs, { ...t, protocolFee });
  return { match: results.length > 0 && results.every((r) => r.match), results };
}

const feeComputedEvent = getAbiItem({ abi: avenHookAbi, name: "FeeComputed" });

/** Scan FeeComputed logs from `fromBlock` in <= 50-block chunks (recon B.3) and verify each distinct tx. */
export async function verifyAll(
  client: Client,
  t: VerifyTarget,
  opts: { fromBlock: bigint; toBlock?: bigint; chunk?: bigint; onProgress?: (b: bigint) => void },
): Promise<{ count: number; checkA: number; checkB: number; mismatches: VerifyResult[]; txs: number }> {
  // cacheTime 0: viem caches getBlockNumber (~4 s) by default, which made `verify --all` right after a burst miss
  // the newest blocks (found by the PLAN 7.1 load test).
  const to = opts.toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const chunk = opts.chunk ?? 50n;
  const txs = new Set<Hex>();
  for (let from = opts.fromBlock; from <= to; from += chunk) {
    const end = from + chunk - 1n < to ? from + chunk - 1n : to;
    const logs = await client.getLogs({ address: t.hook, event: feeComputedEvent, fromBlock: from, toBlock: end });
    for (const l of logs) if (l.transactionHash) txs.add(l.transactionHash);
    opts.onProgress?.(end);
  }
  let count = 0;
  let a = 0;
  let b = 0;
  const mismatches: VerifyResult[] = [];
  for (const h of txs) {
    const { results } = await verifyTx(client, h, t);
    for (const r of results) {
      count++;
      if (r.checkA) a++;
      if (r.checkB) b++;
      if (!r.match) mismatches.push(r);
    }
  }
  return { count, checkA: a, checkB: b, mismatches, txs: txs.size };
}
