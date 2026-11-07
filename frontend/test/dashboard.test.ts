import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@/config";
import type { HistoryPoint } from "@/lib/arena";
import { auditFees, blockIntervalMs, episodes, expectedFee, feeHistogram, feeParts, flows, volumeUsd } from "@/lib/dashboard";
import type { Breakdown, Trade } from "@/lib/types";

const p = DEFAULT_PARAMS; // §6.2: base 500, min 500, max 10,000, gap/premium weight 50, stress 20 above 50 bp
const bd = (o: Partial<Breakdown>): Breakdown => ({ fee: 0, reason: "OK", gapBps: 0, premiumBps: 0, moveBps: 0, arb: false, withPressure: false, ...o });

let n = 0;
const trade = (o: Partial<Trade>): Trade => ({
  id: `t${n++}`,
  ts: 0,
  block: 0,
  pool: "aven",
  kind: "arb",
  direction: "buyBase",
  amountIn: "1000000",
  amountOut: "1",
  feePips: 500,
  feeUsd: 0,
  botProfitUsd: 0,
  lpFeeIncomeUsd: 0,
  txHash: `0x${n.toString(16).padStart(64, "0")}`,
  ...o,
});

describe("expectedFee (§6.3 on a breakdown's own inputs)", () => {
  it("reproduces fees charged on chain", () => {
    expect(DEFAULT_PARAMS.baseFee).toBe(500);
    // HyperEVM mainnet arb 0xfce1…: gap 186, premium −3 with pressure → 500 + 9,300 + 150 = 9,950.
    expect(expectedFee(bd({ gapBps: 186, premiumBps: -3, arb: true, withPressure: true }), p)).toBe(9950);
    // Local run: gap 100, premium 10 → 6,000; gap 41 + stress 121 bp → 500 + 2,050 + 71·20 = 3,970.
    expect(expectedFee(bd({ gapBps: 100, premiumBps: 10, arb: true, withPressure: true }), p)).toBe(6000);
    expect(expectedFee(bd({ gapBps: 41, moveBps: 121, arb: true }), p)).toBe(3970);
    // gap 147 + premium 10 + stress 160 → 10,550 raw → the 1% cap.
    expect(expectedFee(bd({ gapBps: 147, premiumBps: 10, moveBps: 160, arb: true, withPressure: true }), p)).toBe(10_000);
  });
  it("charges only the base when no live term fires, and the fallback on a failed read", () => {
    expect(expectedFee(bd({ gapBps: 29, premiumBps: -19 }), p)).toBe(500);
    expect(expectedFee(bd({ reason: "READ_FAILED" }), p)).toBe(p.fallbackFee);
  });
});

describe("feeParts", () => {
  it("splits a live fee exactly and scales capped fees down to the cap", () => {
    const live = feeParts(bd({ gapBps: 100, premiumBps: 10, arb: true, withPressure: true }), p);
    expect(live).toMatchObject({ base: 500, gap: 5000, premium: 500, stress: 0, regime: "live" });
    const cap = feeParts(bd({ gapBps: 147, premiumBps: 10, moveBps: 160, arb: true, withPressure: true }), p);
    expect(cap.regime).toBe("capped");
    expect(cap.base + cap.gap + cap.premium + cap.stress).toBeCloseTo(10_000, 6);
    expect(feeParts(bd({}), p).regime).toBe("base");
  });
});

describe("auditFees", () => {
  it("counts formula matches, base-only trades and verify results", () => {
    const ts = [
      trade({ feePips: 6000, breakdown: bd({ gapBps: 100, premiumBps: 10, arb: true, withPressure: true }), verify: { checkA: true, checkB: true } }),
      trade({ feePips: 500, breakdown: bd({ gapBps: 3 }), verify: { checkA: true, checkB: true } }),
      trade({ feePips: 700, breakdown: bd({ gapBps: 3 }) }), // would be a surcharge with no live term: must be flagged
      trade({ pool: "control", feePips: 3000 }),
    ];
    const a = auditFees(ts, p);
    expect(a).toMatchObject({ avenTrades: 3, formulaMatch: 2, noTerm: 2, noTermAtBase: 1, verified: 2, verifiedOk: 2 });
    expect(a.regimes).toEqual({ base: 2, live: 1, capped: 0, fallback: 0 });
  });
});

describe("episodes", () => {
  const h = (block: number, oracleRaw: string, avenGap: number, buy: number, sell: number): HistoryPoint => ({
    ts: block * 1000,
    block,
    oracle: Number(oracleRaw) / 100,
    mark: Number(oracleRaw) / 100,
    control: 0,
    aven: 0,
    oracleRaw,
    avenGap,
    controlGap: avenGap,
    avenBuy: bd({ fee: buy }),
    avenSell: bd({ fee: sell }),
  });
  it("finds the oracle move, the same-block reprice, arb latency per pool and the return to base", () => {
    const history = [
      h(150, "224002", 0, 500, 500),
      h(151, "224002", 0, 500, 500),
      h(152, "227362", -147, 7850, 3700), // oracle +150 bp: pool below → arb buys base; retail (sell) has stress
      h(153, "227362", -100, 6000, 1200),
      h(154, "227362", -60, 4000, 500), // retail back to the base fee
    ];
    const trades = [
      trade({ pool: "control", block: 153, ts: 153_400, lpFeeIncomeUsd: 87.51, botProfitUsd: 173.86, feePips: 3000 }),
      trade({ pool: "aven", block: 154, ts: 154_600, lpFeeIncomeUsd: 119.4, botProfitUsd: 28.93, feePips: 10_000 }),
    ];
    const [e] = episodes(history, trades, [], p);
    expect(e).toBeDefined();
    expect(e!.kind).toBe("oracle");
    expect(e!.block).toBe(152);
    expect(Math.round(e!.moveBps)).toBe(150);
    expect(e!.avenFeeBefore).toBe(500);
    expect(e!.avenFeeAt).toBe(7850);
    expect(e!.repriceBlocks).toBe(0);
    expect(e!.control.firstBlocks).toBe(1);
    expect(e!.control.firstMs).toBe(1400);
    expect(e!.aven.firstBlocks).toBe(2);
    expect(e!.retailBase).toEqual({ blocks: 2, ms: 2000 });
    expect(e!.aven.gapLeft).toBe(-60);
  });
  it("counts a mark move a block before the oracle as one episode, repriced in its first block", () => {
    const pt = (block: number, oracleRaw: string, mark: number, buy: number, sell: number): HistoryPoint => ({ ...h(block, oracleRaw, 30, buy, sell), mark });
    const history = [
      pt(2374, "227270", 2268.2, 3000, 500),
      pt(2375, "227270", 2268.2, 3000, 500),
      pt(2376, "227270", 2262.1, 3000, 10_000), // mark −27 bp first: the sell quote jumps (stress), same block
      pt(2377, "226550", 2262.1, 500, 10_000), // oracle −32 bp the next block
    ];
    const eps = episodes(history, [], [], p);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ block: 2376, repriceBlocks: 0, repriceMs: 0 });
    expect(eps[0]!.label).toMatch(/^Oracle -3\d bp$/);
    expect(eps[0]!.quotesBefore).toEqual({ buy: 3000, sell: 500 });
    expect(eps[0]!.quotesAt).toEqual({ buy: 3000, sell: 10_000 });
  });
  it("ignores an arb mined in the shock's block before the shock", () => {
    const history = [h(2360, "1", -20, 2000, 500), h(2361, "1", -130, 7500, 500), h(2364, "1", -75, 4750, 500)];
    const early = trade({ block: 2361, ts: 1000, kind: "arb" }); // routine nibble, before the shock
    const shockSwap = trade({ block: 2361, ts: 1500, kind: "retail", txHash: "0xdef" });
    const answer = trade({ block: 2364, ts: 4200, kind: "arb", feePips: 7500 });
    const [e] = episodes(history, [early, shockSwap, answer], [{ id: "s", ts: 1500, sizeBase: "12", direction: "sellBase", txHashes: ["0xdef"] }], p);
    expect(e!.aven.first?.id).toBe(answer.id);
    expect(e!.aven.firstBlocks).toBe(3);
    expect(e!.aven.firstMs).toBe(2700);
  });
  it("turns a shock into an episode at the block of its swaps", () => {
    const history = [h(10, "1", 0, 500, 500), h(11, "1", 80, 500, 4500)];
    const sh = trade({ kind: "retail", block: 11, txHash: "0xabc" });
    const [e] = episodes(history, [sh], [{ id: "s", ts: 11_000, sizeBase: "10", direction: "sellBase", txHashes: ["0xABC"] }], p);
    expect(e).toMatchObject({ kind: "shock", block: 11 });
  });
});

describe("throughput helpers", () => {
  it("values volume from the fee, counts flows by direction and bins fees", () => {
    expect(volumeUsd(trade({ feePips: 3000, feeUsd: 87.51 }))).toBeCloseTo(29_170, 0);
    const f = flows([trade({ direction: "buyBase", amountIn: "100", amountOut: "-2" }), trade({ direction: "sellBase", amountIn: "5", amountOut: "7", kind: "retail" })]);
    expect(f.aven).toMatchObject({ trades: 2, arbs: 1, retail: 1, quoteIn: 100n, baseOut: 2n, baseIn: 5n, quoteOut: 7n });
    const hist = feeHistogram([trade({ feePips: 500 }), trade({ feePips: 10_000 }), trade({ pool: "control", feePips: 3000 })]);
    expect(hist.aven[0]).toBe(1);
    expect(hist.aven[6]).toBe(1);
    expect(hist.control[3]).toBe(1);
  });
  it("measures the median block interval on the Arena clock", () => {
    const pts = [0, 1, 2, 4].map((b, i) => ({ ts: [0, 1000, 2100, 4000][i]!, block: b, oracle: 1, mark: 1, control: 1, aven: 1 }));
    expect(blockIntervalMs(pts)).toBe(1000);
  });
});
