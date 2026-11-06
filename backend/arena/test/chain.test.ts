import { describe, expect, it } from "vitest";
import { defaultParams, type Deployments } from "@aven/core";
import { makeChain, withGasMargin } from "../src/chain.ts";

describe("makeChain (load-test regression)", () => {
  it("public client never caches the block number, so the poller sees every block", () => {
    const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
    const key = { currency0: A(1), currency1: A(2), fee: 3000, tickSpacing: 60, hooks: A(0) };
    const d = {
      chainId: 31337, deployedAtBlock: 0, explorer: "", tokens: { base: A(1), quote: A(2), baseSymbol: "a", quoteSymbol: "b" },
      poolManager: A(3), swapRouter: A(4), liquidityRouter: A(5), hook: A(6), hookSalt: `0x${"00".repeat(32)}`,
      pools: { aven: { id: `0x${"11".repeat(32)}`, key }, control: { id: `0x${"22".repeat(32)}`, key } },
      config: { perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6 }, params: defaultParams(),
    } as unknown as Deployments;
    const pk = `0x${"11".repeat(32)}` as const;
    const c = makeChain({ rpcUrl: "http://127.0.0.1:1", chainId: 31337, botPk: pk, shockPk: pk, deployments: d });
    expect(c.publicClient.cacheTime).toBe(0);
    expect(c.publicClient.pollingInterval).toBe(250); // receipts noticed within ~1 block, not 4 s
  });
});

describe("withGasMargin (load-test regression: first-swap-of-block OOG)", () => {
  it("covers the hook's first-swap-of-block storage writes on top of a same-block estimate", () => {
    // A same-block estimate for an Aven swap is ~170k; the first swap of a new block also writes top-of-block + anchor.
    expect(withGasMargin(170_000n)).toBe(251_000n);
    expect(withGasMargin(170_000n) - 170_000n).toBeGreaterThan(60_000n);
    expect(withGasMargin(0n)).toBe(30_000n);
  });
});
