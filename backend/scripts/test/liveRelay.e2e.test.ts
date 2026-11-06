/**
 * Live-mode relay on a real local chain with the unchanged AvenHook (E2E=1 only; ~2 min: forge build + 5 deploy scripts).
 * Proves end to end what the unit tests prove in isolation: relayed prices reach the hook through 0x807/0x806 exactly,
 * a stale API makes the hook fall back (READ_FAILED), and recovery restores fresh prices.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avenHookAbi, readOracleMark, Reason } from "@aven/core";
import { startLocalChain, type LocalChain } from "../src/localChain.ts";
import { PriceRelay, type PerpPrices, type RelayLogEntry } from "../src/priceRelay.ts";

const enabled = process.env.E2E === "1";
const PERP = 1; // mainnet ETH

describe.skipIf(!enabled)("live relay -> mock precompiles -> unchanged AvenHook", () => {
  let chain: LocalChain;
  let t = 1_000_000;
  let next: PerpPrices | Error = { oracleRaw: 223_990n, markRaw: 223_910n, oraclePx: "2239.9", markPx: "2239.1" };
  const logs: RelayLogEntry[] = [];
  let relay: PriceRelay;

  beforeAll(async () => {
    chain = await startLocalChain({ port: 8571, perpIndex: PERP, coin: "ETH", szDecimals: 4, oracleRaw: 223_990n, markRaw: 223_910n, quiet: true });
    relay = new PriceRelay({
      source: async () => {
        if (next instanceof Error) throw next;
        return next;
      },
      write: chain.writePrices,
      setFailure: chain.setReadFailure,
      blockNumber: () => chain.publicClient.getBlockNumber({ cacheTime: 0 }),
      log: (e) => logs.push(e),
      staleMs: 15_000,
      now: () => t,
    });
  }, 300_000);
  afterAll(async () => {
    relay?.stop();
    await chain?.stop();
  });

  const preview = () =>
    chain.publicClient.readContract({ address: chain.deployments.hook as `0x${string}`, abi: avenHookAbi, functionName: "previewFee", args: [chain.deployments.pools.aven.key as never, false] });

  it("relayed prices are what the precompiles return and what the hook prices with", async () => {
    next = { oracleRaw: 224_510n, markRaw: 224_620n, oraclePx: "2245.1", markPx: "2246.2" };
    await relay.tick();
    expect(await readOracleMark(chain.publicClient, PERP)).toEqual({ readOk: true, oracleRaw: 224_510n, markRaw: 224_620n });
    const b = await preview();
    expect(Number(b.reason)).not.toBe(Reason.READ_FAILED);
    expect(logs.at(-1)).toMatchObject({ event: "price", oracleRaw: "224510", markRaw: "224620" });
  }, 60_000);

  it("stale API -> both reads fail -> the hook charges the fallback (READ_FAILED); recovery restores fresh prices", async () => {
    next = new Error("API down");
    t += 16_000;
    await relay.tick();
    expect(relay.status().failing).toBe(true);
    expect((await readOracleMark(chain.publicClient, PERP)).readOk).toBe(false);
    const failed = await preview();
    expect(Number(failed.reason)).toBe(Reason.READ_FAILED);
    expect(Number(failed.fee)).toBe(chain.deployments.params.fallbackFee);

    next = { oracleRaw: 224_700n, markRaw: 224_650n, oraclePx: "2247.0", markPx: "2246.5" };
    t += 1_000;
    await relay.tick();
    expect(relay.status().failing).toBe(false);
    expect(await readOracleMark(chain.publicClient, PERP)).toEqual({ readOk: true, oracleRaw: 224_700n, markRaw: 224_650n });
    expect(Number((await preview()).reason)).not.toBe(Reason.READ_FAILED);
    expect(logs.map((l) => l.event)).toEqual(["price", "fail-on", "price", "fail-off"]);
  }, 60_000);
});
