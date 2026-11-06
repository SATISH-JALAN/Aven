import { describe, expect, it } from "vitest";
import type { Deployments } from "@/config";
import { indicativeOut, planLiquidity } from "@/lib/trade-math";

const dep = (baseIsToken0: boolean): Deployments =>
  ({
    config: { perpIndex: 4, szDecimals: 4, baseIsToken0, decimals0: baseIsToken0 ? 18 : 6, decimals1: baseIsToken0 ? 6 : 18 },
    pools: { aven: { id: "0x", key: { tickSpacing: 60 } }, control: { id: "0x", key: { tickSpacing: 60 } } },
  }) as unknown as Deployments;

describe("indicativeOut", () => {
  it("sells base at the pool price minus the fee", () => {
    expect(indicativeOut(2, "sellBase", 2000, 3000)).toBeCloseTo(2 * 0.997 * 2000, 9);
  });
  it("buys base with quote", () => {
    expect(indicativeOut(1000, "buyBase", 2000, 500)).toBeCloseTo((1000 * 0.9995) / 2000, 12);
  });
  it("is zero for empty input or no price", () => {
    expect(indicativeOut(0, "sellBase", 2000, 500)).toBe(0);
    expect(indicativeOut(1, "sellBase", 0, 500)).toBe(0);
  });
});

describe("planLiquidity", () => {
  for (const b0 of [true, false]) {
    describe(`base is token${b0 ? 0 : 1}`, () => {
      const d = dep(b0);
      it("brackets the pool price with spacing-aligned ticks", () => {
        const p = planLiquidity(d, "aven", 2240, 10, 1)!;
        expect(Math.abs(p.tickLower % 60)).toBe(0);
        expect(Math.abs(p.tickUpper % 60)).toBe(0);
        expect(p.tickLower).toBeLessThan(p.tickUpper);
        expect(p.priceLower).toBeLessThan(2240);
        expect(p.priceUpper).toBeGreaterThan(2240);
        expect(p.priceLower).toBeGreaterThan(2240 * 0.88);
        expect(p.priceUpper).toBeLessThan(2240 * 1.12);
      });
      it("asks for about equal value on both sides in a symmetric range", () => {
        const p = planLiquidity(d, "aven", 2240, 5, 1)!;
        // A centred concentrated position holds roughly half its value in each token.
        expect(p.quoteAmount / (p.baseAmount * 2240)).toBeGreaterThan(0.85);
        expect(p.quoteAmount / (p.baseAmount * 2240)).toBeLessThan(1.15);
      });
      it("scales linearly with the deposit", () => {
        const a = planLiquidity(d, "aven", 2240, 25, 1)!;
        const b = planLiquidity(d, "aven", 2240, 25, 3)!;
        expect(b.liquidity / a.liquidity).toBeCloseTo(3, 9);
        expect(b.quoteAmount / a.quoteAmount).toBeCloseTo(3, 9);
      });
    });
  }
  it("refuses empty input", () => {
    expect(planLiquidity(dep(true), "aven", 2240, 10, 0)).toBeNull();
    expect(planLiquidity(dep(true), "aven", 0, 10, 1)).toBeNull();
  });
});
