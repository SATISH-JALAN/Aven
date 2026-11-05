/**
 * `pnpm local:up`   start anvil + mock precompiles, deploy everything, verify the smoke swaps, keep running.
 * `pnpm local:once` the same, then stop (exit code 1 unless every Aven smoke swap verifies MATCH on A and B).
 */
import { startLocalChain, verifySmoke } from "./src/localChain.ts";

const once = process.argv.includes("--once");
const chain = await startLocalChain();
const results = await verifySmoke(chain);
for (const r of results) console.log(`[local-chain] verify ${r.tx}: fee ${r.fee} pips -> ${r.match ? "MATCH (A and B)" : "MISMATCH"}`);
const allOk = results.length === 2 && results.every((r) => r.match);
console.log(`[local-chain] ${results.length} Aven smoke swaps verified: ${allOk ? "ALL MATCH" : "FAILED"}`);
console.log(`[local-chain] deployments: contracts/deployments/31337.json  rpc: ${chain.rpcUrl}`);
if (once || !allOk) {
  await chain.stop();
  process.exit(allOk ? 0 : 1);
}
console.log("[local-chain] running; Ctrl+C to stop");
const shutdown = async () => {
  await chain.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
