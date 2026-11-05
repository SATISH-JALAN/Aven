/**
 * `pnpm --filter @aven/scripts replay-to-web [scenarioId ...]`: backend/data/replay/<id>.csv + .summary.json ->
 * frontend/public/replay/<id>.json (downsampled series + summary, DATA.md B5) for the Replay page.
 * Every file carries `badge: "Replay"`, the source and the method/limits text so the UI can label every number.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Scenario } from "./src/marketData.ts";

const POOLS = ["fixed05", "fixed30", "avenDelayed", "avenLive"] as const;
const MAX_POINTS = 300;
const replayDir = fileURLToPath(new URL("../data/replay/", import.meta.url));
const webDir = fileURLToPath(new URL("../../frontend/public/replay/", import.meta.url));
const scenarios = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url), "utf8")) as Scenario[];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : scenarios.map((s) => s.id).filter((id) => existsSync(`${replayDir}${id}.summary.json`));

export function downsample<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (max - 1))]!);
  return out;
}

mkdirSync(webDir, { recursive: true });
for (const id of ids) {
  const summary = JSON.parse(readFileSync(`${replayDir}${id}.summary.json`, "utf8"));
  const [header, ...lines] = readFileSync(`${replayDir}${id}.csv`, "utf8").trim().split(/\r?\n/);
  const cols = header!.split(",");
  const rows = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i]!, v])) as Record<string, string>);
  const steps = [...new Set(rows.map((r) => Number(r.step)))].sort((a, b) => a - b);
  const keep = new Set(downsample(steps, MAX_POINTS));
  const at = (pool: string) => rows.filter((r) => r.pool === pool && keep.has(Number(r.step)));
  const base = at("fixed05");
  const series = {
    timestamps: base.map((r) => Number(r.timestamp)),
    oracle: base.map((r) => Number(r.oracle)),
    mark: base.map((r) => Number(r.mark)),
    pools: Object.fromEntries(
      POOLS.map((p) => {
        const rs = at(p);
        return [
          p,
          {
            poolPrice: rs.map((r) => Number(r.poolPrice)),
            lpValueUsd: rs.map((r) => Number(r.lpValueUsd)),
            hodlValueUsd: rs.map((r) => Number(r.hodlValueUsd)),
            lvrUsd: rs.map((r) => Number(r.lvrUsd)),
            lvrPct: rs.map((r) => Number(r.lvrPct)),
            feesCumUsd: rs.map((r) => Number(r.feesCumUsd)),
            feePips: rs.map((r) => Number(r.feePips)),
          },
        ];
      }),
    ),
  };
  const meta = scenarios.find((s) => s.id === id);
  const out = {
    badge: "Replay",
    scenario: id,
    label: meta?.label ?? id,
    note: meta?.note ?? null,
    source: "Hyperliquid mainnet info API (candleSnapshot + fundingHistory), replayed offline in Foundry (contracts/test/replay/Replay.t.sol)",
    generatedAt: new Date().toISOString(),
    interval: summary.interval,
    steps: summary.steps,
    points: series.timestamps.length,
    method: summary.method,
    limits: summary.limits,
    params: summary.params,
    results: summary.pools,
    series,
  };
  writeFileSync(`${webDir}${id}.json`, `${JSON.stringify(out)}\n`);
  console.log(`[replay-to-web] ${id}: ${out.points} points -> frontend/public/replay/${id}.json`);
}
