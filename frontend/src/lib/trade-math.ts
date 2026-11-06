/**
 * Pure trade math shared by the Trade, Swap and Pool pages (and their tests, and the local integration check):
 * which token goes in, the indicative quote, the fee each pool charges now, and liquidity-range sizing.
 * Also the exact contract arguments the app sends (swap, add liquidity) and its gas margin, so the hooks and
 * backend/arena/scripts/check-frontend.ts send identical transactions.
 * No React, no I/O. Fee math itself is not here: it is BigInt in @aven/core.
 */
import { parseUnits, type Hex } from "viem";
import type { Deployments } from "@/config";
import type { Direction, PoolName, StateResponse } from "@/lib/types";

export function tokenSide(d: Deployments, side: Direction) {
  const cfg = d.config;
  const sell = side === "sellBase";
  const baseDec = cfg.baseIsToken0 ? cfg.decimals0 : cfg.decimals1;
  const quoteDec = cfg.baseIsToken0 ? cfg.decimals1 : cfg.decimals0;
  return {
    tokenIn: sell ? d.tokens.base : d.tokens.quote,
    tokenOut: sell ? d.tokens.quote : d.tokens.base,
    inSym: sell ? d.tokens.baseSymbol : d.tokens.quoteSymbol,
    outSym: sell ? d.tokens.quoteSymbol : d.tokens.baseSymbol,
    inDec: sell ? baseDec : quoteDec,
    outDec: sell ? quoteDec : baseDec,
    zeroForOne: sell ? cfg.baseIsToken0 : !cfg.baseIsToken0,
  };
}

/** The fee each pool would charge on this side right now: Aven from previewFee (via /state), plain = its static fee. */
export function feeFor(state: StateResponse | null, pool: PoolName, side: Direction): number | null {
  const fp = state?.pools[pool]?.feePreview;
  if (!fp) return pool === "control" ? 3000 : null;
  return "fixedPips" in fp ? fp.fixedPips : fp[side].fee;
}

/**
 * Indicative output before price impact: amount × pool price × (1 − fee). The pools are AMMs, so the real output is a
 * little lower for size; the UI says so next to the number.
 */
export function indicativeOut(amountIn: number, side: Direction, poolPrice: number, feePips: number): number {
  if (!(amountIn > 0) || !(poolPrice > 0)) return 0;
  const net = amountIn * (1 - feePips / 1e6);
  return side === "sellBase" ? net * poolPrice : net / poolPrice;
}

const Q = 1.0001;

export interface LiquidityPlan {
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  baseAmount: number;
  quoteAmount: number;
  priceLower: number;
  priceUpper: number;
}

/** Human price (quote per base) ↔ raw token1/token0 price. */
function rawPrice(d: Deployments, humanPrice: number): number {
  const c = d.config;
  return (c.baseIsToken0 ? humanPrice : 1 / humanPrice) * 10 ** (c.decimals1 - c.decimals0);
}
function humanPrice(d: Deployments, raw: number): number {
  const c = d.config;
  const p = raw / 10 ** (c.decimals1 - c.decimals0);
  return c.baseIsToken0 ? p : 1 / p;
}

/** Plan a position: `rangePct` = half-width around the pool price (e.g. 10 → ±10%), `baseAmount` in base tokens. */
export function planLiquidity(d: Deployments, pool: PoolName, poolPrice: number, rangePct: number, baseAmount: number): LiquidityPlan | null {
  if (!(poolPrice > 0) || !(baseAmount > 0) || !(rangePct > 0)) return null;
  const c = d.config;
  const spacing = d.pools[pool].key.tickSpacing;
  const raw = rawPrice(d, poolPrice);
  const tickAt = (r: number) => Math.log(r) / Math.log(Q);
  const lo = Math.floor(tickAt(raw * (1 - rangePct / 100)) / spacing) * spacing;
  const hi = Math.ceil(tickAt(raw * (1 + rangePct / 100)) / spacing) * spacing;
  const sp = Math.sqrt(raw);
  const sa = Math.sqrt(Q ** lo);
  const sb = Math.sqrt(Q ** hi);
  if (!(sa < sp && sp < sb)) return null;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  const baseRaw = baseAmount * 10 ** baseDec;
  let L: number;
  let quoteRaw: number;
  if (c.baseIsToken0) {
    L = (baseRaw * sp * sb) / (sb - sp); // amount0 → L
    quoteRaw = L * (sp - sa); // amount1 for that L
  } else {
    L = baseRaw / (sp - sa); // amount1 → L
    quoteRaw = (L * (sb - sp)) / (sp * sb); // amount0 for that L
  }
  return {
    tickLower: lo,
    tickUpper: hi,
    liquidity: L,
    baseAmount,
    quoteAmount: quoteRaw / 10 ** quoteDec,
    priceLower: Math.min(humanPrice(d, Q ** lo), humanPrice(d, Q ** hi)),
    priceUpper: Math.max(humanPrice(d, Q ** lo), humanPrice(d, Q ** hi)),
  };
}


// ---- contract arguments (shared by the hooks and the local integration check) ----

export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

/** The Arena's margin (docs/SECURITY.md): estimateGas sees the cheap later-in-block path; the first swap of a block costs more. */
export const withGasMargin = (est: bigint) => (est * 13n) / 10n + 30_000n;

/** PoolSwapTest.swap args: exact input of `value` (raw units of the token going in), no price limit. */
export function swapArgs(d: Deployments, pool: PoolName, side: Direction, value: bigint) {
  const zeroForOne = tokenSide(d, side).zeroForOne;
  return [
    d.pools[pool].key,
    { zeroForOne, amountSpecified: -value, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n },
    { takeClaims: false, settleUsingBurn: false },
    "0x",
  ] as const;
}

/** What the liquidity router may pull: the plan's amounts plus 2% headroom (the position is sized 0.5% under the plan). */
export function liquidityNeeds(d: Deployments, plan: LiquidityPlan) {
  const c = d.config;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  return [
    { token: d.tokens.base, sym: d.tokens.baseSymbol, value: parseUnits((plan.baseAmount * 1.02).toFixed(Math.min(baseDec, 8)), baseDec) },
    { token: d.tokens.quote, sym: d.tokens.quoteSymbol, value: parseUnits((plan.quoteAmount * 1.02).toFixed(Math.min(quoteDec, 8)), quoteDec) },
  ];
}

/** PoolModifyLiquidityTest.modifyLiquidity (three-argument overload) args for the plan. */
export function liquidityArgs(d: Deployments, pool: PoolName, plan: LiquidityPlan) {
  const liquidityDelta = BigInt(Math.floor(plan.liquidity * 0.995));
  return [d.pools[pool].key, { tickLower: plan.tickLower, tickUpper: plan.tickUpper, liquidityDelta, salt: `0x${"0".repeat(64)}` as Hex }, "0x"] as const;
}
