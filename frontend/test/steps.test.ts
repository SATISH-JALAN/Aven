import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compute, defaultParams, type Config, type Inputs } from "@aven/core/fee";
import { sqrtPriceFromWad } from "@aven/core/price";
import { feeSteps, inputsFromRecord, termsFired } from "@/lib/steps";

const cfg: Config = { perpIndex: 0, szDecimals: 2, baseIsToken0: true, decimals0: 18, decimals1: 6 };
const p = defaultParams();
const WAD = 10n ** 18n;

describe("feeSteps", () => {
  // ARCHITECTURE §6.3 worked example: pool 1.50% above oracle, mark 0.20% below, mark moved 0.30% vs anchor.
  const oracleRaw = 1_000_000n; // 100.00 with szDecimals 2
  const sqrt = sqrtPriceFromWad(cfg, (101_505n * WAD) / 1000n);
  const base: Inputs = { oracleRaw, markRaw: 998_000n, anchorMarkRaw: 995_015n, sqrtPriceX96: sqrt, sqrtPriceTopX96: sqrt, zeroForOne: true, readOk: true };

  it("reproduces the worked example: seller 9,000 pips with each term shown", () => {
    const s = feeSteps(cfg, p, base);
    expect(s.gapBps).toBe(150n);
    expect(s.arb).toBe(true);
    expect(s.premiumBps).toBe(-20n);
    expect(s.withPressure).toBe(true);
    expect(s.moveBps).toBe(29n);
    expect(s.terms).toEqual({ base: 500n, gap: 7_500n, premium: 1_000n, stress: 0n });
    expect(s.raw).toBe(9_000n);
    expect(s.fee).toBe(9_000);
    expect(s.consistent).toBe(true);
  });

  it("reproduces the worked example: buyer pays the 500-pip base fee", () => {
    const s = feeSteps(cfg, p, { ...base, zeroForOne: false });
    expect(s.fee).toBe(500);
    expect(s.arb).toBe(false);
    expect(s.withPressure).toBe(false);
    expect(s.consistent).toBe(true);
  });

  it("shows the clamp and the fallbacks", () => {
    const far = sqrtPriceFromWad(cfg, 105n * WAD); // 500 bp gap → 25,500 raw → clamped at maxFee
    const c = feeSteps(cfg, p, { ...base, sqrtPriceX96: far, sqrtPriceTopX96: far });
    expect(c.clamp).toBe("max");
    expect(c.fee).toBe(p.maxFee);
    expect(c.consistent).toBe(true);

    const bad = feeSteps(cfg, p, { ...base, readOk: false });
    expect(bad.reason).toBe("READ_FAILED");
    expect(bad.fee).toBe(p.fallbackFee);
    expect(bad.consistent).toBe(true);

    const huge = sqrtPriceFromWad(cfg, 130n * WAD); // 30% gap > maxGapBps 2000
    const g = feeSteps(cfg, p, { ...base, sqrtPriceX96: huge, sqrtPriceTopX96: huge });
    expect(g.reason).toBe("GAP_TOO_LARGE");
    expect(g.fee).toBe(p.fallbackFee);
    expect(g.consistent).toBe(true);
  });

  it("agrees with compute() on 2,000 random inputs (both token orders)", () => {
    let seed = 0x41564e;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 2_000; i++) {
      const c: Config = { ...cfg, baseIsToken0: i % 2 === 0, szDecimals: rnd(7) };
      const o = BigInt(100_000 + rnd(9_000_000));
      const wad = BigInt(c.szDecimals + 12 >= 0 ? 1 : 1) * o * 10n ** BigInt(12 + c.szDecimals);
      const cur = sqrtPriceFromWad(c, (wad * BigInt(9_000 + rnd(2_000))) / 10_000n);
      const top = sqrtPriceFromWad(c, (wad * BigInt(9_000 + rnd(2_000))) / 10_000n);
      const inp: Inputs = {
        oracleRaw: o,
        markRaw: (o * BigInt(9_800 + rnd(400))) / 10_000n,
        anchorMarkRaw: rnd(4) === 0 ? 0n : (o * BigInt(9_700 + rnd(600))) / 10_000n,
        sqrtPriceX96: cur,
        sqrtPriceTopX96: top,
        zeroForOne: rnd(2) === 0,
        readOk: rnd(20) !== 0,
      };
      const s = feeSteps(c, p, inp);
      expect(s.consistent).toBe(true);
      expect(s.fee).toBe(compute(c, p, inp).fee);
    }
  });
});

describe("recorded run", () => {
  const rec = JSON.parse(readFileSync(join(process.cwd(), "public", "arena-fallback.json"), "utf8"));
  // Pinned to the HyperEVM mainnet recording (2026-11-07): a 196 bp gap clamps to the 10,000-pip ceiling.
  it("recomputes the highlighted on-chain Aven fee (10,000 pips, mainnet) from its logged inputs", () => {
    const v = rec.highlight.verify;
    const s = feeSteps(rec.config.config, rec.config.params, inputsFromRecord(v.inputs));
    expect(rec.chainId).toBe(999);
    expect(s.fee).toBe(v.onchainFee);
    expect(s.fee).toBe(10_000);
    expect(s.consistent).toBe(true);
    expect(termsFired(v.breakdown, rec.config.params.stressThresholdBps)).toEqual(["base", "gap", "premium"]);
  });
});

describe("termsFired", () => {
  it("never shows a zero gap as fired, and a fallback alone", () => {
    expect(termsFired({ reason: "OK", arb: true, withPressure: false, gapBps: 0, moveBps: 0 }, 50)).toEqual(["base"]);
    expect(termsFired({ reason: "READ_FAILED", arb: true, withPressure: true, gapBps: 9, moveBps: 99 }, 50)).toEqual(["fallback"]);
    expect(termsFired({ reason: "OK", arb: false, withPressure: true, gapBps: 3, moveBps: 51 }, 50)).toEqual(["base", "premium", "stress"]);
  });
});
