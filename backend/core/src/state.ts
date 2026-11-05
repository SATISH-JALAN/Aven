/**
 * Port of AvenHook's per-pool state rules (ARCHITECTURE §6.4): top-of-block and the time-weighted mark anchor.
 * Used by the verifier, the replay checker and the Arena bot to predict exactly what `_load` computes.
 */
import { advanceAnchor, type Inputs } from "./fee.ts";

export interface PoolState {
  topBlock: bigint;
  sqrtPriceTopX96: bigint;
  anchorMark: bigint;
  anchorTime: bigint;
  initialized: boolean;
}

/** Top-of-block rule: only the first swap of a block records the pool price (I9). */
export function advanceTop(s: PoolState, blockNumber: bigint, sqrtPriceX96: bigint): PoolState {
  if (blockNumber > s.topBlock) return { ...s, topBlock: blockNumber, sqrtPriceTopX96: sqrtPriceX96 };
  return { ...s };
}

/**
 * Mirrors AvenHook._load: returns the state that beforeSwap would persist and the Inputs (without zeroForOne) the
 * fee is computed from. The anchor advances only when both reads succeeded (I9).
 */
export function load(
  stored: PoolState,
  env: { blockNumber: bigint; timestamp: bigint; sqrtPriceX96: bigint },
  read: { readOk: boolean; oracleRaw: bigint; markRaw: bigint },
  tau: bigint,
): { state: PoolState; inputs: Omit<Inputs, "zeroForOne"> } {
  let s = advanceTop(stored, env.blockNumber, env.sqrtPriceX96);
  const inputs = {
    oracleRaw: read.oracleRaw,
    markRaw: read.markRaw,
    anchorMarkRaw: s.anchorMark,
    sqrtPriceX96: env.sqrtPriceX96,
    sqrtPriceTopX96: s.sqrtPriceTopX96,
    readOk: read.readOk,
  };
  if (read.readOk) {
    const a = advanceAnchor(s.anchorMark, s.anchorTime, read.markRaw, env.timestamp, tau);
    s = { ...s, anchorMark: a.mark, anchorTime: a.time };
  }
  return { state: s, inputs };
}
