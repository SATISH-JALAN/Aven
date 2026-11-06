import { describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";
import { encodeV4SwapInput, erc20AllowanceSlot, permit2AllowanceSlot, permit2PackedAllowance, poolPriceNumber, pushStatus, simulatedSwapOut } from "../src/health.ts";

const cfg999 = { baseIsToken0: true, decimals0: 18, decimals1: 6 };

describe("poolPriceNumber", () => {
  it("matches the mainnet pool init price (DEPLOYMENTS.md §M.5: sqrtPrice 3742639779956839250570048 = $2,231.50)", () => {
    expect(poolPriceNumber(3742639779956839250570048n, cfg999)).toBeCloseTo(2231.5, 1);
  });
  it("inverts when the base is token1", () => {
    const a = poolPriceNumber(3742639779956839250570048n, cfg999);
    // the same raw price read with the base as token1 is the reciprocal
    const b = poolPriceNumber(3742639779956839250570048n, { baseIsToken0: false, decimals0: 18, decimals1: 6 });
    expect(a * b).toBeCloseTo(1, 9);
  });
});

describe("pushStatus", () => {
  it("is at the oracle inside the threshold, pushed above or below outside it", () => {
    expect(pushStatus(100.1, 100)).toMatchObject({ pushed: false, label: "at the oracle" });
    expect(pushStatus(101.88, 100).label).toBe("pushed above the oracle");
    expect(pushStatus(98, 100).label).toBe("pushed below the oracle");
    expect(pushStatus(101.88, 100).bps).toBeCloseTo(188, 6);
  });
  it("uses the given threshold, inclusive", () => {
    expect(pushStatus(100.5, 100, 50).pushed).toBe(true);
    expect(pushStatus(100.49, 100, 50).pushed).toBe(false);
  });
  it("never divides by a zero oracle", () => {
    expect(pushStatus(100, 0)).toMatchObject({ bps: 0, pushed: false });
  });
});

describe("simulatedSwapOut", () => {
  const delta = (a0: bigint, a1: bigint) => (BigInt.asUintN(128, a0) << 128n) | BigInt.asUintN(128, a1);
  it("reads amount1 for zeroForOne and amount0 otherwise, keeping signs", () => {
    const d = delta(-(10n ** 16n), 22_315_000n);
    expect(simulatedSwapOut(d, true)).toBe(22_315_000n);
    expect(simulatedSwapOut(d, false)).toBe(-(10n ** 16n));
    const d2 = delta(8_961_000_000_000_000n, -20_000_000n);
    expect(simulatedSwapOut(d2, false)).toBe(8_961_000_000_000_000n);
  });
});

// Vectors from `cast index` on chain 999. The ERC20 slot holds the deployer's max allowance to PoolSwapTest on mainnet,
// and Permit2's own allowance() getter reads back a value written at the Permit2 slot (checked 2026-11-07).
const DEPLOYER = "0x4412A5313aFd9b6f447EcE820Ce55a30A20034Ee";
const AETH = "0xD4a26168e47acc1b514aF23Fb5a360d171745756";
const SWAP_TEST = "0xFe6baCe2E548fD06735A4242BBD46A3c842E02B1";
const UR_212 = "0xeD270A1Bcdc63cf1356D695e7f40961d4819d6bF";

describe("storage slots for the router simulation", () => {
  it("solmate ERC20 allowance[owner][spender] at mapping slot 4", () => {
    expect(erc20AllowanceSlot(DEPLOYER, SWAP_TEST)).toBe("0xd7b5df8f5f1657922304bfdc26ce7f8d667e4f8fe9f3807ec1fc031b36b061be");
  });
  it("Permit2 allowance[owner][token][spender] at mapping slot 1", () => {
    expect(permit2AllowanceSlot(DEPLOYER, AETH, UR_212)).toBe("0x3021b3adccd1a45f0f5c06d50600db0ab0b75cc9cc621e5581ded574ec8205bb");
  });
  it("packs amount | expiration << 160 | nonce << 208", () => {
    const w = BigInt(permit2PackedAllowance(5n, 7n, 9n));
    expect(w & ((1n << 160n) - 1n)).toBe(5n);
    expect((w >> 160n) & ((1n << 48n) - 1n)).toBe(7n);
    expect(w >> 208n).toBe(9n);
  });
});

describe("encodeV4SwapInput", () => {
  const key = { currency0: AETH, currency1: "0xFC91A98c4bDbF5b20a2Da89e514C66295051efd6", fee: 8388608, tickSpacing: 60, hooks: "0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080" } as const;
  it("runs SWAP_EXACT_IN_SINGLE, SETTLE_ALL (token in), TAKE_ALL (token out, min out)", () => {
    const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], encodeV4SwapInput(key, false, 20_000_000n, 123n, true));
    expect(actions).toBe("0x060c0f");
    expect(params).toHaveLength(3);
    const [settleToken, settleMax] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[1]!);
    const [takeToken, takeMin] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[2]!);
    expect([settleToken, settleMax]).toEqual([key.currency1, 20_000_000n]); // oneForZero pays token1
    expect([takeToken, takeMin]).toEqual([key.currency0, 123n]);
  });
  it("the minHopPriceX36 layout is one word longer", () => {
    const decode = (v: boolean) => decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], encodeV4SwapInput(key, true, 1n, 1n, v))[1][0]!;
    expect((decode(true).length - decode(false).length) / 2).toBe(32);
  });
});
