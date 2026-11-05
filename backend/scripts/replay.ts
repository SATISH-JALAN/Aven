/**
 * `pnpm replay <scenarioId> [--lag 60]` (root: `pnpm replay:<scenario>`): normalized.csv -> input JSON ->
 * Foundry replay (contracts/test/replay/Replay.t.sol) -> backend/data/replay/<id>.csv + <id>.summary.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contractsDir, envWithFoundry, run } from "../core/scripts/run.ts";
import { buildReplayInput, parseNormalizedCsv } from "./src/replayPrep.ts";

const id = process.argv[2];
if (!id) throw new Error("usage: pnpm replay <scenarioId> [--lag 60]");
const lagIdx = process.argv.indexOf("--lag");
const lagSec = lagIdx > 0 ? Number(process.argv[lagIdx + 1]) : 60;
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const outDir = `${dataDir}replay/`;
mkdirSync(outDir, { recursive: true });

const rows = parseNormalizedCsv(readFileSync(`${dataDir}raw/${id}/normalized.csv`, "utf8"));
const input = buildReplayInput(id, rows, 2, lagSec); // HYPE perp: szDecimals 2 (recon C.1)
const inputPath = `${outDir}${id}.input.json`;
writeFileSync(inputPath, `${JSON.stringify(input)}\n`);
console.log(`[replay] ${id}: ${input.ts.length} ${input.interval} steps, lag ${lagSec}s`);
run(
  "forge",
  ["test", "--match-path", "test/replay/Replay.t.sol", "--match-test", "test_replay_scenario", "-vv"],
  contractsDir,
  envWithFoundry({ REPLAY_INPUT: inputPath, REPLAY_CSV: `${outDir}${id}.csv`, REPLAY_SUMMARY: `${outDir}${id}.summary.json` }),
);
const s = JSON.parse(readFileSync(`${outDir}${id}.summary.json`, "utf8"));
console.log(`[replay] ${id} results (LVR = HODL - LP value; negative = LPs beat holding):`);
for (const name of ["fixed05", "fixed30", "avenDelayed", "avenLive"]) {
  const p = s.pools[name];
  console.log(`  ${name.padEnd(12)} LP $${p.lpValueUsd}  HODL $${p.hodlValueUsd}  LVR $${p.lvrUsd} (${p.lvrPct}%)  fees $${p.feesEarnedUsd}  arbs ${p.arbTrades}  retail ${p.retailTrades}`);
}
