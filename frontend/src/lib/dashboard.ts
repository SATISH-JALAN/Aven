/**
 * Dashboard derivations. Pure functions over what the Arena actually streamed (/state per block, trades, shocks):
 * nothing here invents a number. Blocks are the exact, on-chain unit; milliseconds are Arena server time
 * (state.ts = when the Arena read that block, trade.ts = when it saw the receipt), so both ends share one clock.
 *
 * Fee math (expectedFee, feeParts) restates ARCHITECTURE §6.3 on a trade's own Breakdown, in integers. It is a check,
 * not the source of truth: the exact BigInt port (@aven/core/fee) and the on-chain verify (checks A and B) are.
 */
import type { HistoryPoint } from "@/lib/arena";
import type { Breakdown, Direction, PoolName, Shock, Trade } from "@/lib/types";
import type { FeeParams } from "@/config";

export const PLAIN_FEE = 3000;

// ------------------------------------------------------------------------------------------------ fee checks

/** The fee §6.3 gives for a breakdown's own inputs (gap, premium, move, arb, pressure, reason). */
export function expectedFee(b: Breakdown, p: FeeParams): number {
  if (b.reason !== "OK") return p.fallbackFee;
  const raw =
    p.baseFee +
    (b.arb ? Math.abs(b.gapBps) * p.gapWeight : 0) +
    (b.withPressure ? Math.abs(b.premiumBps) * p.premiumWeight : 0) +
    (b.moveBps > p.stressThresholdBps ? (b.moveBps - p.stressThresholdBps) * p.stressWeight : 0);
  return Math.min(p.maxFee, Math.max(p.minFee, raw));
}

export type Regime = "base" | "live" | "capped" | "fallback";

export interface FeeParts {
  base: number;
  gap: number;
  premium: number;
  stress: number;
  /** Raw sum before the clamp. */
  raw: number;
  regime: Regime;
}

/** Split a charged fee into its terms. Capped fees keep the base and scale the live terms down to what was charged. */
export function feeParts(b: Breakdown, p: FeeParams): FeeParts {
  if (b.reason !== "OK") return { base: 0, gap: 0, premium: 0, stress: 0, raw: p.fallbackFee, regime: "fallback" };
  const gap = b.arb ? Math.abs(b.gapBps) * p.gapWeight : 0;
  const premium = b.withPressure ? Math.abs(b.premiumBps) * p.premiumWeight : 0;
  const stress = b.moveBps > p.stressThresholdBps ? (b.moveBps - p.stressThresholdBps) * p.stressWeight : 0;
  const raw = p.baseFee + gap + premium + stress;
  const live = gap + premium + stress;
  if (live === 0) return { base: p.baseFee, gap: 0, premium: 0, stress: 0, raw, regime: "base" };
  if (raw > p.maxFee) {
    const k = (p.maxFee - p.baseFee) / live;
    return { base: p.baseFee, gap: gap * k, premium: premium * k, stress: stress * k, raw, regime: "capped" };
  }
  return { base: p.baseFee, gap, premium, stress, raw, regime: "live" };
}

export interface FeeAudit {
  avenTrades: number;
  /** Trades whose charged fee equals §6.3 on their own inputs. */
  formulaMatch: number;
  /** Trades with no live term (no gap in the arb direction, no premium pressure, no stress): fee must be the base. */
  noTerm: number;
  noTermAtBase: number;
  /** On-chain verify (A: fee = formula(FeeComputed inputs); B: PoolManager charged it). */
  verified: number;
  verifiedOk: number;
  regimes: Record<Regime, number>;
  /** Sum of charged pips by term (for the composition chart). */
  pips: { base: number; gap: number; premium: number; stress: number };
}

export function auditFees(trades: Trade[], p: FeeParams): FeeAudit {
  const a: FeeAudit = {
    avenTrades: 0,
    formulaMatch: 0,
    noTerm: 0,
    noTermAtBase: 0,
    verified: 0,
    verifiedOk: 0,
    regimes: { base: 0, live: 0, capped: 0, fallback: 0 },
    pips: { base: 0, gap: 0, premium: 0, stress: 0 },
  };
  for (const t of trades) {
    if (t.pool !== "aven" || !t.breakdown) continue;
    a.avenTrades++;
    if (expectedFee(t.breakdown, p) === t.feePips) a.formulaMatch++;
    const parts = feeParts(t.breakdown, p);
    a.regimes[parts.regime]++;
    if (parts.regime === "base") {
      a.noTerm++;
      if (t.feePips === p.baseFee) a.noTermAtBase++;
    }
    a.pips.base += parts.base;
    a.pips.gap += parts.gap;
    a.pips.premium += parts.premium;
    a.pips.stress += parts.stress;
    if (t.verify) {
      a.verified++;
      if (t.verify.checkA && t.verify.checkB) a.verifiedOk++;
    }
  }
  return a;
}

// ------------------------------------------------------------------------------------------------ episodes

/** Arbitrage direction for a pool off the oracle: below the oracle (gap < 0) the arb buys base, above it sells. */
export const arbDir = (gapBps: number): Direction => (gapBps < 0 ? "buyBase" : "sellBase");
export const otherDir = (d: Direction): Direction => (d === "buyBase" ? "sellBase" : "buyBase");
export const quoteOf = (h: HistoryPoint, d: Direction): Breakdown | null | undefined => (d === "buyBase" ? h.avenBuy : h.avenSell);

export interface PoolLeg {
  trades: Trade[];
  arbs: Trade[];
  first: Trade | null;
  last: Trade | null;
  /** Blocks from the episode start to the first arb, and Arena ms. */
  firstBlocks: number | null;
  firstMs: number | null;
  lastBlocks: number | null;
  lastMs: number | null;
  /** Gap left when the arbs stopped (bp, from the stream at the last arb's block). */
  gapLeft: number | null;
  lpFeesUsd: number;
  botProfitUsd: number;
}

export interface Episode {
  kind: "oracle" | "shock";
  block: number;
  ts: number;
  endBlock: number | null;
  /** Oracle and mark moves across the episode's start, bp (price episodes). */
  moveBps: number;
  markBps: number;
  label: string;
  before: HistoryPoint | null;
  at: HistoryPoint | null;
  /** Gap when the move is first seen (bp, signed). */
  avenGapAt: number | null;
  controlGapAt: number | null;
  /** Aven quote in the arb direction just before and at the first block the move is visible. */
  avenFeeBefore: number | null;
  avenFeeAt: number | null;
  /** Aven quotes (buy / sell, pips) in the block before and the first block of the episode. */
  quotesBefore: { buy: number | null; sell: number | null } | null;
  quotesAt: { buy: number | null; sell: number | null } | null;
  /** Blocks (and Arena ms) from the change being visible to an Aven quote changing (0 = same block). null = unknown. */
  repriceBlocks: number | null;
  repriceMs: number | null;
  /** First point where the retail (non-arb) direction pays the base fee again, i.e. no surcharge left. */
  retailBase: { blocks: number; ms: number } | null;
  aven: PoolLeg;
  control: PoolLeg;
}

function leg(trades: Trade[], ep: { block: number; ts: number }, history: HistoryPoint[], pool: PoolName): PoolLeg {
  const mine = trades.filter((t) => t.pool === pool).sort((a, b) => a.block - b.block || a.ts - b.ts);
  // Only arbs that answer this episode: a later block, or the start block but seen after the start (a routine arb
  // mined earlier in the same block, before the shock or move, doesn't count).
  const arbs = mine.filter((t) => t.kind === "arb" && (t.block > ep.block || t.ts >= ep.ts));
  const first = arbs[0] ?? null;
  const last = arbs[arbs.length - 1] ?? null;
  const at = last ? history.find((h) => h.block >= last.block) : undefined;
  return {
    trades: mine,
    arbs,
    first,
    last,
    firstBlocks: first ? first.block - ep.block : null,
    firstMs: first ? Math.max(0, first.ts - ep.ts) : null,
    lastBlocks: last ? last.block - ep.block : null,
    lastMs: last ? Math.max(0, last.ts - ep.ts) : null,
    gapLeft: at ? ((pool === "aven" ? at.avenGap : at.controlGap) ?? null) : null,
    lpFeesUsd: arbs.reduce((s, t) => s + t.lpFeeIncomeUsd, 0),
    botProfitUsd: arbs.reduce((s, t) => s + t.botProfitUsd, 0),
  };
}

const quotesKey = (h: HistoryPoint | null | undefined) => (h ? `${h.avenBuy?.fee ?? "?"}/${h.avenSell?.fee ?? "?"}` : null);
const bpMove = (a: number, b: number) => (a ? ((b - a) / a) * 10_000 : 0);
const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(0)} bp`;

/**
 * Episodes: every block where a HyperCore input of the hook changed (oracle 0x807 or mark 0x806, seen in the stream),
 * plus every shock (both pools pushed off the oracle by the same swap). Input changes within 2 blocks of each other
 * are one episode (HyperCore updates oracle and mark separately). Each episode runs until the next one starts.
 */
export function episodes(history: HistoryPoint[], trades: Trade[], shocks: Shock[], p: FeeParams): Episode[] {
  type Start = { kind: Episode["kind"]; block: number; ts: number; moveBps: number; markBps: number; label: string };
  const price: Start[] = [];
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1]!;
    const b = history[i]!;
    const oracleMoved = a.oracleRaw !== undefined && b.oracleRaw !== undefined ? a.oracleRaw !== b.oracleRaw : a.oracle !== b.oracle;
    const markMoved = a.mark !== b.mark;
    if (!(oracleMoved || markMoved) || !a.oracle) continue;
    const prev = price[price.length - 1];
    if (prev && b.block - prev.block <= 2 && prev.kind === "oracle") {
      // Same HyperCore update spread over a couple of blocks: extend the open episode.
      prev.moveBps += oracleMoved ? bpMove(a.oracle, b.oracle) : 0;
      prev.markBps += markMoved ? bpMove(a.mark, b.mark) : 0;
      continue;
    }
    price.push({ kind: "oracle", block: b.block, ts: b.ts, moveBps: oracleMoved ? bpMove(a.oracle, b.oracle) : 0, markBps: markMoved ? bpMove(a.mark, b.mark) : 0, label: "" });
  }
  for (const s of price) s.label = Math.abs(s.moveBps) >= 0.5 ? `Oracle ${signed(s.moveBps)}` : `Mark ${signed(s.markBps)}`;
  const starts: Start[] = [...price];
  for (const s of shocks) {
    const hashes = new Set(s.txHashes.map((h) => h.toLowerCase()));
    const ts = trades.filter((t) => hashes.has(t.txHash.toLowerCase()));
    if (!ts.length) continue;
    const block = Math.min(...ts.map((t) => t.block));
    starts.push({ kind: "shock", block, ts: s.ts, moveBps: 0, markBps: 0, label: `Shock · ${s.direction === "sellBase" ? "sell" : "buy"} ${Number(s.sizeBase).toFixed(2)}` });
  }
  starts.sort((a, b) => a.block - b.block || a.ts - b.ts);
  const merged = starts.filter((s, i) => i === 0 || s.block !== starts[i - 1]!.block);

  return merged.map((s, i) => {
    const endBlock = merged[i + 1]?.block ?? null;
    const inEp = (b: number) => b >= s.block && (endBlock === null || b < endBlock);
    const epTrades = trades.filter((t) => inEp(t.block));
    const pts = history.filter((h) => inEp(h.block));
    const before = [...history].reverse().find((h) => h.block < s.block) ?? null;
    const at = pts[0] ?? null;
    const dir = at?.avenGap !== undefined ? arbDir(at.avenGap) : null;
    const feeBefore = before && dir ? (quoteOf(before, dir)?.fee ?? null) : null;
    const feeAt = at && dir ? (quoteOf(at, dir)?.fee ?? null) : null;
    // Repriced = either direction's quote differs from the block before. 0 = in the first block the change was seen.
    let repriceBlocks: number | null = null;
    let repriceMs: number | null = null;
    const k0 = quotesKey(before);
    if (k0 !== null) {
      const hit = pts.find((h) => quotesKey(h) !== k0);
      if (hit) {
        repriceBlocks = hit.block - s.block;
        repriceMs = Math.max(0, hit.ts - s.ts);
      }
    }
    // Retail = the direction that does not close the gap. Back to base once it pays exactly the base fee.
    let retailBase: Episode["retailBase"] = null;
    for (const h of pts) {
      if (h.avenGap === undefined) continue;
      const q = quoteOf(h, otherDir(arbDir(h.avenGap)));
      if (q && q.reason === "OK" && q.fee === p.baseFee) {
        retailBase = { blocks: h.block - s.block, ms: Math.max(0, h.ts - s.ts) };
        break;
      }
    }
    return {
      kind: s.kind,
      block: s.block,
      ts: s.ts,
      moveBps: s.moveBps,
      markBps: s.markBps,
      label: s.label,
      endBlock,
      before,
      at,
      avenGapAt: at?.avenGap ?? null,
      controlGapAt: at?.controlGap ?? null,
      avenFeeBefore: feeBefore,
      avenFeeAt: feeAt,
      quotesBefore: before ? { buy: before.avenBuy?.fee ?? null, sell: before.avenSell?.fee ?? null } : null,
      quotesAt: at ? { buy: at.avenBuy?.fee ?? null, sell: at.avenSell?.fee ?? null } : null,
      repriceBlocks,
      repriceMs,
      retailBase,
      aven: leg(epTrades, s, history, "aven"),
      control: leg(epTrades, s, history, "control"),
    };
  });
}

// ------------------------------------------------------------------------------------------------ time series

/** Median ms per block between consecutive stream points (Arena clock). */
export function blockIntervalMs(history: HistoryPoint[]): number | null {
  const d: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const db = history[i]!.block - history[i - 1]!.block;
    if (db > 0) d.push((history[i]!.ts - history[i - 1]!.ts) / db);
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}

/** USD value of a trade's input, from its own fee: the Arena values feeUsd = input × fee at the oracle. */
export const volumeUsd = (t: Trade): number => (t.feePips > 0 ? (t.feeUsd * 1e6) / t.feePips : 0);

/** Cumulative LP fee income and bot profit per pool over arb trades (the Arena stats count arb trades only). */
export function cumulative(trades: Trade[]): { xs: number[]; lp: Record<PoolName, number[]>; bot: Record<PoolName, number[]> } {
  const arbs = trades.filter((t) => t.kind === "arb").sort((a, b) => a.ts - b.ts);
  const xs: number[] = [];
  const lp = { aven: [] as number[], control: [] as number[] };
  const bot = { aven: [] as number[], control: [] as number[] };
  const acc = { lp: { aven: 0, control: 0 }, bot: { aven: 0, control: 0 } };
  for (const t of arbs) {
    acc.lp[t.pool] += t.lpFeeIncomeUsd;
    acc.bot[t.pool] += t.botProfitUsd;
    xs.push(t.ts);
    for (const p of ["aven", "control"] as const) {
      lp[p].push(acc.lp[p]);
      bot[p].push(acc.bot[p]);
    }
  }
  return { xs, lp, bot };
}

export const FEE_BINS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "0.05%", lo: 0, hi: 501 },
  { label: "0.05–0.2%", lo: 501, hi: 2000 },
  { label: "0.2–0.3%", lo: 2000, hi: 3000 },
  { label: "0.3%", lo: 3000, hi: 3001 },
  { label: "0.3–0.6%", lo: 3001, hi: 6000 },
  { label: "0.6–1%", lo: 6000, hi: 10_000 },
  { label: "1% cap", lo: 10_000, hi: Infinity },
];

export function feeHistogram(trades: Trade[]): Record<PoolName, number[]> {
  const out = { aven: FEE_BINS.map(() => 0), control: FEE_BINS.map(() => 0) };
  for (const t of trades) {
    const i = FEE_BINS.findIndex((b) => t.feePips >= b.lo && t.feePips < b.hi);
    if (i >= 0) out[t.pool][i]!++;
  }
  return out;
}

/** Volume (USD at the oracle) per time bucket, per pool, newest bucket last. */
export function volumeBuckets(trades: Trade[], now: number, bucketMs: number, n: number): { starts: number[]; aven: number[]; control: number[]; count: { aven: number[]; control: number[] } } {
  const end = Math.ceil(now / bucketMs) * bucketMs;
  const starts = Array.from({ length: n }, (_, i) => end - (n - i) * bucketMs);
  const aven = starts.map(() => 0);
  const control = starts.map(() => 0);
  const count = { aven: starts.map(() => 0), control: starts.map(() => 0) };
  for (const t of trades) {
    const i = Math.floor((t.ts - starts[0]!) / bucketMs);
    if (i < 0 || i >= n) continue;
    (t.pool === "aven" ? aven : control)[i]! += volumeUsd(t);
    count[t.pool][i]!++;
  }
  return { starts, aven, control, count };
}

export interface Flow {
  trades: number;
  arbs: number;
  retail: number;
  /** Base units into / out of the pool (raw), quote units into / out of the pool (raw). */
  baseIn: bigint;
  baseOut: bigint;
  quoteIn: bigint;
  quoteOut: bigint;
  volumeUsd: number;
  feesUsd: number;
}

/** What went into and out of each pool. buyBase: quote in, base out; sellBase: base in, quote out. */
export function flows(trades: Trade[]): Record<PoolName, Flow> {
  const z = (): Flow => ({ trades: 0, arbs: 0, retail: 0, baseIn: 0n, baseOut: 0n, quoteIn: 0n, quoteOut: 0n, volumeUsd: 0, feesUsd: 0 });
  const out = { aven: z(), control: z() };
  for (const t of trades) {
    const f = out[t.pool];
    f.trades++;
    if (t.kind === "arb") f.arbs++;
    else f.retail++;
    const inp = BigInt(t.amountIn.replace("-", ""));
    const outp = BigInt(t.amountOut.replace("-", ""));
    if (t.direction === "buyBase") {
      f.quoteIn += inp;
      f.baseOut += outp;
    } else {
      f.baseIn += inp;
      f.quoteOut += outp;
    }
    f.volumeUsd += volumeUsd(t);
    f.feesUsd += t.feeUsd;
  }
  return out;
}

/** Keep the points/trades inside the selected window (ms), or everything. */
export function inWindow<T extends { ts: number }>(xs: T[], windowMs: number | null, now: number): T[] {
  return windowMs === null ? xs : xs.filter((x) => x.ts >= now - windowMs);
}
