import { describe, expect, it } from "vitest";
import { defaultParams, type Deployments } from "@aven/core";
import { checkGasCap, GasPriceTooHigh, gweiToWei, makeChain, withGasMargin, writeWithMargin } from "../src/chain.ts";

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

describe("mainnet gas cap (pre-mainnet audit: base fee measured at 0.10-10.8 gwei within 3 h)", () => {
  it("checkGasCap: refuses above the cap, allows at/below it, and 0 means no cap", () => {
    const cap = gweiToWei(2);
    expect(cap).toBe(2_000_000_000n);
    expect(() => checkGasCap(2_000_000_001n, cap)).toThrow(GasPriceTooHigh);
    expect(() => checkGasCap(2_000_000_000n, cap)).not.toThrow();
    expect(() => checkGasCap(10n ** 12n, 0n)).not.toThrow();
  });
  it("writeWithMargin puts maxFeePerGas = cap on the tx (so it can never cost more than gasUsed * cap)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const c = { publicClient: { estimateContractGas: async () => 170_000n } } as never;
    const who = { account: { address: "0xb0" }, wallet: { chain: { id: 999 }, writeContract: async (r: Record<string, unknown>) => (sent.push(r), "0xhash") } } as never;
    await writeWithMargin(c, who, { address: "0x01" } as never, gweiToWei(2));
    await writeWithMargin(c, who, { address: "0x01" } as never);
    expect(sent[0]).toMatchObject({ gas: 251_000n, maxFeePerGas: 2_000_000_000n });
    expect(sent[1]).toMatchObject({ gas: 251_000n });
    expect("maxFeePerGas" in sent[1]!).toBe(false);
  });
});
