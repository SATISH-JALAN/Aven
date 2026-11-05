/**
 * Pure trading math for the Arena bot (ARCHITECTURE §7.2). No I/O; unit-tested in test/math.test.ts.
 * Prices are wad BigInt (quote per base, decimals-adjusted, same convention as @aven/core poolWad/oracleWad).
 * USD values are display numbers (quote token = $1); they never feed fee math.
 */
import { oracleWad, poolWad, sqrtPriceFromWad, type Config } from "@aven/core";
import type { Direction, PoolName, PoolStats, Stats, Trade } from "./types.ts";

export const WAD = 10n ** 18n;
export const PIPS = 1_000_000n;
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

/** Signed gap in bp: (pool - oracle) / oracle (integer, truncated toward zero). */
export function gapBps(poolW: bigint, oracleW: bigint): bigint {
  return ((poolW - oracleW) * 10_000n) / oracleW;
}

/** Step 2: arb direction. Pool above fair -> sell base; below -> buy base; |gap| < 1 bp -> no trade. */
export function arbDirection(poolW: bigint, oracleW: bigint): Direction | null {
  const g = gapBps(poolW, oracleW);
  if (g === 0n) return null;
  return g > 0n ? "sellBase" : "buyBase";
}

/** zeroForOne for a direction: selling base is zeroForOne iff base is token0. */
export function zeroForOneOf(cfg: Config, d: Direction): boolean {
  return d === "sellBase" ? cfg.baseIsToken0 : !cfg.baseIsToken0;
}

/** Step 4: break-even target. Selling base: p* = oracle / (1 - f); buying base: p* = oracle * (1 - f). */
export function targetPriceWad(oracleW: bigint, feePips: number, d: Direction): bigint {
  const f = BigInt(feePips);
  if (f >= PIPS) throw new RangeError("fee >= 100%");
  return d === "sellBase" ? (oracleW * PIPS) / (PIPS - f) : (oracleW * (PIPS - f)) / PIPS;
}

/**
 * Is trading toward p* profitable at all? Selling base only pays while the pool price is above p*; buying base only
 * while it is below. (The marginal trade at p* breaks even after the fee.)
 */
export function worthTrading(poolW: bigint, pStarW: bigint, d: Direction): boolean {
  return d === "sellBase" ? poolW > pStarW : poolW < pStarW;
}

/** sqrtPriceLimitX96 for p*, clamped inside v4's open interval (MIN_SQRT_PRICE, MAX_SQRT_PRICE). */
export function sqrtPriceLimit(cfg: Config, pStarW: bigint): bigint {
  let s = sqrtPriceFromWad(cfg, pStarW);
  if (s <= MIN_SQRT_PRICE) s = MIN_SQRT_PRICE + 1n;
  if (s >= MAX_SQRT_PRICE) s = MAX_SQRT_PRICE - 1n;
  return s;
}

/** Sanity: v4 requires limit < current for zeroForOne and > current for oneForZero. */
export function limitOnCorrectSide(currentSqrt: bigint, limit: bigint, zeroForOne: boolean): boolean {
  return zeroForOne ? limit < currentSqrt : limit > currentSqrt;
}

export interface PlannedTrade {
  direction: Direction;
  zeroForOne: boolean;
  feePips: number;
  pStarWad: bigint;
  sqrtPriceLimitX96: bigint;
  /** exact-input amount in the input token's smallest unit (capped) */
  amountIn: bigint;
}

/** Full plan for one pool, or null if there is nothing profitable to do. */
export function planArb(args: {
  cfg: Config;
  oracleRaw: bigint;
  sqrtPriceX96: bigint;
  feePips: number;
  maxTradeBase: bigint;
  maxTradeQuote: bigint;
}): PlannedTrade | null {
  const oW = oracleWad(args.cfg, args.oracleRaw);
  const pW = poolWad(args.cfg, args.sqrtPriceX96);
  const d = arbDirection(pW, oW);
  if (!d) return null;
  const pStar = targetPriceWad(oW, args.feePips, d);
  if (!worthTrading(pW, pStar, d)) return null;
  const zeroForOne = zeroForOneOf(args.cfg, d);
  const limit = sqrtPriceLimit(args.cfg, pStar);
  if (!limitOnCorrectSide(args.sqrtPriceX96, limit, zeroForOne)) return null;
  return {
    direction: d,
    zeroForOne,
    feePips: args.feePips,
    pStarWad: pStar,
    sqrtPriceLimitX96: limit,
    amountIn: d === "sellBase" ? args.maxTradeBase : args.maxTradeQuote,
  };
}

// ------------------------------------------------------------------------------------------------ valuation

/** v4 BalanceDelta (int256) -> (amount0, amount1) as signed int128 each (negative = paid by the swapper). */
export function decodeBalanceDelta(delta: bigint): { amount0: bigint; amount1: bigint } {
  const mask = (1n << 128n) - 1n;
  const toSigned = (x: bigint) => (x >= 1n << 127n ? x - (1n << 128n) : x);
  const d = BigInt.asUintN(256, delta);
  return { amount0: toSigned(d >> 128n), amount1: toSigned(d & mask) };
}

/** Human amount (display). */
export function units(x: bigint, decimals: number): number {
  return Number(x) / 10 ** decimals;
}

export interface Valuation {
  amountIn: bigint; // input token units (positive)
  amountOut: bigint; // output token units (positive)
  inUsd: number;
  outUsd: number;
  feeUsd: number; // fee charged on the input, valued at oracle
}

/** Values a swap's deltas at the oracle price (quote = $1). `feePips` is the LP fee charged on the input token. */
export function valueSwap(cfg: Config, delta: { amount0: bigint; amount1: bigint }, oraclePrice: number, feePips: number): Valuation {
  const [d0, d1] = [delta.amount0, delta.amount1];
  const in0 = d0 < 0n;
  const amountIn = in0 ? -d0 : -d1;
  const amountOut = in0 ? d1 : d0;
  const decIn = in0 ? cfg.decimals0 : cfg.decimals1;
  const decOut = in0 ? cfg.decimals1 : cfg.decimals0;
  const inIsBase = in0 === cfg.baseIsToken0;
  const usd = (amt: bigint, dec: number, isBase: boolean) => units(amt, dec) * (isBase ? oraclePrice : 1);
  const inUsd = usd(amountIn, decIn, inIsBase);
  const outUsd = usd(amountOut, decOut, !inIsBase);
  return { amountIn, amountOut, inUsd, outUsd, feeUsd: (inUsd * feePips) / 1e6 };
}

/** Bot profit = value(out) - value(in) - gas, all at oracle (§7.2 step 6). */
export function botProfitUsd(v: Valuation, gasCostUsd: number): number {
  return v.outUsd - v.inUsd - gasCostUsd;
}

// ------------------------------------------------------------------------------------------------ stats

const emptyStats = (): PoolStats => ({ trades: 0, botProfitUsd: 0, lpFeeIncomeUsd: 0, volumeUsd: 0 });

/** Per-pool stats over BOT (arb) trades since `since`; lpKeptMoreUsd = aven.lpFeeIncome - control.lpFeeIncome. */
export function computeStats(trades: readonly Trade[], since: number): Stats {
  const s: Record<PoolName, PoolStats> = { aven: emptyStats(), control: emptyStats() };
  for (const t of trades) {
    if (t.ts < since || t.kind !== "arb") continue;
    const p = s[t.pool];
    p.trades += 1;
    p.botProfitUsd += t.botProfitUsd;
    p.lpFeeIncomeUsd += t.lpFeeIncomeUsd;
    p.volumeUsd += t.feePips > 0 ? (t.feeUsd * 1e6) / t.feePips : 0; // input value at oracle (feeUsd = in * fee)
  }
  return {
    since,
    control: s.control,
    aven: s.aven,
    lpKeptMoreUsd: s.aven.lpFeeIncomeUsd - s.control.lpFeeIncomeUsd,
    botProfitDiffUsd: s.aven.botProfitUsd - s.control.botProfitUsd,
  };
}
