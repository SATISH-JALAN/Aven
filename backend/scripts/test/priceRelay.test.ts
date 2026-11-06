import { describe, expect, it } from "vitest";
import { PriceRelay, fetchPerpPrices, type PerpPrices, type RelayLogEntry } from "../src/priceRelay.ts";

// Shape of a real mainnet metaAndAssetCtxs answer (trimmed): index 1 = ETH, szDecimals 4.
const apiBody = (ethName = "ETH", sz = 4, oraclePx = "2239.9", markPx = "2239.1") => [
  { universe: [{ name: "BTC", szDecimals: 5 }, { name: ethName, szDecimals: sz }] },
  [{ oraclePx: "100000.0", markPx: "100001.0" }, { oraclePx, markPx }],
];
const fakeFetch = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const src = { apiUrl: "http://x", perpIndex: 1, coin: "ETH", szDecimals: 4 };

describe("fetchPerpPrices", () => {
  it("reads oracle + mark for the index and scales them exactly like the precompile", async () => {
    expect(await fetchPerpPrices({ ...src, fetchFn: fakeFetch(apiBody()) })).toEqual({ oracleRaw: 223_990n, markRaw: 223_910n, oraclePx: "2239.9", markPx: "2239.1" });
  });
  it("refuses a different asset or szDecimals at that index, HTTP errors and unrepresentable prices", async () => {
    await expect(fetchPerpPrices({ ...src, fetchFn: fakeFetch(apiBody("SOL")) })).rejects.toThrow(/expected ETH/);
    await expect(fetchPerpPrices({ ...src, fetchFn: fakeFetch(apiBody("ETH", 3)) })).rejects.toThrow(/szDecimals/);
    await expect(fetchPerpPrices({ ...src, fetchFn: fakeFetch({}, 500) })).rejects.toThrow(/HTTP 500/);
    await expect(fetchPerpPrices({ ...src, perpIndex: 7, fetchFn: fakeFetch(apiBody()) })).rejects.toThrow(/missing/);
    await expect(fetchPerpPrices({ ...src, fetchFn: fakeFetch(apiBody("ETH", 4, "2239.901")) })).rejects.toThrow(/decimals/);
  });
});

function harness(sequence: Array<PerpPrices | Error>) {
  let t = 1_000_000;
  let i = 0;
  const writes: Array<[bigint, bigint]> = [];
  const failure: boolean[] = [];
  const order: string[] = [];
  const logs: RelayLogEntry[] = [];
  let writeThrows = false;
  const relay = new PriceRelay({
    source: async () => {
      const v = sequence[Math.min(i++, sequence.length - 1)]!;
      if (v instanceof Error) throw v;
      return v;
    },
    write: async (o, m) => {
      if (writeThrows) throw new Error("anvil down");
      writes.push([o, m]);
      order.push("write");
    },
    setFailure: async (on) => {
      failure.push(on);
      order.push(on ? "fail-on" : "fail-off");
    },
    blockNumber: async () => 42n,
    log: (e) => logs.push(e),
    staleMs: 15_000,
    now: () => t,
  });
  return { relay, writes, failure, order, logs, advance: (ms: number) => (t += ms), setWriteThrows: (v: boolean) => (writeThrows = v) };
}
const px = (o: bigint, m: bigint): PerpPrices => ({ oracleRaw: o, markRaw: m, oraclePx: String(o), markPx: String(m) });

describe("PriceRelay", () => {
  it("writes the first price and then only changes (oracle and mark together)", async () => {
    const h = harness([px(100n, 101n), px(100n, 101n), px(100n, 102n), px(103n, 102n)]);
    for (let k = 0; k < 4; k++) await h.relay.tick();
    expect(h.writes).toEqual([[100n, 101n], [100n, 102n], [103n, 102n]]);
    expect(h.failure).toEqual([]);
    expect(h.logs.map((l) => [l.event, l.oracleRaw, l.markRaw, l.block])).toEqual([
      ["price", "100", "101", "42"],
      ["price", "100", "102", "42"],
      ["price", "103", "102", "42"],
    ]);
  });

  it("after staleMs without a good answer, makes the reads fail (hook -> fallback fee); recovery writes fresh prices first", async () => {
    const down = new Error("API down");
    const h = harness([px(100n, 101n), down, down, down, px(100n, 101n)]);
    await h.relay.tick(); // ok
    h.advance(10_000);
    await h.relay.tick(); // error, 10 s: not stale yet
    expect(h.failure).toEqual([]);
    h.advance(6_000);
    await h.relay.tick(); // error, 16 s > 15 s: stale -> fail on
    expect(h.failure).toEqual([true]);
    expect(h.relay.status().failing).toBe(true);
    await h.relay.tick(); // still down: no second fail-on
    expect(h.failure).toEqual([true]);
    await h.relay.tick(); // back, same price as before: must still write (reads were failing), then clear
    expect(h.order).toEqual(["write", "fail-on", "write", "fail-off"]);
    expect(h.relay.status().failing).toBe(false);
    expect(h.logs.map((l) => l.event)).toEqual(["price", "fail-on", "price", "fail-off"]);
    expect(h.logs[1]!.reason).toContain("API down");
  });

  it("a failing write (chain down) counts as an error and leads to stale handling, never a throw", async () => {
    const h = harness([px(1n, 1n), px(2n, 2n), px(3n, 3n)]);
    await h.relay.tick();
    h.setWriteThrows(true);
    h.advance(16_000);
    await expect(h.relay.tick()).resolves.toBeUndefined();
    expect(h.relay.status().errors).toBe(1);
    expect(h.failure).toEqual([true]);
  });
});
