/**
 * Off-chain reads of the HyperCore precompiles (docs/recon.md §C) via eth_call. Same readOk rule as
 * AvenFairValue.readPrices (§6.3 Step 1): both calls succeed, return >= 32 bytes, value > 0 and <= uint64.
 */
import { decodeAbiParameters, encodeAbiParameters, hexToBigInt, size, slice, type Hex, type PublicClient } from "viem";

export const MARK_PX = "0x0000000000000000000000000000000000000806" as const;
export const ORACLE_PX = "0x0000000000000000000000000000000000000807" as const;
export const PERP_ASSET_INFO = "0x000000000000000000000000000000000000080a" as const;
const UINT64_MAX = 2n ** 64n - 1n;

type Caller = Pick<PublicClient, "call">;

export interface PxRead {
  readOk: boolean;
  oracleRaw: bigint;
  markRaw: bigint;
}

export interface PerpAssetInfo {
  coin: string;
  marginTableId: number;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
}

const encIndex = (perpIndex: number): Hex => encodeAbiParameters([{ type: "uint32" }], [perpIndex]);

async function readOne(client: Caller, to: Hex, perpIndex: number): Promise<{ ok: boolean; px: bigint }> {
  try {
    const { data } = await client.call({ to, data: encIndex(perpIndex) });
    if (!data || size(data) < 32) return { ok: false, px: 0n };
    const w = hexToBigInt(slice(data, 0, 32));
    if (w === 0n || w > UINT64_MAX) return { ok: false, px: 0n };
    return { ok: true, px: w };
  } catch {
    return { ok: false, px: 0n };
  }
}

/** Oracle (0x807) and mark (0x806) for `perpIndex`. Never throws; a failure gives readOk = false. */
export async function readOracleMark(client: Caller, perpIndex: number): Promise<PxRead> {
  const [o, m] = await Promise.all([readOne(client, ORACLE_PX, perpIndex), readOne(client, MARK_PX, perpIndex)]);
  const readOk = o.ok && m.ok;
  return { readOk, oracleRaw: o.ok ? o.px : 0n, markRaw: m.ok ? m.px : 0n };
}

/** perpAssetInfo (0x80a) returns ONE struct, abi.encode(PerpAssetInfo) (recon C.2). */
export async function readPerpAssetInfo(client: Caller, perpIndex: number): Promise<PerpAssetInfo> {
  const { data } = await client.call({ to: PERP_ASSET_INFO, data: encIndex(perpIndex) });
  if (!data) throw new Error(`perpAssetInfo(${perpIndex}) returned no data`);
  return decodePerpAssetInfo(data);
}

export function decodePerpAssetInfo(data: Hex): PerpAssetInfo {
  const [t] = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "coin", type: "string" },
          { name: "marginTableId", type: "uint32" },
          { name: "szDecimals", type: "uint8" },
          { name: "maxLeverage", type: "uint8" },
          { name: "onlyIsolated", type: "bool" },
        ],
      },
    ],
    data,
  );
  return { ...t };
}
