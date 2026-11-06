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

/**
 * Hyperliquid info-API perp price string (e.g. `oraclePx: "2239.9"`) -> the raw uint64 the 0x806/0x807 precompiles
 * return: px * 10^(6 - szDecimals) (recon C.3: precompile == info API after this scaling). Integer-only (no floats).
 * Throws on anything that is not a plain positive decimal, has more fractional digits than 6 - szDecimals (the raw
 * value could not represent it exactly), or does not fit in a uint64 > 0, so a caller never writes a wrong price.
 */
export function pxToRaw(px: string, szDecimals: number): bigint {
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) throw new Error(`bad szDecimals ${szDecimals}`);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(px.trim());
  if (!m) throw new Error(`not a decimal price: "${px}"`);
  const places = 6 - szDecimals;
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > places) throw new Error(`"${px}" has more than ${places} decimals (szDecimals ${szDecimals})`);
  const raw = BigInt(m[1]!) * 10n ** BigInt(places) + BigInt((frac || "0").padEnd(places, "0") || "0");
  if (raw === 0n || raw > UINT64_MAX) throw new Error(`price "${px}" out of uint64 range after scaling`);
  return raw;
}

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
