import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { avenHookAbi, poolManagerAbi } from "../src/abi.ts";
import { parseDeployments } from "../src/addresses.ts";
import { Q96, defaultParams, type Config } from "../src/fee.ts";
import { decodeSlot0, poolId, poolStateSlot } from "../src/pool.ts";
import { decodePerpAssetInfo, readOracleMark } from "../src/precompiles.ts";
import { verifyLogs } from "../src/verify.ts";

describe("pool", () => {
  const key = {
    currency0: "0x1111111111111111111111111111111111111111" as Address,
    currency1: "0x2222222222222222222222222222222222222222" as Address,
    fee: 0x800000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000002080" as Address,
  };
  it("poolId and state slot match cast (independent implementation)", () => {
    // cast keccak $(cast abi-encode "f(address,address,uint24,int24,address)" ...); slot = keccak(id ++ uint256(6))
    expect(poolId(key)).toBe("0x9b9f64a237c3e2067e230f06c5592cfd77173d2d80ce7a12c7784b45c7c6fb0d");
    expect(poolStateSlot(poolId(key))).toBe("0xb2d9a4b060b01076788c16310b30153f90fef4116579457f6442b0e5496a1707");
  });
  it("decodeSlot0 unpacks lpFee|protocolFee|tick|sqrtPrice incl. negative ticks", () => {
    const w = (3000n << 208n) | (0x123456n << 184n) | (0xffff75n << 160n) | Q96;
    expect(decodeSlot0(w)).toEqual({ sqrtPriceX96: Q96, tick: -139, protocolFee: 0x123456, lpFee: 3000 });
    expect(decodeSlot0((887272n << 160n) | 1n).tick).toBe(887272);
  });
});

describe("precompiles", () => {
  it("decodes the real testnet perpAssetInfo(135) bytes (recon C.2: one struct)", () => {
    const real = ("0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "00000000000000000000000000000000000000000000000000000000000000a0" +
      "000000000000000000000000000000000000000000000000000000000000000a" +
      "0000000000000000000000000000000000000000000000000000000000000002" +
      "000000000000000000000000000000000000000000000000000000000000000a" +
      "0000000000000000000000000000000000000000000000000000000000000001" +
      "0000000000000000000000000000000000000000000000000000000000000004" +
      "4859504500000000000000000000000000000000000000000000000000000000") as Hex;
    expect(decodePerpAssetInfo(real)).toEqual({ coin: "HYPE", marginTableId: 10, szDecimals: 2, maxLeverage: 10, onlyIsolated: true });
  });
  const word = (v: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [v]);
  const fake = (o: Hex | undefined | Error, m: Hex | undefined | Error) => ({
    call: async ({ to }: { to?: Address | null }) => {
      const r = to?.toLowerCase().endsWith("807") ? o : m;
      if (r instanceof Error) throw r;
      return { data: r };
    },
  });
  it("readOk rule mirrors Solidity: success, >=32 bytes, >0, <=uint64", async () => {
    expect(await readOracleMark(fake(word(224_002n), word(224_839n)) as never, 4)).toEqual({ readOk: true, oracleRaw: 224_002n, markRaw: 224_839n });
    expect((await readOracleMark(fake(undefined, word(1n)) as never, 4)).readOk).toBe(false); // empty
    expect((await readOracleMark(fake(word(0n), word(1n)) as never, 4)).readOk).toBe(false); // zero
    expect((await readOracleMark(fake(word(2n ** 64n), word(1n)) as never, 4)).readOk).toBe(false); // > uint64
    expect((await readOracleMark(fake(new Error("revert"), word(1n)) as never, 4)).readOk).toBe(false); // revert
    const oneSide = await readOracleMark(fake(word(5n), new Error("x")) as never, 4);
    expect(oneSide).toEqual({ readOk: false, oracleRaw: 5n, markRaw: 0n });
  });
});

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const fixture = {
  chainId: 31337,
  deployedAtBlock: 1,
  explorer: "",
  tokens: { base: A(1), quote: A(2), baseSymbol: "aETH", quoteSymbol: "aUSD" },
  poolManager: A(3),
  swapRouter: A(4),
  liquidityRouter: A(5),
  hook: A(0x2080),
  hookSalt: `0x${"00".repeat(32)}`,
  pools: {
    aven: { id: `0x${"11".repeat(32)}`, key: { currency0: A(1), currency1: A(2), fee: 8388608, tickSpacing: 60, hooks: A(0x2080) } },
    control: { id: `0x${"22".repeat(32)}`, key: { currency0: A(1), currency1: A(2), fee: 3000, tickSpacing: 60, hooks: A(0) } },
  },
  config: { perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6 },
  params: defaultParams(),
};

describe("addresses (§8.3 schema)", () => {
  it("accepts a valid file, rejects bad addresses and unknown keys", () => {
    expect(parseDeployments(fixture).config.perpIndex).toBe(4);
    expect(() => parseDeployments({ ...fixture, hook: "0x123" })).toThrow();
    expect(() => parseDeployments({ ...fixture, surprise: 1 })).toThrow();
    expect(() => parseDeployments({ ...fixture, config: { ...fixture.config, szDecimals: 7 } })).toThrow();
  });
});

describe("verify (§7.3)", () => {
  const cfg: Config = { perpIndex: 0, szDecimals: 0, baseIsToken0: true, decimals0: 18, decimals1: 18 };
  const hook = A(0x2080);
  const pm = A(3);
  const pid = `0x${"ab".repeat(32)}` as Hex;
  const feeLog = (fee: number, reason = 0, o = 985_221n) => ({
    address: hook,
    topics: encodeEventTopics({ abi: avenHookAbi, eventName: "FeeComputed", args: { poolId: pid, sender: A(9) } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint24" }, { type: "uint8" }, { type: "bool" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "uint160" }, { type: "uint160" }],
      [fee, reason, true, o, 983_250n, 980_309n, Q96, Q96],
    ),
  });
  const swapLog = (fee: number, id: Hex = pid) => ({
    address: pm,
    topics: encodeEventTopics({ abi: poolManagerAbi, eventName: "Swap", args: { id, sender: A(9) } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }],
      [-1n, 1n, Q96, 1n, 0, fee],
    ),
  });
  const opts = { hook, poolManager: pm, config: cfg, params: defaultParams() };

  it("MATCH on the worked example (9,000 pips) when FeeComputed and Swap agree", () => {
    const [r] = verifyLogs([feeLog(9_000), swapLog(9_000)], opts);
    expect(r).toMatchObject({ match: true, checkA: true, checkB: true, onchainFee: 9_000, recomputedFee: 9_000, swapEventFee: 9_000 });
    expect(r!.breakdown).toEqual({ fee: 9_000, reason: "OK", gapBps: 150, premiumBps: -20, moveBps: 30, arb: true, withPressure: true });
  });
  it("check A fails when the logged fee is not the formula", () => {
    const [r] = verifyLogs([feeLog(8_999), swapLog(8_999)], opts);
    expect([r!.match, r!.checkA, r!.checkB]).toEqual([false, false, true]);
  });
  it("check B fails when the PoolManager charged something else, or the Swap log is missing / for another pool", () => {
    expect(verifyLogs([feeLog(9_000), swapLog(3_000)], opts)[0]!.checkB).toBe(false);
    expect(verifyLogs([feeLog(9_000)], opts)[0]!.checkB).toBe(false);
    expect(verifyLogs([feeLog(9_000), swapLog(9_000, `0x${"cd".repeat(32)}`)], opts)[0]!.checkB).toBe(false);
  });
  it("READ_FAILED events verify against the fallback fee", () => {
    const [r] = verifyLogs([feeLog(3_000, 1, 0n), swapLog(3_000)], opts);
    expect(r).toMatchObject({ match: true, recomputedFee: 3_000 });
    expect(r!.breakdown.reason).toBe("READ_FAILED");
  });
  it("protocol fee is folded into check B", () => {
    const [r] = verifyLogs([feeLog(9_000), swapLog(9_000 + 1_000 - 9)], { ...opts, protocolFee: 1_000 });
    expect(r!.checkB).toBe(true);
  });
  it("ignores logs from other addresses", () => {
    expect(verifyLogs([{ ...feeLog(9_000), address: A(77) }, swapLog(9_000)], opts)).toEqual([]);
  });
});
