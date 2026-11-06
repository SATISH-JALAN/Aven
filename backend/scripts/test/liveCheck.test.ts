import { describe, expect, it } from "vitest";
import { checkSources, type FeeEvent } from "../src/liveCheck.ts";
import type { RelayLogEntry } from "../src/priceRelay.ts";

const px = (block: number, o: number, m: number): RelayLogEntry => ({ t: "", block: String(block), event: "price", oracleRaw: String(o), markRaw: String(m) });
const edge = (block: number, on: boolean): RelayLogEntry => ({ t: "", block: String(block), event: on ? "fail-on" : "fail-off" });
const ev = (block: number, o: number, m: number, reason = 0): FeeEvent => ({ block: BigInt(block), tx: `0x${block}`, reason, oracleRaw: BigInt(o), markRaw: BigInt(m) });

describe("checkSources", () => {
  const log = [px(0, 100, 101), px(10, 105, 104), px(20, 110, 111)];
  it("accepts the pair in effect, including the one-block write window", () => {
    const r = checkSources([ev(5, 100, 101), ev(11, 105, 104), ev(11, 100, 101), ev(12, 105, 104), ev(25, 110, 111)], log);
    expect(r).toMatchObject({ checked: 5, fromApi: 5, fallbackWhileStale: 0, mismatches: [] });
  });
  it("rejects a price the relay never wrote, a superseded price, and a price used before it was written", () => {
    const r = checkSources([ev(5, 999, 101), ev(12, 100, 101), ev(10, 105, 104)], log);
    expect(r.fromApi).toBe(0);
    expect(r.mismatches.map((x) => Number(x.event.block))).toEqual([5, 12, 10]);
  });
  it("READ_FAILED only counts as expected while the relay had switched reads off", () => {
    const l = [...log, edge(30, true), edge(40, false)];
    const r = checkSources([ev(35, 0, 0, 1), ev(31, 0, 0, 1), ev(41, 0, 0, 1), ev(45, 0, 0, 1), ev(8, 0, 0, 1)], l);
    expect(r.fallbackWhileStale).toBe(3); // 35, 31, and 41 (fail-off at 40 may land at 42)
    expect(r.mismatches.map((x) => Number(x.event.block))).toEqual([45, 8]);
  });
});
