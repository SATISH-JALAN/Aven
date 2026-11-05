import { describe, expect, it } from "vitest";
import {
  Q96,
  Reason,
  advanceAnchor,
  calculateSwapFee,
  compute,
  defaultParams,
  oracleWad,
  poolWad,
  validateParams,
  type Config,
  type Inputs,
  type Params,
} from "../src/fee.ts";
import { load, type PoolState } from "../src/state.ts";
import { sqrtBig, sqrtPriceFromWad } from "../src/price.ts";

// Mirrors contracts/test/unit/AvenFairValue.t.sol so a mismatch points at one function.
const cfg = (baseIsToken0: boolean): Config => ({ perpIndex: 0, szDecimals: 0, baseIsToken0, decimals0: 18, decimals1: 18 });
const inp = (o: bigint, m: bigint, a: bigint, sp: bigint, top: bigint, zeroForOne: boolean): Inputs => ({
  oracleRaw: o,
  markRaw: m,
  anchorMarkRaw: a,
  sqrtPriceX96: sp,
  sqrtPriceTopX96: top,
  zeroForOne,
  readOk: true,
});
const P = defaultParams();

describe("§6.2 params", () => {
  it("defaults are the spec table and valid", () => {
    expect(P).toEqual({
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
    });
    expect(() => validateParams(cfg(true), P)).not.toThrow();
  });
  it("each rule rejects", () => {
    const bad: Array<[Partial<Params>, Partial<Config>]> = [
      [{ minFee: 600 }, {}],
      [{ baseFee: 10_001 }, {}],
      [{ fallbackFee: 400 }, {}],
      [{ fallbackFee: 10_001 }, {}],
      [{ maxFee: 100_001 }, {}],
      [{ stressTauSec: 0 }, {}],
      [{ maxGapBps: 0 }, {}],
      [{ precompileGas: 9_999 }, {}],
      [{}, { szDecimals: 7 }],
      [{}, { decimals0: 19 }],
      [{}, { decimals1: 19 }],
    ];
    for (const [p, c] of bad) expect(() => validateParams({ ...cfg(true), ...c }, { ...P, ...p })).toThrow(/InvalidParams/);
  });
});

describe("§6.3 scaling", () => {
  it("oracleWad", () => {
    expect(oracleWad({ ...cfg(true), szDecimals: 0 }, 1_000_000n)).toBe(10n ** 18n);
    expect(oracleWad({ ...cfg(true), szDecimals: 2 }, 785_950n)).toBe(78_595n * 10n ** 15n);
    expect(oracleWad({ ...cfg(true), szDecimals: 4 }, 224_002n)).toBe(224_002n * 10n ** 16n);
    expect(oracleWad({ ...cfg(true), szDecimals: 5 }, 759_471n)).toBe(759_471n * 10n ** 17n);
  });
  it("poolWad at Q96 is 1.0 for both orders", () => {
    expect(poolWad(cfg(true), Q96)).toBe(10n ** 18n);
    expect(poolWad(cfg(false), Q96)).toBe(10n ** 18n);
  });
  it("sqrtPriceFromWad round-trips within 1 bp (18/6 and 6/18)", () => {
    for (const c of [
      { perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6 },
      { perpIndex: 4, szDecimals: 4, baseIsToken0: false, decimals0: 6, decimals1: 18 },
    ]) {
      const want = oracleWad(c, 224_002n);
      const got = poolWad(c, sqrtPriceFromWad(c, want));
      const diff = got > want ? got - want : want - got;
      expect(diff * 10_000n <= want).toBe(true);
    }
  });
  it("sqrtBig is exact floor (incl. sizes where a float seed lands below the root)", () => {
    const xs = [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 40n, 10n ** 40n + 1n, 2n ** 255n, 2n ** 256n - 1n];
    let seed = 0x9e3779b97f4a7c15n; // deterministic xorshift-ish sweep over 1..2^256
    for (let i = 0; i < 300; i++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 256n) - 1n);
      xs.push(seed >> BigInt(i % 200));
    }
    for (const x of xs) {
      const r = sqrtBig(x);
      expect(r * r <= x && (r + 1n) * (r + 1n) > x).toBe(true);
    }
  });
});

describe("§6.3 worked example and signals", () => {
  it("seller pays 9,000, buyer 500", () => {
    const s = compute(cfg(true), P, inp(985_221n, 983_250n, 980_309n, Q96, Q96, true));
    expect(s).toEqual({ fee: 9_000, reason: Reason.OK, gapBps: 150n, premiumBps: -20n, moveBps: 30n, arb: true, withPressure: true });
    const b = compute(cfg(true), P, inp(985_221n, 983_250n, 980_309n, Q96, Q96, false));
    expect(b.fee).toBe(500);
    expect(b.arb || b.withPressure).toBe(false);
  });
  it("each signal alone", () => {
    expect(compute(cfg(true), P, inp(985_221n, 985_221n, 0n, Q96, Q96, true)).fee).toBe(500 + 150 * 50);
    expect(compute(cfg(true), P, inp(1_000_000n, 1_002_000n, 0n, Q96, Q96, false)).fee).toBe(500 + 20 * 50);
    expect(compute(cfg(true), P, inp(1_000_000n, 1_000_000n, 992_063n, Q96, Q96, true)).fee).toBe(500 + 30 * 20);
  });
  it("stress threshold exact vs +1", () => {
    expect(compute(cfg(true), P, inp(1_000_000n, 1_005_000n, 1_000_000n, Q96, Q96, true)).fee).toBe(500);
    expect(compute(cfg(true), P, inp(1_000_000n, 1_005_100n, 1_000_000n, Q96, Q96, true)).fee).toBe(520);
  });
  it("direction matrix, both token orders", () => {
    for (const base0 of [true, false]) {
      const sellZ = base0;
      expect(compute(cfg(base0), P, inp(985_221n, 985_221n, 0n, Q96, Q96, sellZ)).arb).toBe(true);
      expect(compute(cfg(base0), P, inp(985_221n, 985_221n, 0n, Q96, Q96, !sellZ)).arb).toBe(false);
      const buy = compute(cfg(base0), P, inp(1_015_000n, 1_015_000n, 0n, Q96, Q96, !sellZ));
      expect(buy.arb).toBe(true);
      expect(buy.gapBps).toBe(147n);
      expect(compute(cfg(base0), P, inp(1_015_000n, 1_015_000n, 0n, Q96, Q96, sellZ)).arb).toBe(false);
    }
  });
  it("top-of-block: same side max, opposite side current, at fair no arb", () => {
    const topUp = (Q96 * 10_005n) / 10_000n;
    const same = compute(cfg(true), P, inp(985_221n, 985_221n, 0n, Q96, topUp, true));
    expect(same.gapBps > 150n).toBe(true);
    expect(compute(cfg(true), P, inp(985_221n, 985_221n, 0n, Q96, (Q96 * 970n) / 1000n, true)).gapBps).toBe(150n);
    const fair = compute(cfg(true), P, inp(1_000_000n, 1_000_000n, 0n, Q96, (Q96 * 1015n) / 1000n, true));
    expect(fair.arb).toBe(false);
    expect(fair.gapBps).toBe(0n);
  });
  it("clamps and fallbacks", () => {
    expect(compute(cfg(true), P, inp(910_000n, 910_000n, 0n, Q96, Q96, true)).fee).toBe(10_000);
    const rf = compute(cfg(true), P, { ...inp(985_221n, 983_250n, 980_309n, Q96, Q96, true), readOk: false });
    expect(rf).toEqual({ fee: 3_000, reason: Reason.READ_FAILED, gapBps: 0n, premiumBps: 0n, moveBps: 0n, arb: false, withPressure: false });
    const gt = compute(cfg(true), P, inp(800_000n, 800_000n, 0n, Q96, Q96, true));
    expect([gt.fee, gt.reason, gt.gapBps]).toEqual([3_000, Reason.GAP_TOO_LARGE, 2_500n]);
    expect(compute(cfg(true), { ...P, maxGapBps: 150 }, inp(985_221n, 985_221n, 0n, Q96, Q96, true)).reason).toBe(Reason.OK);
    expect(compute(cfg(true), { ...P, maxGapBps: 149 }, inp(985_221n, 985_221n, 0n, Q96, Q96, true)).reason).toBe(Reason.GAP_TOO_LARGE);
  });
});

describe("§6.4 anchor and state", () => {
  it("anchor rules", () => {
    expect(advanceAnchor(0n, 0n, 1_234n, 1_000n, 60n)).toEqual({ mark: 1_234n, time: 1_000n });
    expect(advanceAnchor(1_000n, 500n, 9_999n, 500n, 60n)).toEqual({ mark: 1_000n, time: 500n });
    expect(advanceAnchor(1_000n, 500n, 1_600n, 560n, 60n).mark).toBe(1_600n);
    expect(advanceAnchor(1_000n, 500n, 1_600n, 530n, 60n).mark).toBe(1_300n);
    expect(advanceAnchor(1_600n, 500n, 1_000n, 520n, 60n).mark).toBe(1_400n);
    expect(advanceAnchor(100n, 500n, 99n, 530n, 60n).mark).toBe(100n); // truncates toward zero
    expect(advanceAnchor(100n, 500n, 101n, 530n, 60n).mark).toBe(100n);
    expect(() => advanceAnchor(1n, 10n, 1n, 9n, 60n)).toThrow();
  });
  it("load: top-of-block only on first swap of block; anchor only on good reads", () => {
    const s0: PoolState = { topBlock: 0n, sqrtPriceTopX96: 0n, anchorMark: 0n, anchorTime: 0n, initialized: true };
    const env = { blockNumber: 10n, timestamp: 1000n, sqrtPriceX96: Q96 };
    const a = load(s0, env, { readOk: true, oracleRaw: 1n, markRaw: 500n }, 60n);
    expect(a.state).toMatchObject({ topBlock: 10n, sqrtPriceTopX96: Q96, anchorMark: 500n, anchorTime: 1000n });
    expect(a.inputs.anchorMarkRaw).toBe(0n); // anchor BEFORE the update
    const b = load(a.state, { ...env, sqrtPriceX96: Q96 * 2n }, { readOk: true, oracleRaw: 1n, markRaw: 600n }, 60n);
    expect(b.state.sqrtPriceTopX96).toBe(Q96); // same block: unchanged
    expect(b.state.anchorMark).toBe(500n); // dt = 0: unchanged
    const c = load(b.state, { blockNumber: 11n, timestamp: 1030n, sqrtPriceX96: Q96 * 3n }, { readOk: false, oracleRaw: 0n, markRaw: 0n }, 60n);
    expect(c.state.sqrtPriceTopX96).toBe(Q96 * 3n);
    expect(c.state.anchorMark).toBe(500n);
    expect(c.state.anchorTime).toBe(1000n);
  });
});

describe("v4 swap fee", () => {
  it("calculateSwapFee", () => {
    expect(calculateSwapFee(0, true, 9_000)).toBe(9_000);
    // protocol fee 1000 (0.1%) zeroForOne, 500 oneForZero: 1000 + 3000 - 1000*3000/1e6 = 3997
    const pf = 1000 | (500 << 12);
    expect(calculateSwapFee(pf, true, 3_000)).toBe(3_997);
    expect(calculateSwapFee(pf, false, 3_000)).toBe(500 + 3_000 - 1);
  });
});
