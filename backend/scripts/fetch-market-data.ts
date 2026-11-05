/**
 * `pnpm --filter @aven/scripts fetch-market-data [scenarioId ...] [--include-placeholders]`
 * Fetches HYPE candles + funding for each scenario in scenarios.json from the Hyperliquid MAINNET info API and writes
 *   backend/data/raw/<scenario>/candles.json, funding.json, meta.json, normalized.csv
 * then (re)writes backend/data/raw/README.md. Prints missing intervals (P7). Exit 1 on unexplained gaps.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchScenario, httpPost, toCsv, type Scenario } from "./src/marketData.ts";

const API = process.env.HL_INFO_API_MAINNET ?? "https://api.hyperliquid.xyz/info";
const rawDir = fileURLToPath(new URL("../data/raw/", import.meta.url));
const scenarios = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url), "utf8")) as Scenario[];
const args = process.argv.slice(2);
const includePlaceholders = args.includes("--include-placeholders");
const ids = args.filter((a) => !a.startsWith("--"));
const chosen = scenarios.filter((s) => (ids.length ? ids.includes(s.id) : includePlaceholders || !s.placeholder));
const post = httpPost(API);

const summary: Array<Record<string, unknown>> = [];
let gaps = 0;
for (const s of chosen) {
  const r = await fetchScenario(post, s);
  const dir = `${rawDir}${s.id}/`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}candles.json`, `${JSON.stringify(r.pages, null, 1)}\n`);
  writeFileSync(`${dir}funding.json`, `${JSON.stringify(r.funding, null, 1)}\n`);
  writeFileSync(`${dir}normalized.csv`, toCsv(r.rows));
  const meta = {
    scenario: s,
    source: API,
    endpoints: ["candleSnapshot", "fundingHistory"],
    downloadedAt: new Date().toISOString(),
    interval: r.interval,
    fallbackReason: r.fallbackReason,
    candles: r.candles.length,
    fundingSamples: r.funding.length,
    missing: r.missing.map((t) => new Date(t).toISOString()),
    priceRange: { min: Math.min(...r.rows.map((x) => x.markClose)), max: Math.max(...r.rows.map((x) => x.markClose)) },
  };
  writeFileSync(`${dir}meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
  gaps += r.missing.length;
  summary.push({ id: s.id, interval: r.interval, candles: r.candles.length, funding: r.funding.length, missing: r.missing.length, fallback: r.fallbackReason });
  console.log(`[market-data] ${s.id}: ${r.candles.length} ${r.interval} candles, ${r.funding.length} funding samples, missing ${r.missing.length}${r.fallbackReason ? ` (fallback: ${r.fallbackReason})` : ""}`);
  for (const m of meta.missing) console.log(`[market-data]   missing ${m}`);
}

writeFileSync(
  `${rawDir}README.md`,
  `# backend/data/raw/

Replay inputs, fetched by \`pnpm --filter @aven/scripts fetch-market-data\` (backend/scripts/fetch-market-data.ts).

- **Source:** Hyperliquid MAINNET info API \`${API}\`, endpoints \`candleSnapshot\` (HYPE perp candles) and \`fundingHistory\` (hourly funding + premium).
- **Downloaded:** ${new Date().toISOString()}.
- **Interval:** 1m is tried first. Hyperliquid no longer serves 1m candles for these windows (0 returned), so every scenario fell back to **5m**, as P7 allows. Each \`meta.json\` records the interval and the reason.
- **Files per scenario:** \`candles.json\` (raw pages), \`funding.json\` (raw), \`meta.json\` (window, counts, missing intervals, price range), \`normalized.csv\` (\`timestamp,markClose,premium,oracleProxy,interval\`, DATA.md B5).

## Method and limits (state these on every chart)

- \`markClose\` is the perp candle close, i.e. the last traded price. It stands in for the mark price; the true mark is a median of oracle+EMA, the book and CEX perps (ARCHITECTURE §3.3).
- \`premium\` is the latest hourly funding premium at or before the candle (forward-filled).
- \`oracleProxy = markClose / (1 + premium)\` reconstructs the validator oracle from the premium. **It is an approximation, not the historical oracle** (§13).
- Hourly premium resolution means intra-hour divergence between mark and oracle is not captured.

## Scenarios

| id | interval | candles | funding samples | missing | fallback |
|---|---|---|---|---|---|
${summary.map((x) => `| ${x.id} | ${x.interval} | ${x.candles} | ${x.funding} | ${x.missing} | ${x.fallback ?? "—"} |`).join("\n")}
`,
);
if (gaps > 0) {
  console.error(`[market-data] ${gaps} unexplained missing interval(s)`);
  process.exit(1);
}
