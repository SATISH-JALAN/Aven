/**
 * Price conversions used off-chain (bot, scripts). Integer BigInt only.
 * sqrtPriceFromWad is the inverse of fee.ts poolWad and matches contracts/test/utils/PriceMath.sol.
 */
import { type Config, mulDiv } from "./fee.ts";

const Q192 = 2n ** 192n;

/**
 * floor(sqrt(x)) for x >= 0. Integer Newton's method from a power-of-two OVER-estimate, so the iterates decrease
 * monotonically to the floor (no float seed: a float seed below the root made the old version step by 1 ~1e8 times).
 */
export function sqrtBig(x: bigint): bigint {
  if (x < 0n) throw new RangeError("sqrtBig: negative");
  if (x < 2n) return x;
  let r = 1n << BigInt(Math.ceil(x.toString(2).length / 2)); // 2^ceil(bits/2) >= sqrt(x)
  for (;;) {
    const next = (r + x / r) >> 1n;
    if (next >= r) return r;
    r = next;
  }
}

/** sqrtPriceX96 at which the pool's base price (wad, quote per base) equals `wad`. */
export function sqrtPriceFromWad(cfg: Config, wad: bigint): bigint {
  const x = cfg.baseIsToken0
    ? mulDiv(wad * 10n ** BigInt(cfg.decimals1), Q192, 10n ** BigInt(18 + cfg.decimals0))
    : mulDiv(10n ** BigInt(18 + cfg.decimals1), Q192, wad * 10n ** BigInt(cfg.decimals0));
  return sqrtBig(x);
}

/** Display only: raw HyperCore perp price -> number (raw / 10^(6 - szDecimals)). Never use in fee math. */
export function rawToPrice(raw: bigint, szDecimals: number): number {
  return Number(raw) / 10 ** (6 - szDecimals);
}

/** Display only: wad -> number. Never use in fee math. */
export function wadToNumber(wad: bigint): number {
  return Number(wad / 10n ** 9n) / 1e9;
}
