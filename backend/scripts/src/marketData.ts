/**
 * Replay market data (PLAN 5.1, ARCHITECTURE §3.4, §7.5, DATA.md B5). Hyperliquid MAINNET info API:
 *   candleSnapshot {coin, interval, startTime, endTime} -> [{t, T, o, h, l, c, v, n, s, i}], <= ~5,000 per response;
 *   fundingHistory {coin, startTime, endTime}          -> [{coin, fundingRate, premium, time}] (hourly).
 * normalized.csv = timestamp,markClose,premium,oracleProxy,interval where premium is forward-filled from the latest
 * funding sample at or before each candle and oracleProxy = markClose / (1 + premium).
 * LIMITS (stated on every chart): candle close is the perp's last trade, used as the mark proxy; the oracle is
 * reconstructed from the hourly funding premium, not the historical validator oracle (§13).
 */

export interface Candle {
  t: number; // open time ms
  T: number; // close time ms
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
  s?: string;
  i?: string;
}

export interface Funding {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

export interface Scenario {
  id: string;
  label: string;
  coin: string;
  start: string; // ISO UTC
  end: string; // ISO UTC, exclusive
  note?: string;
  placeholder?: boolean;
}

export interface NormalizedRow {
  timestamp: number;
  markClose: number;
  premium: number;
  oracleProxy: number;
  interval: string;
}

export const INTERVAL_MS: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 };

export type Post = (body: unknown) => Promise<unknown>;

export function httpPost(url: string): Post {
  return async (body) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return r.json();
      if (attempt >= 4 || (r.status !== 429 && r.status < 500)) throw new Error(`info API ${r.status}: ${await r.text()}`);
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
    }
  };
}

/** All candles in [startMs, endMs), paging by last close + 1 ms (§3.4). */
export async function fetchCandles(post: Post, coin: string, interval: string, startMs: number, endMs: number): Promise<{ candles: Candle[]; pages: unknown[] }> {
  const pages: unknown[] = [];
  const out = new Map<number, Candle>();
  let from = startMs;
  for (let page = 0; page < 1_000; page++) {
    const res = (await post({ type: "candleSnapshot", req: { coin, interval, startTime: from, endTime: endMs - 1 } })) as Candle[];
    pages.push(res);
    if (!Array.isArray(res) || res.length === 0) break;
    for (const c of res) if (c.t >= startMs && c.t < endMs) out.set(c.t, c);
    const last = res[res.length - 1]!;
    if (last.T + 1 <= from || last.T + 1 >= endMs) break;
    from = last.T + 1;
    if (res.length < 4_000) break; // a short page is the last one
  }
  return { candles: [...out.values()].sort((a, b) => a.t - b.t), pages };
}

/** Funding samples from 2 h before the window (so the first candle has a premium) to its end. */
export async function fetchFunding(post: Post, coin: string, startMs: number, endMs: number): Promise<Funding[]> {
  const res = (await post({ type: "fundingHistory", coin, startTime: startMs - 2 * 3_600_000, endTime: endMs })) as Funding[];
  return [...res].sort((a, b) => a.time - b.time);
}

/** Candle open times expected in [startMs, endMs) that are missing. */
export function missingIntervals(candles: readonly Candle[], interval: string, startMs: number, endMs: number): number[] {
  const step = INTERVAL_MS[interval];
  if (!step) throw new Error(`unknown interval ${interval}`);
  const have = new Set(candles.map((c) => c.t));
  const missing: number[] = [];
  for (let t = startMs; t < endMs; t += step) if (!have.has(t)) missing.push(t);
  return missing;
}

/** Build normalized rows: premium forward-filled from the latest funding sample at or before each candle open. */
export function normalize(candles: readonly Candle[], funding: readonly Funding[], interval: string): NormalizedRow[] {
  const f = [...funding].sort((a, b) => a.time - b.time);
  let j = -1;
  const rows: NormalizedRow[] = [];
  for (const c of candles) {
    while (j + 1 < f.length && f[j + 1]!.time <= c.t) j++;
    if (j < 0) throw new Error(`no funding sample at or before candle ${new Date(c.t).toISOString()}`);
    const premium = Number(f[j]!.premium);
    const markClose = Number(c.c);
    if (!(markClose > 0) || !Number.isFinite(premium) || premium <= -1) throw new Error(`bad data at ${c.t}`);
    rows.push({ timestamp: c.t, markClose, premium, oracleProxy: markClose / (1 + premium), interval });
  }
  return rows;
}

export function toCsv(rows: readonly NormalizedRow[]): string {
  const lines = ["timestamp,markClose,premium,oracleProxy,interval"];
  for (const r of rows) lines.push(`${r.timestamp},${r.markClose},${r.premium},${Number(r.oracleProxy.toPrecision(10))},${r.interval}`);
  return `${lines.join("\n")}\n`;
}

/** Try 1m first; if it is unavailable or incomplete for the window, fall back to 5m (P7). */
export async function fetchScenario(post: Post, s: Scenario) {
  const startMs = Date.parse(s.start);
  const endMs = Date.parse(s.end);
  if (!(endMs > startMs)) throw new Error(`scenario ${s.id}: end must be after start`);
  let interval = "1m";
  let got = await fetchCandles(post, s.coin, interval, startMs, endMs);
  let missing = missingIntervals(got.candles, interval, startMs, endMs);
  let fallbackReason: string | null = null;
  if (got.candles.length === 0 || missing.length > 0) {
    fallbackReason = got.candles.length === 0 ? "1m candles not served for this window" : `1m incomplete (${missing.length} missing)`;
    interval = "5m";
    got = await fetchCandles(post, s.coin, interval, startMs, endMs);
    missing = missingIntervals(got.candles, interval, startMs, endMs);
  }
  const funding = await fetchFunding(post, s.coin, startMs, endMs);
  const rows = normalize(got.candles, funding, interval);
  return { interval, fallbackReason, candles: got.candles, pages: got.pages, funding, rows, missing, startMs, endMs };
}
