import { describe, expect, it } from "vitest";
import { compute } from "@aven/core/fee";
import { _testing } from "@/components/landing/SwapStory";

const { CFG, P, inputs, STATES } = _testing;
const fee = (i: number, zeroForOne: boolean) => {
  const s = STATES[i]!;
  return compute(CFG, P, inputs(s.pool, s.mark, s.anchor, zeroForOne));
};

// The landing page's swap story claims; these keep its copy honest against the real fee math.
describe("landing swap story", () => {
  it("calm market: both sides pay the 500-pip base fee", () => {
    expect(fee(0, true).fee).toBe(500);
    expect(fee(0, false).fee).toBe(500);
  });
  it("stale pool: the arbitrage side pays the gap, the other side doesn't", () => {
    const sell = fee(1, true);
    expect(sell.arb).toBe(true);
    expect(Number(sell.gapBps)).toBeGreaterThanOrEqual(163);
    expect(sell.fee).toBe(500 + Number(sell.gapBps) * P.gapWeight);
    expect(fee(1, false).fee).toBe(500);
  });
  it("perp stress: every swap pays more than base, from the stress term alone", () => {
    for (const z of [true, false]) {
      const b = fee(2, z);
      // At "fair" the pool's sqrt price floors a hair below the oracle, so the hook may flag the buy side as arb,
      // but with a 0 bp gap and no premium neither term adds anything: the fee is base + stress only.
      expect(Number(b.gapBps)).toBe(0);
      expect(Number(b.premiumBps)).toBe(0);
      expect(Number(b.moveBps)).toBeGreaterThan(P.stressThresholdBps);
      expect(b.fee).toBe(500 + (Number(b.moveBps) - P.stressThresholdBps) * P.stressWeight);
    }
  });
});
