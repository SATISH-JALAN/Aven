import { beforeEach, describe, expect, it, vi } from "vitest";

// Count chain reads made by Arena.state(); the chain module is mocked so no RPC is needed.
const calls = { oracle: 0, balances: 0, verify: 0 };
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
  balances: async () => {
    calls.balances++;
    return { native: 0n, base: 0n, quote: 0n };
  },
  ensureApprovals: async () => undefined,
  simulateSwap: async () => {
    throw new Error("unused");
  },
  swapArgs: () => [],
}));

// verifyTx is the only @aven/core export these tests replace.
vi.mock("@aven/core", async (orig) => ({
  ...(await orig<typeof import("@aven/core")>()),
  verifyTx: async () => {
    calls.verify++;
    return { match: true, results: [] };
  },
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

describe("Arena.state() right after our own tx (live-mode recording regression)", () => {
  it("serves the block of our own receipt even before the poller has seen it (no stale pre-shock state)", async () => {
    calls.oracle = 0;
    const arena = new Arena({ DATA_DIR: "." } as never, { d, publicClient: { getBlockNumber: async () => 100n } } as never);
    (arena as unknown as { lastBlock: bigint }).lastBlock = 100n;
    expect((await arena.state()).block).toBe(100);
    (arena as unknown as { noteOwnTxBlock: (b: bigint) => void }).noteOwnTxBlock(101n); // shock receipt in block 101
    expect((await arena.state()).block).toBe(101); // poller still at 100
    expect(calls.oracle).toBe(2);
    (arena as unknown as { noteOwnTxBlock: (b: bigint) => void }).noteOwnTxBlock(99n); // never goes backwards
    expect((await arena.state()).block).toBe(101);
    expect(calls.oracle).toBe(2);
  });
});

describe("RPC-backed GETs are cached (pre-mainnet audit: the public RPC allows 100 requests/min)", () => {
  const dd = { ...d, hook: "0x0000000000000000000000000000000000002080", poolManager: "0x0000000000000000000000000000000000000001", params: {} };
  const mk = () => new Arena({ DATA_DIR: "." } as never, { d: dd, bot: { account: { address: "0xb0" } }, shock: { account: { address: "0x5c" } }, publicClient: { getBlockNumber: async () => 100n } } as never);
  it("/bot/status reads balances once per block, however many callers", async () => {
    calls.balances = 0;
    const arena = mk();
    (arena as unknown as { lastBlock: bigint }).lastBlock = 100n;
    await Promise.all(Array.from({ length: 20 }, () => arena.botStatus()));
    expect(calls.balances).toBe(2); // bot + shock, once
    (arena as unknown as { lastBlock: bigint }).lastBlock = 101n;
    await arena.botStatus();
    expect(calls.balances).toBe(4);
  });
  it("/verify/:tx is computed once per tx (case-insensitive), then served from cache", async () => {
    calls.verify = 0;
    const arena = mk();
    const tx = `0x${"ab".repeat(32)}` as `0x${string}`;
    expect(await arena.verify(tx)).toBeNull();
    expect(await arena.verify(tx.toUpperCase().replace("0X", "0x") as `0x${string}`)).toBeNull();
    expect(calls.verify).toBe(1);
  });
});
