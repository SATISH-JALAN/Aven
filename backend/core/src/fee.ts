/**
 * Exact BigInt port of contracts/src/AvenFairValue.sol (docs/spec/ARCHITECTURE.md §6.2–§6.4).
 *
 * Rules (I7): integer-only, no floating point anywhere. Unsigned division floors; signed division truncates toward
 * zero (BigInt `/` does both, same as Solidity). `mulDiv(a, b, d)` = `(a * b) / d` on BigInt, which equals v4-core
 * FullMath.mulDiv (512-bit, floor) because BigInt has no overflow. Every function mirrors its Solidity twin line by
 * line, in the same order, so a reviewer can diff them side by side.
 */

export const Q96 = 2n ** 96n;
export const MAX_FEE_CAP = 100_000;
export const MIN_PRECOMPILE_GAS = 10_000;
export const MAX_TOKEN_DECIMALS = 18;

/** §6.2 Config. */
export interface Config {
  perpIndex: number; // uint32
  szDecimals: number; // uint8, <= 6
  baseIsToken0: boolean;
  decimals0: number; // uint8, <= 18
  decimals1: number; // uint8, <= 18
}

/** §6.2 Params. Fees in pips (1e6 = 100%). */
export interface Params {
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

/** §6.2 Inputs: exactly the FeeComputed fields (§8.1) plus readOk. */
export interface Inputs {
  oracleRaw: bigint; // uint64
  markRaw: bigint; // uint64
  anchorMarkRaw: bigint; // uint64, 0 = none
  sqrtPriceX96: bigint; // uint160
  sqrtPriceTopX96: bigint; // uint160
  zeroForOne: boolean;
  readOk: boolean;
}

export const Reason = { OK: 0, READ_FAILED: 1, GAP_TOO_LARGE: 2 } as const;
export type ReasonCode = (typeof Reason)[keyof typeof Reason];
export const REASON_NAMES = ["OK", "READ_FAILED", "GAP_TOO_LARGE"] as const;
export type ReasonName = (typeof REASON_NAMES)[number];

/** §6.2 Breakdown. */
export interface Breakdown {
  fee: number; // uint24
  reason: ReasonCode;
  gapBps: bigint;
  premiumBps: bigint; // signed
  moveBps: bigint;
  arb: boolean;
  withPressure: boolean;
}

export class InvalidParamsError extends Error {
  constructor(rule: string) {
    super(`InvalidParams: ${rule}`);
    this.name = "InvalidParamsError";
  }
}

// ------------------------------------------------------------------------------------------------ §6.2

export function defaultParams(): Params {
  return {
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
}

/** Mirrors AvenFairValue.validateParams (throws instead of reverting). */
export function validateParams(cfg: Config, p: Params): void {
  if (p.minFee > p.baseFee || p.baseFee > p.maxFee) throw new InvalidParamsError("minFee <= baseFee <= maxFee");
  if (p.minFee > p.fallbackFee || p.fallbackFee > p.maxFee) throw new InvalidParamsError("minFee <= fallbackFee <= maxFee");
  if (p.maxFee > MAX_FEE_CAP) throw new InvalidParamsError("maxFee <= 100_000");
  if (p.stressTauSec === 0) throw new InvalidParamsError("stressTauSec > 0");
  if (p.maxGapBps === 0) throw new InvalidParamsError("maxGapBps > 0");
  if (p.precompileGas < MIN_PRECOMPILE_GAS) throw new InvalidParamsError("precompileGas >= 10_000");
  if (cfg.szDecimals > 6) throw new InvalidParamsError("szDecimals <= 6");
  if (cfg.decimals0 > MAX_TOKEN_DECIMALS || cfg.decimals1 > MAX_TOKEN_DECIMALS) {
    throw new InvalidParamsError("token decimals <= 18");
  }
}

// ------------------------------------------------------------------------------------------------ §6.3 Step 3

export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("mulDiv: division by zero");
  return (a * b) / d;
}

/** raw * 10^(12 + szDecimals). */
export function oracleWad(cfg: Config, raw: bigint): bigint {
  return raw * 10n ** BigInt(12 + cfg.szDecimals);
}

/** Base price in quote, decimals-adjusted, wad. Same mulDiv order as Solidity. */
export function poolWad(cfg: Config, sqrtPriceX96: bigint): bigint {
  const sp = sqrtPriceX96;
  if (cfg.baseIsToken0) {
    const pX96 = mulDiv(sp, sp, Q96);
    return mulDiv(pX96, 10n ** BigInt(18 + cfg.decimals0), 10n ** BigInt(cfg.decimals1) * Q96);
  } else {
    const a = mulDiv(10n ** BigInt(18 + cfg.decimals1), Q96, sp);
    return mulDiv(a, Q96, sp * 10n ** BigInt(cfg.decimals0));
  }
}

// ------------------------------------------------------------------------------------------------ §6.3 Steps 2-8

const absDiff = (a: bigint, b: bigint): bigint => (a > b ? a - b : b - a);
const abs = (x: bigint): bigint => (x >= 0n ? x : -x);

export function compute(cfg: Config, p: Params, inp: Inputs): Breakdown {
  const b: Breakdown = { fee: 0, reason: Reason.OK, gapBps: 0n, premiumBps: 0n, moveBps: 0n, arb: false, withPressure: false };

  // Step 2 — fallback on bad read.
  if (!inp.readOk) {
    b.fee = p.fallbackFee;
    b.reason = Reason.READ_FAILED;
    return b;
  }

  // Step 3 — prices in wad.
  const oWad = oracleWad(cfg, inp.oracleRaw);
  const curWad = poolWad(cfg, inp.sqrtPriceX96);
  const topWad = poolWad(cfg, inp.sqrtPriceTopX96);

  // Step 4 — gap with top-of-block anchor.
  const gapCur = mulDiv(absDiff(curWad, oWad), 10_000n, oWad);
  const gapTop = mulDiv(absDiff(topWad, oWad), 10_000n, oWad);
  const above = curWad > oWad;
  const below = curWad < oWad;
  const topSameSide = (above && topWad > oWad) || (below && topWad < oWad);
  b.gapBps = topSameSide ? (gapCur > gapTop ? gapCur : gapTop) : gapCur;
  if (b.gapBps > BigInt(p.maxGapBps)) {
    b.fee = p.fallbackFee;
    b.reason = Reason.GAP_TOO_LARGE;
    return b;
  }

  // Step 5 — direction.
  const sellingBase = cfg.baseIsToken0 ? inp.zeroForOne : !inp.zeroForOne;
  b.arb = (above && sellingBase) || (below && !sellingBase);

  // Step 6 — perp pressure (BigInt `/` truncates toward zero, like Solidity int256).
  b.premiumBps = ((inp.markRaw - inp.oracleRaw) * 10_000n) / inp.oracleRaw;
  b.withPressure = (b.premiumBps > 0n && !sellingBase) || (b.premiumBps < 0n && sellingBase);

  // Step 7 — stress against the time-weighted mark anchor.
  if (inp.anchorMarkRaw !== 0n) {
    b.moveBps = (absDiff(inp.markRaw, inp.anchorMarkRaw) * 10_000n) / inp.anchorMarkRaw;
  }

  // Step 8 — combine and clamp.
  let raw = BigInt(p.baseFee);
  if (b.arb) raw += b.gapBps * BigInt(p.gapWeight);
  if (b.withPressure) raw += abs(b.premiumBps) * BigInt(p.premiumWeight);
  if (b.moveBps > BigInt(p.stressThresholdBps)) raw += (b.moveBps - BigInt(p.stressThresholdBps)) * BigInt(p.stressWeight);
  if (raw < BigInt(p.minFee)) raw = BigInt(p.minFee);
  if (raw > BigInt(p.maxFee)) raw = BigInt(p.maxFee);
  b.fee = Number(raw);
  b.reason = Reason.OK;
  return b;
}

// ------------------------------------------------------------------------------------------------ §6.4 step 5

/** Time-weighted mark anchor. Mirrors AvenFairValue.advanceAnchor. Requires nowTs >= anchorTime. */
export function advanceAnchor(
  anchorMark: bigint,
  anchorTime: bigint,
  markRaw: bigint,
  nowTs: bigint,
  tau: bigint,
): { mark: bigint; time: bigint } {
  if (nowTs < anchorTime) throw new RangeError("advanceAnchor: nowTs < anchorTime");
  const dt = nowTs - anchorTime;
  let mark: bigint;
  if (anchorTime === 0n || dt >= tau) {
    mark = markRaw;
  } else {
    mark = anchorMark + ((markRaw - anchorMark) * dt) / tau; // signed, truncating toward zero
  }
  return { mark, time: nowTs };
}

// ------------------------------------------------------------------------------------------------ v4 fee plumbing

/** v4-core ProtocolFeeLibrary.calculateSwapFee for one direction. With protocolFee 0 it returns lpFee. */
export function calculateSwapFee(protocolFee: number, zeroForOne: boolean, lpFee: number): number {
  const dirFee = BigInt(zeroForOne ? protocolFee & 0xfff : (protocolFee >> 12) & 0xfff);
  const lp = BigInt(lpFee & 0xffffff);
  return Number(dirFee + lp - (dirFee * lp) / 1_000_000n);
}

export function reasonName(r: number): ReasonName {
  const n = REASON_NAMES[r];
  if (!n) throw new RangeError(`unknown reason ${r}`);
  return n;
}
