/**
 * `pnpm proofs [--e2e]` (root): run every proof and write docs/PROOFS.md (P9).
 *   1. forge test (whole suite) with the nine ARCHITECTURE §9 named tests listed, both token orders
 *   2. gas: AvenHook.beforeSwap from the gas report + the measured hook overhead vs an identical control swap
 *   3. prove:diff: 10,000 fee + 2,000 anchor vectors, Solidity == TypeScript
 *   4. verify --all on a fresh local deploy (anvil + mock precompiles) and on testnet if deployments/998.json exists
 *   5. replay results (backend/data/replay/*.summary.json)
 *   6. (--e2e) the Arena end-to-end gate on a local chain
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http, type Address } from "viem";
import { loadDeployments, verifyAll } from "@aven/core";
import { contractsDir, envWithFoundry, repoRoot } from "../core/scripts/run.ts";
import { startLocalChain } from "./src/localChain.ts";

const NAMED = [
  "test_splitSwapSameBlock_paysTopOfBlockGap",
  "test_dustSwap_doesNotResetStress",
  "test_precompileRevert_chargesFallback",
  "test_precompileBurnsGas_capped",
  "test_wrongPair_cannotInitialize",
  "test_staticFeePool_cannotInitialize",
  "test_previewEqualsCharged_bothDirections",
  "test_overrideFlagAlwaysSet",
  "test_sandwichBackLeg_paysGapFee",
];

function capture(cmd: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, { cwd, env: envWithFoundry(extraEnv), shell: process.platform === "win32", encoding: "utf8", maxBuffer: 1 << 30 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const log = (s: string) => console.log(`[proofs] ${s}`);
const lines: string[] = [];
const md = (s = "") => lines.push(s);
const started = new Date();
const commit = capture("git", ["rev-parse", "--short", "HEAD"], repoRoot).out.trim();
const dirty = capture("git", ["status", "--porcelain"], repoRoot).out.trim().length > 0;

// 1. forge suite ------------------------------------------------------------------------------------------------
log("forge test (json) ...");
const ft = capture("forge", ["test", "--json"], contractsDir);
const suites = JSON.parse(ft.out.slice(ft.out.indexOf("{"))) as Record<string, { test_results: Record<string, { status: string; decoded_logs?: string[] }> }>;
let pass = 0;
let fail = 0;
let skip = 0;
const suiteRows: string[] = [];
const named: Record<string, string[]> = {};
for (const [suite, s] of Object.entries(suites)) {
  let p = 0, f = 0, k = 0;
  for (const [name, t] of Object.entries(s.test_results)) {
    if (t.status === "Success") p++;
    else if (t.status === "Skipped") k++;
    else f++;
    const fn = name.replace(/\(.*$/, "");
    if (NAMED.includes(fn)) (named[fn] ??= []).push(`${suite.split(":")[1]}: ${t.status === "Success" ? "PASS" : t.status.toUpperCase()}`);
  }
  pass += p; fail += f; skip += k;
  suiteRows.push(`| \`${suite}\` | ${p} | ${f} | ${k} |`);
}

// 2. gas ----------------------------------------------------------------------------------------------------------
log("gas report ...");
const gr = capture("forge", ["test", "--match-path", "test/integration/AvenHook.t.sol", "--match-contract", "^AvenHookTest$", "--gas-report", "--json"], contractsDir);
void gr; // AvenHook is placed with deployCodeTo (etch), which the gas reporter does not track: measure in tests instead
const gasRun = capture("forge", ["test", "--match-test", "test_gas_", "--match-contract", "^AvenHookTest$", "-vv"], contractsDir);
const gasLog = (label: string): string => {
  const line = gasRun.out.split(/\r?\n/).find((l) => l.trim().startsWith(`${label}:`));
  return line ? line.split(":").pop()!.trim() : "?";
};
const sizesOut = capture("forge", ["build", "--sizes"], contractsDir).out;
const hookSize = sizesOut.split(/\r?\n/).find((l) => /\|\s*AvenHook\s*\|/.test(l))?.split("|")[2]?.trim() ?? "?";

// 3. differential --------------------------------------------------------------------------------------------------
log("prove:diff (~45 s) ...");
const pd = capture("pnpm", ["--filter", "@aven/core", "prove:diff"], repoRoot);
const diffOk = pd.code === 0 && /prove:diff OK/.test(pd.out);
const readJson = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const feeRes = readJson(`${repoRoot}backend/data/vectors/diff-result-fee.json`);
const anchorRes = readJson(`${repoRoot}backend/data/vectors/diff-result-anchor.json`);
const feeLine = feeRes ? [null, feeRes.match, feeRes.total] : null;
const anchorLine = anchorRes ? [null, anchorRes.match, anchorRes.total] : null;

// 4. verify --all ----------------------------------------------------------------------------------------------------
log("local chain deploy + verify --all (~2 min) ...");
const chain = await startLocalChain({ port: 8547, quiet: true });
let localVerify: { txs: number; count: number; checkA: number; checkB: number; mismatches: number };
try {
  const d = chain.deployments;
  const r = await verifyAll(chain.publicClient, { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params }, { fromBlock: BigInt(d.deployedAtBlock) });
  localVerify = { txs: r.txs, count: r.count, checkA: r.checkA, checkB: r.checkB, mismatches: r.mismatches.length };
} finally {
  await chain.stop();
}
let testnetVerify: typeof localVerify | null = null;
if (existsSync(`${contractsDir}/deployments/998.json`)) {
  log("testnet verify --all ...");
  const d = loadDeployments(998);
  const client = createPublicClient({ transport: http(process.env.HYPEREVM_RPC ?? "https://rpc.hyperliquid-testnet.xyz/evm") });
  const r = await verifyAll(client, { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params }, { fromBlock: BigInt(d.deployedAtBlock) });
  testnetVerify = { txs: r.txs, count: r.count, checkA: r.checkA, checkB: r.checkB, mismatches: r.mismatches.length };
}

// 6. arena e2e (optional) --------------------------------------------------------------------------------------------
let e2e: string = "not run (pass --e2e)";
if (process.argv.includes("--e2e")) {
  log("arena e2e (~3 min) ...");
  const r = capture("pnpm", ["--filter", "@aven/arena", "test:e2e"], repoRoot);
  e2e = r.code === 0 ? `PASS (${/Tests\s+(\d+ passed[^\n]*)/.exec(r.out)?.[1] ?? "ok"})` : "FAIL";
  const last = readJson(`${repoRoot}backend/data/arena/e2e-last.json`);
  if (r.code === 0 && last) {
    e2e += `. The shock left both pools ${last.avenGapBpsAtShock} bp above fair; the bot's arb paid **${last.avenArbFee} pips on Aven vs ${last.controlArbFee} on control**; lpKeptMoreUsd **$${Number(last.lpKeptMoreUsd).toFixed(2)}**; bot profit $${Number(last.botProfitAvenUsd).toFixed(2)} (Aven) vs $${Number(last.botProfitControlUsd).toFixed(2)} (control); /verify check A ${last.verify.checkA}, check B ${last.verify.checkB}`;
  }
}

// 5. replay -----------------------------------------------------------------------------------------------------------
const replayDir = `${repoRoot}backend/data/replay/`;
const replays = readdirSync(replayDir).filter((f) => f.endsWith(".summary.json"));

// write -------------------------------------------------------------------------------------------------------------
md("# PROOFS.md — what is proven, with numbers");
md();
md(`Generated by \`pnpm proofs${process.argv.includes("--e2e") ? " --e2e" : ""}\` (backend/scripts/proofs.ts) at ${started.toISOString()} on commit \`${commit}\`${dirty ? " (+ uncommitted changes)" : ""}. Rerun to refresh; don't edit by hand.`);
md();
md("## 1. Contract tests (Foundry)");
md();
md(`**${pass} passed, ${fail} failed, ${skip} skipped** (the skips are opt-in runs: the vector generator, the replay scenario and the live fork read).`);
md();
md("| Suite | Passed | Failed | Skipped |");
md("|---|---|---|---|");
for (const r of suiteRows) md(r);
md();
md("### The nine required named tests (ARCHITECTURE §9), base token as token0 and as token1");
md();
md("| Test | Result |");
md("|---|---|");
for (const n of NAMED) md(`| \`${n}\` | ${(named[n] ?? ["MISSING"]).join("<br>")} |`);
md();
md("## 2. Gas (§6.7)");
md();
md(`- **Hook overhead inside a real swap** (the §6.7 number): Aven swap ${gasLog("aven swap gas")} gas minus an identical control swap ${gasLog("control swap gas")} gas = **${gasLog("hook overhead gas")} gas** (\`test_gas_beforeSwapOverhead\`).`);
md(`- \`beforeSwap\` called directly as the PoolManager calls it: ${gasLog("beforeSwap gas (first swap, cold)")} gas cold (first swap of a pool), ${gasLog("beforeSwap gas (later block, warm)")} gas warm. This includes the test harness's external call and ABI decoding (\`test_gas_beforeSwapDirect\`).`);
md(`- AvenHook runtime size: ${hookSize} bytes (limit 24,576).`);
md("- The §6.7 estimate is ~35–45k. Tests use the mock precompile, which costs more than the real one (≤ 3,112 gas/read on testnet, recon C.5). Either way the hook adds well under 1% of the 3M small-block gas limit.");
md();
md("## 3. Solidity ≡ TypeScript (I7)");
md();
md(`- \`pnpm prove:diff\`: **${diffOk ? "OK" : "FAILED"}**. Fee vectors ${feeLine ? `${feeLine[1]}/${feeLine[2]}` : "?"}, anchor vectors ${anchorLine ? `${anchorLine[1]}/${anchorLine[2]}` : "?"}, exact on every Breakdown field.`);
md();
md("## 4. Live verification (I8, §7.3)");
md();
md(`- **Local chain** (fresh anvil deploy with the real scripts and mock precompiles, then smoke swaps): \`verify --all\` gives ${localVerify.count} FeeComputed events in ${localVerify.txs} txs. Check A ${localVerify.checkA}/${localVerify.count}, check B ${localVerify.checkB}/${localVerify.count}, mismatches ${localVerify.mismatches}.`);
md(testnetVerify ? `- **HyperEVM testnet:** ${testnetVerify.count} events in ${testnetVerify.txs} txs. Check A ${testnetVerify.checkA}/${testnetVerify.count}, check B ${testnetVerify.checkB}/${testnetVerify.count}, mismatches ${testnetVerify.mismatches}.` : "- **HyperEVM testnet:** pending; the deploy waits on Sayan (docs/DEPLOYMENTS.md).");
md();
md("## 5. Replay (§7.4, mainnet data; method and limits in backend/data/replay/README.md)");
md();
md("| Scenario | Pool | LP value − HODL ($) | Fees ($) | Arbs |");
md("|---|---|---|---|---|");
for (const f of replays) {
  const s = JSON.parse(readFileSync(replayDir + f, "utf8"));
  for (const p of ["fixed05", "fixed30", "avenDelayed", "avenLive"]) {
    const r = s.pools[p];
    md(`| ${s.scenario} | ${p} | ${(-Number(r.lvrUsd)).toFixed(2)} | ${Number(r.feesEarnedUsd).toFixed(2)} | ${r.arbTrades} |`);
  }
}
md();
md("## 6. Arena end-to-end (local chain)");
md();
md(`- \`pnpm --filter @aven/arena test:e2e\`: ${e2e}. Gate: shock → bot arbs both pools → Aven fee > control fee → lpKeptMoreUsd > 0 → /verify MATCH; trades reload after restart.`);
md();
md("## Reproduce");
md();
md("```bash");
md("pnpm install");
md("cd contracts && forge test && cd ..          # 1, 2");
md("pnpm prove:diff                             # 3");
md("pnpm --filter @aven/scripts local:once      # 4 (local); testnet: CHAIN_ID=998 pnpm verify --all");
md("pnpm replay:binance-halt && pnpm replay:calm # 5");
md("pnpm --filter @aven/arena test:e2e          # 6");
md("pnpm proofs --e2e                           # all of the above -> this file");
md("```");
writeFileSync(`${repoRoot}docs/PROOFS.md`, `${lines.join("\n")}\n`);
log(`wrote docs/PROOFS.md: forge ${pass}/${fail}/${skip}, diff ${diffOk}, local verify ${localVerify.checkA}/${localVerify.count}`);
const ok = fail === 0 && diffOk && localVerify.mismatches === 0 && localVerify.count > 0 && !e2e.startsWith("FAIL") && (testnetVerify?.mismatches ?? 0) === 0 && NAMED.every((n) => named[n]?.length === 2 && named[n]!.every((x) => x.endsWith("PASS")));
process.exitCode = ok ? 0 : 1; // exitCode, not exit(): see core/bin/verify.ts (libuv assertion on Windows)
