import { describe, expect, it } from "vitest";
import { oracleWad, poolWad, sqrtPriceFromWad, type Config } from "@aven/core";
import {
  arbDirection,
  computeStats,
  decodeBalanceDelta,
  limitOnCorrectSide,
  planArb,
  targetPriceWad,
  valueSwap,
  zeroForOneOf,
} from "../src/math.ts";
import { toUnits } from "../src/arena.ts";
import type { Trade } from "../src/types.ts";

// aETH (18) / aUSD (6), testnet ETH perp: szDecimals 4, oracle 2240.02 (recon C.6)
const base0: Config = { perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6 };
const base1: Config = { perpIndex: 4, szDecimals: 4, baseIsToken0: false, decimals0: 6, decimals1: 18 };
const ORACLE = 224_002n;
const poolAt = (cfg: Config, bpsFromFair: bigint) => sqrtPriceFromWad(cfg, (oracleWad(cfg, ORACLE) * (10_000n + bpsFromFair)) / 10_000n);
const within1bp = (a: bigint, b: bigint) => (a > b ? a - b : b - a) * 10_000n <= b;

describe("direction (§7.2 step 2)", () => {
  it("pool above fair sells base, below buys base, |gap| < 1 bp skips", () => {
    const o = oracleWad(base0, ORACLE);
    expect(arbDirection((o * 10_200n) / 10_000n, o)).toBe("sellBase");
    expect(arbDirection((o * 9_800n) / 10_000n, o)).toBe("buyBase");
    expect(arbDirection(o + o / 20_000n, o)).toBeNull(); // 0.5 bp
    expect(arbDirection(o, o)).toBeNull();
  });
  it("zeroForOne mapping for both token orders", () => {
    expect([zeroForOneOf(base0, "sellBase"), zeroForOneOf(base0, "buyBase")]).toEqual([true, false]);
    expect([zeroForOneOf(base1, "sellBase"), zeroForOneOf(base1, "buyBase")]).toEqual([false, true]);
  });
});

describe("target price p* (§7.2 step 4)", () => {
  it("selling base: oracle / (1 - f); buying base: oracle * (1 - f)", () => {
    const o = 2240n * 10n ** 18n;
    expect(targetPriceWad(o, 3000, "sellBase")).toBe((o * 1_000_000n) / 997_000n);
    expect(targetPriceWad(o, 3000, "buyBase")).toBe((o * 997_000n) / 1_000_000n);
    expect(() => targetPriceWad(o, 1_000_000, "sellBase")).toThrow();
  });
});

describe("planArb + sqrtPriceLimit, both token orders", () => {
  for (const [name, cfg] of [["base = token0 (18/6)", base0], ["base = token1 (6/18)", base1]] as const) {
    it(`${name}: pool 2% above fair -> sell base to p*, limit on the correct side`, () => {
      const sp = poolAt(cfg, 200n);
      const plan = planArb({ cfg, oracleRaw: ORACLE, sqrtPriceX96: sp, feePips: 3000, maxTradeBase: 5n * 10n ** 18n, maxTradeQuote: 10_000n * 10n ** 6n })!;
      expect(plan.direction).toBe("sellBase");
      expect(plan.zeroForOne).toBe(cfg.baseIsToken0);
      expect(limitOnCorrectSide(sp, plan.sqrtPriceLimitX96, plan.zeroForOne)).toBe(true);
      expect(within1bp(poolWad(cfg, plan.sqrtPriceLimitX96), plan.pStarWad)).toBe(true);
      expect(plan.amountIn).toBe(5n * 10n ** 18n);
    });
    it(`${name}: pool 2% below fair -> buy base with quote`, () => {
      const sp = poolAt(cfg, -200n);
      const plan = planArb({ cfg, oracleRaw: ORACLE, sqrtPriceX96: sp, feePips: 10_000, maxTradeBase: 1n, maxTradeQuote: 777n })!;
      expect(plan.direction).toBe("buyBase");
      expect(plan.zeroForOne).toBe(!cfg.baseIsToken0);
      expect(limitOnCorrectSide(sp, plan.sqrtPriceLimitX96, plan.zeroForOne)).toBe(true);
      expect(plan.amountIn).toBe(777n);
    });
    it(`${name}: gap inside the fee band -> no trade`, () => {
      expect(planArb({ cfg, oracleRaw: ORACLE, sqrtPriceX96: poolAt(cfg, 20n), feePips: 3000, maxTradeBase: 1n, maxTradeQuote: 1n })).toBeNull();
      expect(planArb({ cfg, oracleRaw: ORACLE, sqrtPriceX96: poolAt(cfg, -80n), feePips: 10_000, maxTradeBase: 1n, maxTradeQuote: 1n })).toBeNull();
    });
  }
  it("a higher fee means a smaller trade target (Aven taxes the arb)", () => {
    const sp = poolAt(base0, 200n);
    const control = planArb({ cfg: base0, oracleRaw: ORACLE, sqrtPriceX96: sp, feePips: 3000, maxTradeBase: 1n, maxTradeQuote: 1n })!;
    const aven = planArb({ cfg: base0, oracleRaw: ORACLE, sqrtPriceX96: sp, feePips: 10_000, maxTradeBase: 1n, maxTradeQuote: 1n })!;
    expect(aven.pStarWad > control.pStarWad).toBe(true); // stops earlier when selling
  });
});

describe("valuation and profit (§7.2 step 6)", () => {
  it("decodes a packed BalanceDelta with negative/positive int128 halves", () => {
    const pack = (a0: bigint, a1: bigint) => (BigInt.asUintN(128, a0) << 128n) | BigInt.asUintN(128, a1);
    expect(decodeBalanceDelta(pack(-5n, 7n))).toEqual({ amount0: -5n, amount1: 7n });
    expect(decodeBalanceDelta(pack(9n, -1n))).toEqual({ amount0: 9n, amount1: -1n });
    expect(decodeBalanceDelta(BigInt.asIntN(256, pack(-5n, 7n)))).toEqual({ amount0: -5n, amount1: 7n }); // signed input
  });
  it("values both legs at oracle; fee on the input", () => {
    // sell 1 aETH (token0) for 2,230 aUSD at oracle 2,240, fee 0.30%
    const v = valueSwap(base0, { amount0: -(10n ** 18n), amount1: 2_230n * 10n ** 6n }, 2240, 3000);
    expect(v.amountIn).toBe(10n ** 18n);
    expect(v.amountOut).toBe(2_230n * 10n ** 6n);
    expect(v.inUsd).toBeCloseTo(2240, 9);
    expect(v.outUsd).toBeCloseTo(2230, 9);
    expect(v.feeUsd).toBeCloseTo(6.72, 9);
    // buy base with quote where base is token1
    const w = valueSwap(base1, { amount0: -(4_500n * 10n ** 6n), amount1: 2n * 10n ** 18n }, 2240, 500);
    expect(w.inUsd).toBeCloseTo(4500, 9);
    expect(w.outUsd).toBeCloseTo(4480, 9);
  });
});

describe("stats", () => {
  const t = (pool: "aven" | "control", kind: "arb" | "retail", ts: number, profit: number, lp: number, feePips: number): Trade => ({
    id: `${pool}${ts}`,
    ts,
    block: ts,
    pool,
    kind,
    direction: "sellBase",
    amountIn: "1",
    amountOut: "1",
    feePips,
    feeUsd: lp,
    botProfitUsd: profit,
    lpFeeIncomeUsd: lp,
    txHash: "0x",
  });
  it("counts only bot (arb) trades since the reset; lpKeptMore = aven - control", () => {
    const list = [t("aven", "arb", 5, 1, 10, 10_000), t("control", "arb", 5, 4, 3, 3000), t("aven", "retail", 6, 0, 99, 500), t("control", "arb", 1, 50, 50, 3000)];
    const s = computeStats(list, 2);
    expect(s.aven).toEqual({ trades: 1, botProfitUsd: 1, lpFeeIncomeUsd: 10, volumeUsd: 1000 });
    expect(s.control).toEqual({ trades: 1, botProfitUsd: 4, lpFeeIncomeUsd: 3, volumeUsd: 1000 });
    expect(s.lpKeptMoreUsd).toBe(7);
    expect(s.botProfitDiffUsd).toBe(-3);
  });
});

describe("toUnits", () => {
  it("converts human amounts exactly", () => {
    expect(toUnits(1.5, 18)).toBe(15n * 10n ** 17n);
    expect(toUnits(2240.02, 6)).toBe(2_240_020_000n);
    expect(toUnits(5, 0)).toBe(5n);
  });
});
