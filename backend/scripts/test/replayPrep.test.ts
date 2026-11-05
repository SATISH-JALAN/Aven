import { describe, expect, it } from "vitest";
import { buildReplayInput, lagged, parseNormalizedCsv, toRaw } from "../src/replayPrep.ts";

describe("replay pre-step", () => {
  it("raw = price * 10^(6 - szDecimals), rounded", () => {
    expect(toRaw(94.0618, 2)).toBe(940_618);
    expect(toRaw(2240.02, 4)).toBe(224_002);
  });
  it("lag interpolates linearly between candles; step 0 and lag >= step use the previous/first value", () => {
    const ts = [0, 300, 600];
    expect(lagged([100, 400, 400], ts, 60)).toEqual([100, 340, 400]); // 100 + 300 * 240/300
    expect(lagged([100, 400, 700], ts, 300)).toEqual([100, 100, 400]);
    expect(lagged([100, 400, 700], ts, 0)).toEqual([100, 400, 700]);
  });
  it("parses normalized.csv and builds parallel arrays", () => {
    const csv = "timestamp,markClose,premium,oracleProxy,interval\n1000,94.126,0.0007,94.0618,5m\n301000,94.223,-0.0002,94.2437,5m\n";
    const input = buildReplayInput("x", parseNormalizedCsv(csv), 2, 60);
    expect(input).toMatchObject({ scenario: "x", interval: "5m", szDecimals: 2, lagSec: 60, ts: [1, 301], oracle: [940_618, 942_437], mark: [941_260, 942_230] });
    expect(input.oracleLag).toEqual([940_618, 942_073]);
    expect(() => parseNormalizedCsv("bad,header\n1,2")).toThrow();
  });
});
