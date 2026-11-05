/**
 * Uniswap v4 pool helpers: PoolId and slot0 via PoolManager.extsload (StateLibrary layout, recon / v4-core
 * StateLibrary.sol: POOLS_SLOT = 6, slot = keccak256(abi.encodePacked(poolId, POOLS_SLOT)), packed
 * lpFee(24) | protocolFee(24) | tick(24) | sqrtPriceX96(160)).
 */
import { encodeAbiParameters, encodePacked, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { poolManagerAbi } from "./abi.ts";

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface Slot0 {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
}

export const POOLS_SLOT = 6n;

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

export function poolStateSlot(id: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "uint256"], [id, POOLS_SLOT]));
}

export function decodeSlot0(word: bigint): Slot0 {
  const sqrtPriceX96 = word & ((1n << 160n) - 1n);
  let tick = Number((word >> 160n) & 0xffffffn);
  if (tick >= 0x800000) tick -= 0x1000000; // int24 sign extension
  const protocolFee = Number((word >> 184n) & 0xffffffn);
  const lpFee = Number((word >> 208n) & 0xffffffn);
  return { sqrtPriceX96, tick, protocolFee, lpFee };
}

export async function readSlot0(client: Pick<PublicClient, "readContract">, poolManager: Address, id: Hex): Promise<Slot0> {
  const word = (await client.readContract({
    address: poolManager,
    abi: poolManagerAbi,
    functionName: "extsload",
    args: [poolStateSlot(id)],
  })) as Hex;
  return decodeSlot0(BigInt(word));
}
