import { describe, expect, it } from "vitest";
import { poolActivity, pushState, PUSH_BPS } from "@/lib/pressure";
import type { Trade } from "@/lib/types";

describe("pushState", () => {
  it("is at the oracle below the threshold and pushed at or above it, with the direction", () => {
    expect(pushState(4)).toEqual({ pushed: false, dir: null, label: "At the oracle (+4 bp)" });
    expect(pushState(-12).label).toBe("At the oracle (−12 bp)");
    expect(pushState(PUSH_BPS)).toMatchObject({ pushed: true, dir: "above" });
    expect(pushState(188)).toEqual({ pushed: true, dir: "above", label: "Pushed +188 bp above the oracle" });
    expect(pushState(-97)).toEqual({ pushed: true, dir: "below", label: "Pushed −97 bp below the oracle" });
  });
  it("uses the threshold it is given", () => {
    expect(pushState(45, 50).pushed).toBe(false);
    expect(pushState(0).label).toBe("At the oracle (0 bp)");
  });
});

const trade = (over: Partial<Trade>): Trade =>
  ({ id: "x", ts: 0, block: 0, pool: "aven", kind: "retail", direction: "buyBase", amountIn: "0", amountOut: "0", feePips: 500, feeUsd: 0, botProfitUsd: 0, lpFeeIncomeUsd: 0, txHash: "0x", ...over }) as Trade;

describe("poolActivity", () => {
  const trades = [
    trade({ id: "shock-aven", ts: 100, pool: "aven", kind: "retail" }),
    trade({ id: "shock-ctl", ts: 101, pool: "control", kind: "retail" }),
    trade({ id: "arb-aven", ts: 200, pool: "aven", kind: "arb", feePips: 9950 }),
    trade({ id: "old-arb-aven", ts: 50, pool: "aven", kind: "arb" }),
    trade({ id: "arb-ctl", ts: 210, pool: "control", kind: "arb", feePips: 3000 }),
  ];
  it("picks the newest non-bot trade as the last push and the newest bot trade as the last arb, per pool", () => {
    expect(poolActivity("aven", trades)).toMatchObject({ lastPush: { id: "shock-aven" }, lastArb: { id: "arb-aven", feePips: 9950 } });
    expect(poolActivity("control", trades)).toMatchObject({ lastPush: { id: "shock-ctl" }, lastArb: { id: "arb-ctl" } });
  });
  it("returns nulls when a pool has no trades", () => {
    expect(poolActivity("aven", [])).toEqual({ lastPush: null, lastArb: null });
  });
});
