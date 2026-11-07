import { describe, expect, it } from "vitest";
import deployments from "@/config/deployments.json";
import type { Deployments } from "@/config";
import { ledgerRows, ledgerStats } from "@/lib/ledger";
import { swapUsd, viewSwap, type ChainEvent } from "@/lib/onchain";
import { decodePoolLogsForTest } from "@/lib/onchain";

const d = (deployments as Record<string, Deployments>)["999"]!;

// Real logs of the HyperEVM mainnet Aven arb 0xfce1…868f (block 50,561,990): FeeComputed (hook) then Swap (PoolManager).
const tx = "0xfce164020d09a93c06fc212d41e7a24abde051339aa4d9013ed26c86e5ba868f" as const;
const logs = [
  {
    address: "0xfdd13ca6d7fcf4ca710bc8c77546592f42cf6080",
    topics: ["0x107ed7d5819bbbd506ad45246f90190ac1bdd0f9446538605b6f8b953a14b316", "0x659c1cbd66a079592fd333ec44f76b4878aabfe5d9c17b7a14faaabbe7e0d1df", "0x000000000000000000000000fe6bace2e548fd06735a4242bbd46a3c842e02b1"],
    data: "0x00000000000000000000000000000000000000000000000000000000000026de0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000365f0000000000000000000000000000000000000000000000000000000000003659c0000000000000000000000000000000000000000000000000000000000036592000000000000000000000000000000000000000000031f1b9a17c01a4a9b7671000000000000000000000000000000000000000000031f1b9a17c01a4a9b7671",
    logIndex: "0x24",
  },
  {
    address: "0x12d4fd9c5dedd00ab8a0bce2cf0167bbf94b6b1f",
    topics: ["0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f", "0x659c1cbd66a079592fd333ec44f76b4878aabfe5d9c17b7a14faaabbe7e0d1df", "0x000000000000000000000000fe6bace2e548fd06735a4242bbd46a3c842e02b1"],
    data: "0xffffffffffffffffffffffffffffffffffffffffffffffff7c25cd89fde780d000000000000000000000000000000000000000000000000000000004f2680602000000000000000000000000000000000000000000031b9d4eecdaac763a5dc3000000000000000000000000000000000000000000000000016a8551f4c8fbc2fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf61d00000000000000000000000000000000000000000000000000000000000026de",
    logIndex: "0x25",
  },
].map((l) => ({ ...l, transactionHash: tx, blockNumber: "0x30383c6" })) as never;

describe("decodePoolLogs on real mainnet logs", () => {
  const [e] = decodePoolLogsForTest(logs, d);
  it("pairs FeeComputed with its Swap and verifies A and B in the browser", () => {
    expect(e).toBeDefined();
    expect(e!).toMatchObject({ kind: "swap", pool: "aven", block: 50_561_990, fee: 9950, verify: { a: true, b: true } });
    expect(e!.fc).toMatchObject({ fee: 9950, reason: "OK", zeroForOne: true, oracleRaw: "222704", markRaw: "222620", anchorMarkRaw: "222610" });
    expect(e!.breakdown).toMatchObject({ fee: 9950, gapBps: 186, premiumBps: -3, arb: true, withPressure: true });
  });
  it("reads the swap: sold aETH above the oracle and moved the pool toward it", () => {
    const v = viewSwap(e!, d);
    expect(v.dir).toBe("sellBase");
    expect(v.oracle).toBeCloseTo(2227.04, 2);
    expect(v.mark).toBeCloseTo(2226.2, 2);
    expect(v.gapBefore!).toBeGreaterThan(180);
    expect(Math.abs(v.gapAfter!)).toBeLessThan(v.gapBefore!);
    expect(swapUsd(e!, v, d).feeUsd!).toBeGreaterThan(0);
  });
  it("catches a fee the PoolManager didn't charge as computed (check B)", () => {
    const bad = (logs as Array<{ data: string }>).map((l, i) => (i === 1 ? { ...l, data: l.data.slice(0, -4) + "0bb8" } : l)); // Swap.fee = 3000
    const [x] = decodePoolLogsForTest(bad as never, d);
    expect(x!.verify).toEqual({ a: true, b: false });
  });
});

describe("ledgerRows", () => {
  const mk = (o: Partial<ChainEvent>): ChainEvent => ({
    id: `${o.tx ?? "0x1"}:${o.logIndex ?? 0}`,
    kind: "swap",
    tx: "0x1",
    block: 0,
    logIndex: 0,
    pool: "control",
    amount0: "-1000000000000000000",
    amount1: "2200000000",
    sqrtAfter: "3742639779956839250570048",
    fee: 3000,
    fc: null,
    breakdown: null,
    verify: null,
    ...o,
  });
  it("takes a plain swap's price before from the previous swap and its oracle from an Aven swap in the same block", () => {
    const [avenArb] = decodePoolLogsForTest(logs, d);
    const p1 = mk({ tx: "0xa", block: 50_561_980 });
    const p2 = mk({ tx: "0xb", block: 50_561_990, logIndex: 50, sqrtAfter: "3740000000000000000000000" });
    const rows = ledgerRows([p2, avenArb!, p1], d);
    const r2 = rows.find((r) => r.e.tx === "0xb")!;
    expect(r2.oracleFrom).toBe("same block");
    expect(r2.v.oracle).toBeCloseTo(2227.04, 2);
    expect(r2.v.mark).toBeCloseTo(2226.2, 2);
    expect(r2.priceBefore).toBeCloseTo(viewSwap(p1, d).priceAfter, 6);
    expect(r2.sinceSwap).toBe(10);
    const r1 = rows.find((r) => r.e.tx === "0xa")!;
    expect(r1.oracleFrom).toBeNull();
    expect(r1.priceBefore).toBeNull();
    const s = ledgerStats([p1, p2, avenArb!], rows);
    expect(s).toMatchObject({ swaps: { aven: 1, control: 2 }, avenVerified: 1, avenOk: 1 });
  });
});
