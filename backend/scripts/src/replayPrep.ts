/**
 * Replay pre-step (PLAN 5.2): normalized.csv -> JSON that contracts/test/replay/Replay.t.sol reads with vm.parseJson.
 * Prices become HyperCore raw integers (raw = price * 10^(6 - szDecimals), recon C) for the MockHyperCorePx.
 * Delayed hook (perp index 1): the price `lagSec` earlier, linearly interpolated between candles. 1m data isn't served
 * for these dates, so a 60 s lag inside a 5 m step can't be read directly (stated in the summary).
 */
import type { NormalizedRow } from "./marketData.ts";

export interface ReplayInput {
  scenario: string;
  interval: string;
  szDecimals: number;
  lagSec: number;
  ts: number[]; // unix seconds
  oracle: number[]; // raw
  mark: number[]; // raw
  oracleLag: number[];
  markLag: number[];
}

export function parseNormalizedCsv(csv: string): NormalizedRow[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== "timestamp,markClose,premium,oracleProxy,interval") throw new Error(`unexpected header: ${header}`);
  return lines.map((l) => {
    const [t, m, p, o, i] = l.split(",");
    return { timestamp: Number(t), markClose: Number(m), premium: Number(p), oracleProxy: Number(o), interval: i! };
  });
}

export const toRaw = (price: number, szDecimals: number) => Math.round(price * 10 ** (6 - szDecimals));

/** Value `lagSec` before step k: linear between step k-1 and k (step 0 has no history: no lag). */
export function lagged(values: readonly number[], ts: readonly number[], lagSec: number): number[] {
  return values.map((v, k) => {
    if (k === 0 || lagSec <= 0) return v;
    const dt = ts[k]! - ts[k - 1]!;
    if (lagSec >= dt) return values[k - 1]!;
    return Math.round(values[k - 1]! + ((v - values[k - 1]!) * (dt - lagSec)) / dt);
  });
}

export function buildReplayInput(scenario: string, rows: readonly NormalizedRow[], szDecimals = 2, lagSec = 60): ReplayInput {
  if (rows.length < 2) throw new Error("need at least 2 rows");
  const ts = rows.map((r) => Math.floor(r.timestamp / 1000));
  const oracle = rows.map((r) => toRaw(r.oracleProxy, szDecimals));
  const mark = rows.map((r) => toRaw(r.markClose, szDecimals));
  return { scenario, interval: rows[0]!.interval, szDecimals, lagSec, ts, oracle, mark, oracleLag: lagged(oracle, ts, lagSec), markLag: lagged(mark, ts, lagSec) };
}
