/**
 * Every intermediate value of the fee (ARCHITECTURE §6.3 Steps 2–8), computed with the same BigInt helpers as the
 * exact TypeScript port (@aven/core/fee). The final fee is cross-checked against `compute()` itself: if the walkthrough
 * ever disagreed with the port, `consistent` would be false and the UI says so instead of showing a wrong story.
 */
import {
  Reason,
  compute,
  mulDiv,
  oracleWad,
  poolWad,
  reasonName,
  type Breakdown,
  type Config,
  type Inputs,
  type Params,
} from "@aven/core/fee";

export interface FeeSteps {
  readOk: boolean;
  oracleWad: bigint;
  curWad: bigint;
  topWad: bigint;
  gapCur: bigint;
  gapTop: bigint;
  above: boolean;
  below: boolean;
  topSameSide: boolean;
  gapBps: bigint;
  gapTooLarge: boolean;
  sellingBase: boolean;
  arb: boolean;
  premiumBps: bigint;
  withPressure: boolean;
  moveBps: bigint;
  terms: { base: bigint; gap: bigint; premium: bigint; stress: bigint };
  raw: bigint;
  clamp: "min" | "max" | null;
  fee: number;
  reason: "OK" | "READ_FAILED" | "GAP_TOO_LARGE";
  breakdown: Breakdown;
  consistent: boolean;
}

const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
const abs = (x: bigint) => (x < 0n ? -x : x);

export function feeSteps(cfg: Config, p: Params, inp: Inputs): FeeSteps {
  const breakdown = compute(cfg, p, inp);
  const zero = 0n;
  const s: FeeSteps = {
    readOk: inp.readOk,
    oracleWad: zero,
    curWad: zero,
    topWad: zero,
    gapCur: zero,
    gapTop: zero,
    above: false,
    below: false,
    topSameSide: false,
    gapBps: zero,
    gapTooLarge: false,
    sellingBase: cfg.baseIsToken0 ? inp.zeroForOne : !inp.zeroForOne,
    arb: false,
    premiumBps: zero,
    withPressure: false,
    moveBps: zero,
    terms: { base: BigInt(p.baseFee), gap: zero, premium: zero, stress: zero },
    raw: zero,
    clamp: null,
    fee: 0,
    reason: "OK",
    breakdown,
    consistent: false,
  };

  if (!inp.readOk) {
    s.fee = p.fallbackFee;
    s.reason = "READ_FAILED";
  } else {
    s.oracleWad = oracleWad(cfg, inp.oracleRaw);
    s.curWad = poolWad(cfg, inp.sqrtPriceX96);
    s.topWad = poolWad(cfg, inp.sqrtPriceTopX96);
    s.gapCur = mulDiv(absDiff(s.curWad, s.oracleWad), 10_000n, s.oracleWad);
    s.gapTop = mulDiv(absDiff(s.topWad, s.oracleWad), 10_000n, s.oracleWad);
    s.above = s.curWad > s.oracleWad;
    s.below = s.curWad < s.oracleWad;
    s.topSameSide = (s.above && s.topWad > s.oracleWad) || (s.below && s.topWad < s.oracleWad);
    s.gapBps = s.topSameSide ? (s.gapCur > s.gapTop ? s.gapCur : s.gapTop) : s.gapCur;
    if (s.gapBps > BigInt(p.maxGapBps)) {
      s.gapTooLarge = true;
      s.fee = p.fallbackFee;
      s.reason = "GAP_TOO_LARGE";
    } else {
      s.arb = (s.above && s.sellingBase) || (s.below && !s.sellingBase);
      s.premiumBps = ((inp.markRaw - inp.oracleRaw) * 10_000n) / inp.oracleRaw;
      s.withPressure = (s.premiumBps > 0n && !s.sellingBase) || (s.premiumBps < 0n && s.sellingBase);
      if (inp.anchorMarkRaw !== 0n) s.moveBps = (absDiff(inp.markRaw, inp.anchorMarkRaw) * 10_000n) / inp.anchorMarkRaw;
      s.terms.gap = s.arb ? s.gapBps * BigInt(p.gapWeight) : 0n;
      s.terms.premium = s.withPressure ? abs(s.premiumBps) * BigInt(p.premiumWeight) : 0n;
      const thr = BigInt(p.stressThresholdBps);
      s.terms.stress = s.moveBps > thr ? (s.moveBps - thr) * BigInt(p.stressWeight) : 0n;
      s.raw = s.terms.base + s.terms.gap + s.terms.premium + s.terms.stress;
      let fee = s.raw;
      if (fee < BigInt(p.minFee)) {
        fee = BigInt(p.minFee);
        s.clamp = "min";
      }
      if (fee > BigInt(p.maxFee)) {
        fee = BigInt(p.maxFee);
        s.clamp = "max";
      }
      s.fee = Number(fee);
    }
  }
  s.consistent =
    s.fee === breakdown.fee &&
    reasonName(breakdown.reason) === s.reason &&
    (breakdown.reason !== Reason.OK || (breakdown.gapBps === s.gapBps && breakdown.premiumBps === s.premiumBps && breakdown.moveBps === s.moveBps));
  return s;
}

/** Inputs from a VerifyResult.inputs record (all strings) or a decoded FeeComputed event. */
export function inputsFromRecord(r: Record<string, string>): Inputs {
  const b = (k: string) => BigInt(r[k] ?? "0");
  return {
    oracleRaw: b("oracleRaw"),
    markRaw: b("markRaw"),
    anchorMarkRaw: b("anchorMarkRaw"),
    sqrtPriceX96: b("sqrtPriceX96"),
    sqrtPriceTopX96: b("sqrtPriceTopX96"),
    zeroForOne: r.zeroForOne === "true",
    readOk: r.readOk !== undefined ? r.readOk === "true" : r.reason !== "READ_FAILED",
  };
}

/** Which fee terms fired, for chips. */
export type Term = "base" | "gap" | "premium" | "stress" | "fallback";
export function termsFired(
  b: { reason: string; arb: boolean; withPressure: boolean; gapBps: number | bigint; moveBps: number | bigint },
  stressThresholdBps: number,
): Term[] {
  if (b.reason !== "OK") return ["fallback"];
  const out: Term[] = ["base"];
  if (b.arb && Number(b.gapBps) > 0) out.push("gap");
  if (b.withPressure) out.push("premium");
  if (Number(b.moveBps) > stressThresholdBps) out.push("stress");
  return out;
}
