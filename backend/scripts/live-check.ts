/**
 * `pnpm live:check [runDir]`: proof for a live-mode run (docs/DEPLOYMENTS.md §A). While `pnpm live` is still running:
 *   1. checks A + B for every FeeComputed (same as `pnpm verify --all`): fee == formula(inputs), PoolManager charged it;
 *   2. source check: every oracle/mark the hook used is a pair the relay copied from Hyperliquid's API (relay.jsonl),
 *      in effect at that block; every READ_FAILED fallback happened while the relay had switched reads off.
 * runDir defaults to the newest backend/data/arena/live/<run>/. RPC: LIVE_RPC_PORT (8545) on 127.0.0.1, or HYPEREVM_RPC.
 * Exit code 1 on any mismatch (process.exitCode, see MEMORY.md: Windows/Node 23).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAbiItem, http, type Address } from "viem";
import { avenHookAbi, loadDeployments, verifyAll } from "@aven/core";
import { checkSources, type FeeEvent } from "./src/liveCheck.ts";
import type { RelayLogEntry } from "./src/priceRelay.ts";

const liveRoot = fileURLToPath(new URL("../data/arena/live/", import.meta.url));
const runDir = process.argv[2] ?? (existsSync(liveRoot) ? join(liveRoot, readdirSync(liveRoot).sort().at(-1) ?? "") : "");
if (!runDir || !existsSync(join(runDir, "relay.jsonl"))) {
  console.error(`no live run found (${runDir || liveRoot}); start one with \`pnpm live\``);
  process.exitCode = 1;
} else {
  const d = loadDeployments(31337, runDir);
  const rpc = process.env.HYPEREVM_RPC ?? `http://127.0.0.1:${process.env.LIVE_RPC_PORT ?? 8545}`;
  const client = createPublicClient({ transport: http(rpc), cacheTime: 0 });
  const target = { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params };
  const from = BigInt(d.deployedAtBlock);
  const head = await client.getBlockNumber({ cacheTime: 0 });

  const ab = await verifyAll(client, target, { fromBlock: from, toBlock: head });

  const event = getAbiItem({ abi: avenHookAbi, name: "FeeComputed" });
  const events: FeeEvent[] = [];
  for (let b = from; b <= head; b += 50n) {
    const to = b + 49n < head ? b + 49n : head;
    for (const l of await client.getLogs({ address: target.hook, event, fromBlock: b, toBlock: to })) {
      const a = l.args as { reason: number; oracleRaw: bigint; markRaw: bigint };
      events.push({ block: l.blockNumber!, tx: l.transactionHash!, reason: Number(a.reason), oracleRaw: a.oracleRaw, markRaw: a.markRaw });
    }
  }
  const log = readFileSync(join(runDir, "relay.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as RelayLogEntry);
  const src = checkSources(events, log);

  const okAB = ab.mismatches.length === 0 && ab.count === events.length;
  const okSrc = src.mismatches.length === 0;
  console.log(`[live:check] run ${runDir}`);
  console.log(`[live:check] blocks ${from}..${head}: ${events.length} FeeComputed in ${ab.txs} txs; relay wrote ${log.filter((e) => e.event === "price").length} price pairs`);
  console.log(`[live:check] check A (fee == formula)   ${ab.checkA}/${ab.count}`);
  console.log(`[live:check] check B (fee was charged) ${ab.checkB}/${ab.count}`);
  console.log(`[live:check] source (prices from Hyperliquid API) ${src.fromApi}/${src.checked}, fallbacks while relay stale ${src.fallbackWhileStale}`);
  for (const m of src.mismatches.slice(0, 5)) console.log(`[live:check]   MISMATCH block ${m.event.block} tx ${m.event.tx}: ${m.why}`);
  console.log(`[live:check] ${okAB && okSrc ? "PASS" : "FAIL"}`);
  process.exitCode = okAB && okSrc ? 0 : 1;
}
