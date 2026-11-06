import { beforeEach, describe, expect, it, vi } from "vitest";

// Count chain reads made by Arena.state(); the chain module is mocked so no RPC is needed.
const calls = { oracle: 0 };
vi.mock("../src/chain.ts", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
  readOracle: async () => {
    calls.oracle++;
    await new Promise((r) => setTimeout(r, 30)); // slow RPC: concurrent callers overlap
    return { readOk: true, oracleRaw: 224_002n, markRaw: 224_002n };
  },
  readPool: async () => ({ sqrtPriceX96: 3749777783989455640314195n, tick: 0, protocolFee: 0, lpFee: 0 }),
  readLiquidity: async () => 1n,
  previewFee: async () => ({ fee: 500, reason: "OK", gapBps: 0, premiumBps: 0, moveBps: 0, arb: false, withPressure: false }),
  hookPoolState: async () => ({ topBlock: 1n, sqrtPriceTopX96: 1n, anchorMark: 1n, anchorTime: 1n, initialized: true }),
  balances: async () => ({ native: 0n, base: 0n, quote: 0n }),
  ensureApprovals: async () => undefined,
  simulateSwap: async () => {
    throw new Error("unused");
  },
  swapArgs: () => [],
}));

const { Arena } = await import("../src/arena.ts");

const d = {
  chainId: 31337,
  pools: { aven: { id: "0x01" }, control: { id: "0x02" } },
  config: { perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6 },
};

describe("Arena.state() under concurrency (load-test regression)", () => {
  beforeEach(() => {
    calls.oracle = 0;
  });
  it("50 concurrent callers in one block share ONE computation (no thundering herd)", async () => {
    let head = 100n;
    const arena = new Arena({ DATA_DIR: "." } as never, { d, publicClient: { getBlockNumber: async () => head } } as never);
    const all = await Promise.all(Array.from({ length: 50 }, () => arena.state()));
    expect(calls.oracle).toBe(1);
    expect(new Set(all.map((s) => s.block)).size).toBe(1);
    head = 101n; // a new block -> one new computation
    (arena as unknown as { lastBlock: bigint }).lastBlock = 101n;
    await Promise.all(Array.from({ length: 50 }, () => arena.state()));
    expect(calls.oracle).toBe(2);
  });
});
