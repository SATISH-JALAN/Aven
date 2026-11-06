/**
 * Pure helpers for health.ts: pool price, "pushed off the oracle" status, the output of a simulated swap, and the
 * Universal Router / Permit2 encoding used to simulate a swap through Uniswap's own router.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export interface PriceConfig {
  baseIsToken0: boolean;
  decimals0: number;
  decimals1: number;
}

const Q96 = 2 ** 96;

/** Pool price in quote per base (human units) from slot0's sqrtPriceX96. For display only (float). */
export function poolPriceNumber(sqrtPriceX96: bigint, cfg: PriceConfig): number {
  const r = Number(sqrtPriceX96) / Q96;
  const raw = r * r; // token1 per token0, raw units
  return cfg.baseIsToken0 ? raw * 10 ** (cfg.decimals0 - cfg.decimals1) : (1 / raw) * 10 ** (cfg.decimals1 - cfg.decimals0);
}

export type PushLabel = "at the oracle" | "pushed above the oracle" | "pushed below the oracle";

/** How far the pool sits from the oracle, in bp, and whether that counts as pushed (|bps| >= thresholdBps). */
export function pushStatus(poolPrice: number, oracle: number, thresholdBps = 25): { bps: number; pushed: boolean; label: PushLabel } {
  const bps = oracle > 0 ? ((poolPrice - oracle) / oracle) * 10_000 : 0;
  const pushed = Math.abs(bps) >= thresholdBps;
  return { bps, pushed, label: !pushed ? "at the oracle" : bps > 0 ? "pushed above the oracle" : "pushed below the oracle" };
}

/** Amount the swapper receives from a v4 BalanceDelta (int256: amount0 in the high 128 bits, amount1 in the low). */
export function simulatedSwapOut(delta: bigint, zeroForOne: boolean): bigint {
  const toInt128 = (x: bigint) => BigInt.asIntN(128, x);
  const amount0 = toInt128(delta >> 128n);
  const amount1 = toInt128(delta);
  return zeroForOne ? amount1 : amount0;
}

// ---- Uniswap Universal Router (V4_SWAP) encoding, for simulating a swap through Uniswap's own router ----

export interface RouterPoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const POOL_KEY_TUPLE = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

/** UR command V4_SWAP and the V4Router actions it runs (v4-periphery Actions.sol). */
export const UR_V4_SWAP = "0x10" as const;
export const V4_ACTIONS_EXACT_IN_SINGLE = "0x060c0f" as const; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

/**
 * The single input of `execute(commands = V4_SWAP, inputs, deadline)` for an exact-input single-pool swap.
 * `withMinHopPrice` adds ExactInputSingleParams.minHopPriceX36 (newer v4-periphery); older routers don't have it.
 */
export function encodeV4SwapInput(key: RouterPoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint, withMinHopPrice: boolean): Hex {
  const [cIn, cOut] = zeroForOne ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
  const swapParams = withMinHopPrice
    ? encodeAbiParameters(
        [{ type: "tuple", components: [{ ...POOL_KEY_TUPLE, name: "poolKey" }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }] }],
        [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: "0x" }],
      )
    : encodeAbiParameters(
        [{ type: "tuple", components: [{ ...POOL_KEY_TUPLE, name: "poolKey" }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }],
        [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }],
      );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [cIn, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [cOut, minOut]);
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [V4_ACTIONS_EXACT_IN_SINGLE, [swapParams, settle, take]]);
}

const mapSlot = (key: Hex, slot: Hex): Hex => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [key, slot]));
const addrKey = (a: Address): Hex => encodeAbiParameters([{ type: "address" }], [a]);
const slotHex = (n: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [n]);

/** Storage slot of solmate ERC20 `allowance[owner][spender]` (mapping at slot 4; balanceOf is slot 3). */
export function erc20AllowanceSlot(owner: Address, spender: Address, mappingSlot = 4n): Hex {
  return mapSlot(addrKey(spender), mapSlot(addrKey(owner), slotHex(mappingSlot)));
}

/** Storage slot of Permit2 `allowance[owner][token][spender]` (AllowanceTransfer mapping at slot 1). */
export function permit2AllowanceSlot(owner: Address, token: Address, spender: Address): Hex {
  return mapSlot(addrKey(spender), mapSlot(addrKey(token), mapSlot(addrKey(owner), slotHex(1n))));
}

/** Permit2 PackedAllowance word: amount (uint160) | expiration (uint48) << 160 | nonce (uint48) << 208. */
export function permit2PackedAllowance(amount: bigint, expiration: bigint, nonce = 0n): Hex {
  return slotHex((nonce << 208n) | (expiration << 160n) | amount);
}
