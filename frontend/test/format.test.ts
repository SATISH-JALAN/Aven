import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pipsPct, premiumBpsOf, shortHex, units, usd } from "@/lib/format";
import { POOLS, resultsCsv, type ReplayFile } from "@/lib/replay";

describe("format", () => {
  it("pips as percent", () => {
    expect(pipsPct(8_700)).toBe("0.87%");
    expect(pipsPct(500)).toBe("0.05%");
    expect(pipsPct(3_000)).toBe("0.30%");
    expect(pipsPct(3_850)).toBe("0.385%");
    expect(pipsPct(10_000)).toBe("1.00%");
  });
  it("token units from base-unit strings", () => {
    expect(units("40000000000", 6, 2)).toBe("40,000");
    expect(units("8277300213270762201", 18, 4)).toBe("8.2773");
    expect(units(-1_500_000n, 6)).toBe("−1.5");
  });
  it("usd and hex", () => {
    expect(usd(64.33024947300515)).toBe("$64.33");
    expect(usd(-318.18)).toBe("−$318.18");
    expect(shortHex("0x1ec3e8479d33772ba0fcfdfc6ab0151eb967c9d25fb9f681b70dfc3ae0836a9e")).toBe("0x1ec3…6a9e");
  });
});

describe("premium", () => {
  it("is integer bp, truncated toward zero like the contract", () => {
    expect(premiumBpsOf("224002", "224002")).toBe(0);
    expect(premiumBpsOf("998000", "1000000")).toBe(-20);
    expect(premiumBpsOf("1000399", "1000000")).toBe(3);
    expect(premiumBpsOf("999601", "1000000")).toBe(-3);
  });
});

describe("replay export", () => {
  it("writes one CSV row per pool with LP − HODL = −LVR", () => {
    const f = JSON.parse(readFileSync(join(process.cwd(), "public", "replay", "binance-halt.json"), "utf8")) as ReplayFile;
    const csv = resultsCsv(f).trim().split("\n");
    expect(csv).toHaveLength(1 + POOLS.length);
    const live = csv.find((l) => l.includes(",avenLive,"))!.split(",");
    expect(Number(live[4])).toBeCloseTo(-Number(f.results.avenLive.lvrUsd), 4);
    expect(Number(live[4])).toBeCloseTo(141.2549, 4);
  });
  it("has the series lengths the charts assume", () => {
    for (const id of ["binance-halt", "calm"]) {
      const f = JSON.parse(readFileSync(join(process.cwd(), "public", "replay", `${id}.json`), "utf8")) as ReplayFile;
      const n = f.series.timestamps.length;
      expect(f.series.oracle).toHaveLength(n);
      for (const p of POOLS) expect(f.series.pools[p.id].lvrUsd).toHaveLength(n);
    }
  });
});
