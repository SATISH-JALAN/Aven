/** Display formatting only. Fee math never goes through here (it is BigInt in @aven/core). */

export const usd = (x: number, digits = 2): string =>
  (x < 0 ? "−$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const signedUsd = (x: number, digits = 2): string => (x > 0 ? "+" : "") + usd(x, digits);

export const num = (x: number, digits = 2): string =>
  x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const int = (x: number | bigint): string => (typeof x === "bigint" ? x.toLocaleString("en-US") : Math.round(x).toLocaleString("en-US"));

/** Fee in pips (1e6 = 100%) as a percent string: 8700 → "0.87%". */
export const pipsPct = (pips: number): string => {
  const s = (pips / 10_000).toFixed(4).replace(/0+$/, "");
  const [w, f = ""] = s.split(".");
  return `${w}.${f.padEnd(2, "0")}%`;
};

export const bps = (x: number | bigint): string => `${typeof x === "bigint" ? x.toString() : Math.round(x)} bp`;

export const shortHex = (h: string, n = 4): string => (h.length > 2 + n * 2 ? `${h.slice(0, 2 + n)}…${h.slice(-n)}` : h);

/** Token amount from a base-unit string. */
export const units = (raw: string | bigint, decimals: number, digits = 4): string => {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "−" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
};

export const timeUtc = (ms: number): string => new Date(ms).toISOString().slice(11, 19);
export const dateUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Premium in bp from raw values, integer like the contract: (mark − oracle) · 10000 / oracle, truncated. */
export function premiumBpsOf(markRaw: string, oracleRaw: string): number {
  const m = BigInt(markRaw);
  const o = BigInt(oracleRaw);
  return o === 0n ? 0 : Number(((m - o) * 10_000n) / o);
}
