/** frontend/public/replay/<scenario>.json (written by backend/scripts/replay-to-web.ts; DATA.md B5). */
export type PoolId = "fixed05" | "fixed30" | "avenDelayed" | "avenLive";

export interface ReplayPoolSeries {
  poolPrice: number[];
  lpValueUsd: number[];
  hodlValueUsd: number[];
  lvrUsd: number[];
  lvrPct: number[];
  feesCumUsd: number[];
  feePips: number[];
}

export interface ReplayResult {
  arbTrades: number;
  feesEarnedUsd: string;
  hodlValueUsd: string;
  lpValueUsd: string;
  lvrPct: string;
  lvrUsd: string;
  retailTrades: number;
}

export interface ReplayFile {
  badge: "Replay";
  scenario: string;
  label: string;
  note?: string;
  source: string;
  generatedAt: string;
  interval: string;
  steps: number;
  points: number;
  method: string;
  limits: string;
  params: Record<string, number>;
  results: Record<PoolId, ReplayResult>;
  series: { timestamps: number[]; oracle: number[]; mark: number[]; pools: Record<PoolId, ReplayPoolSeries> };
}

export interface ScenarioMeta {
  id: string;
  label: string;
  short: string;
  available: boolean;
  /** Key moments to mark on the charts (UTC ms). */
  events: Array<{ at: number; label: string }>;
  why: string;
}

/** Mirrors backend/scripts/scenarios.json. volatile-2 is a placeholder until a window is picked (MEMORY.md). */
export const SCENARIOS: ScenarioMeta[] = [
  {
    id: "binance-halt",
    label: "Oct 29 2026 · Binance halt",
    short: "Oct 29",
    available: true,
    events: [{ at: Date.UTC(2026, 9, 29, 20, 5), label: "20:05 Binance theft begins" }],
    why: "Binance went dark while Hyperliquid kept trading: the stress case.",
  },
  { id: "calm", label: "Oct 25 2026 · calm day", short: "Calm day", available: true, events: [], why: "A quiet market: does Aven cost LPs anything when nothing happens?" },
  { id: "volatile-2", label: "Second volatile window", short: "Volatile 2", available: false, events: [], why: "Another stress window from mainnet. Coming soon." },
];

/** Display order and identity. Colours validated (globals.css); fixed 0.05% is the dashed neutral. */
export const POOLS: Array<{ id: PoolId; label: string; color: string; dashed?: boolean }> = [
  { id: "avenLive", label: "Aven, live price", color: "var(--color-aven)" },
  { id: "avenDelayed", label: "Aven, 60 s delayed", color: "var(--color-delayed)" },
  { id: "fixed30", label: "Fixed 0.30%", color: "var(--color-plain)" },
  { id: "fixed05", label: "Fixed 0.05%", color: "var(--color-neutral)", dashed: true },
];

/** contracts/test/replay/Replay.t.sol RETAIL_SEED ("RETAIL"). */
export const RETAIL_SEED = "0x52455441494c";

export function resultsCsv(f: ReplayFile): string {
  const head = "scenario,pool,lpValueUsd,hodlValueUsd,lpMinusHodlUsd,lvrPct,feesEarnedUsd,arbTrades,retailTrades";
  const rows = POOLS.map(({ id }) => {
    const r = f.results[id];
    return [f.scenario, id, r.lpValueUsd, r.hodlValueUsd, (-Number(r.lvrUsd)).toFixed(4), r.lvrPct, r.feesEarnedUsd, r.arbTrades, r.retailTrades].join(",");
  });
  return [head, ...rows].join("\n") + "\n";
}
