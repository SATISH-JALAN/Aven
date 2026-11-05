import { describe, expect, it } from "vitest";
import { fetchCandles, fetchScenario, missingIntervals, normalize, toCsv, type Candle, type Funding, type Post } from "../src/marketData.ts";

const c = (t: number, close: string, stepMs = 300_000): Candle => ({ t, T: t + stepMs - 1, o: close, h: close, l: close, c: close, v: "1", n: 1 });
const f = (time: number, premium: string): Funding => ({ coin: "HYPE", fundingRate: "0.0000125", premium, time });
const H = 3_600_000;

describe("normalize (DATA.md B5)", () => {
  it("forward-fills the latest premium at or before each candle; oracleProxy = mark / (1 + premium)", () => {
    const rows = normalize([c(0, "100"), c(300_000, "101"), c(H, "102")], [f(-H, "0.01"), f(H, "-0.02"), f(2 * H, "0.5")], "5m");
    expect(rows.map((r) => r.premium)).toEqual([0.01, 0.01, -0.02]);
    expect(rows[0]!.oracleProxy).toBeCloseTo(100 / 1.01, 12);
    expect(rows[2]!.oracleProxy).toBeCloseTo(102 / 0.98, 12);
    expect(rows.every((r) => r.interval === "5m")).toBe(true);
  });
  it("refuses a candle with no prior funding sample, and bad prices", () => {
    expect(() => normalize([c(0, "100")], [f(10, "0")], "5m")).toThrow(/no funding/);
    expect(() => normalize([c(0, "0")], [f(0, "0")], "5m")).toThrow(/bad data/);
  });
  it("CSV header and rows", () => {
    expect(toCsv(normalize([c(0, "100")], [f(0, "0")], "5m"))).toBe("timestamp,markClose,premium,oracleProxy,interval\n0,100,0,100,5m\n");
  });
});

describe("gaps", () => {
  it("lists every missing open time in [start, end)", () => {
    expect(missingIntervals([c(0, "1"), c(600_000, "1")], "5m", 0, 900_000)).toEqual([300_000]);
    expect(missingIntervals([], "5m", 0, 600_000)).toEqual([0, 300_000]);
  });
});

describe("paging and fallback", () => {
  it("pages by last close + 1 ms and keeps only [start, end)", async () => {
    const bodies: Array<{ req: { startTime: number } }> = [];
    const all = Array.from({ length: 9_000 }, (_, i) => c(i * 60_000, "1", 60_000)); // 1m candles: T = t + 59,999
    const post: Post = async (body) => {
      bodies.push(body as never);
      const from = (body as { req: { startTime: number } }).req.startTime;
      return all.filter((x) => x.t >= from).slice(0, 5_000);
    };
    const { candles } = await fetchCandles(post, "HYPE", "1m", 60_000, 8_999 * 60_000);
    expect(candles.length).toBe(8_998);
    expect(bodies.length).toBe(2);
    // page 1 = indices 1..5000 (starts at 60,000); page 2 starts at its last close + 1 ms = index 5001's open
    expect(bodies[1]!.req.startTime).toBe(all[5_000]!.T + 1);
    expect(bodies[1]!.req.startTime).toBe(all[5_001]!.t);
  });
  it("falls back to 5m when 1m returns nothing, and records why", async () => {
    const post: Post = async (body) => {
      const b = body as { type: string; req?: { interval: string } };
      if (b.type === "fundingHistory") return [f(-H, "0.001")];
      if (b.req!.interval === "1m") return [];
      return [c(0, "10"), c(300_000, "11")];
    };
    const r = await fetchScenario(post, { id: "x", label: "x", coin: "HYPE", start: new Date(0).toISOString(), end: new Date(600_000).toISOString() });
    expect(r.interval).toBe("5m");
    expect(r.fallbackReason).toMatch(/not served/);
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });
});
