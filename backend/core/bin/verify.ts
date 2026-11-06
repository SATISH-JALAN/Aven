/**
 * Verify CLI (ARCHITECTURE §7.3, P9).
 *   pnpm verify <txHash>   every FeeComputed in the tx: inputs, Breakdown, on-chain vs recomputed vs Swap-event fee,
 *                          MATCH/MISMATCH for check A (formula) and check B (PoolManager charged it). Exit 1 on mismatch.
 *   pnpm verify --all      scan FeeComputed logs from deployedAtBlock in <= 50-block chunks; print totals.
 * Exit codes go through process.exitCode: on Windows/Node 23, calling exit while fetch sockets are closing trips a
 * libuv assertion (UV_HANDLE_CLOSING) and turns a pass into a failure.
 * Env: CHAIN_ID (default 998), HYPEREVM_RPC (default: testnet RPC for 998, http://127.0.0.1:8545 for 31337),
 *      DEPLOYMENTS_DIR (default contracts/deployments).
 */
import { createPublicClient, http, type Address, type Hex } from "viem";
import { loadDeployments } from "../src/addresses.ts";
import { verifyAll, verifyTx, type VerifyResult, type VerifyTarget } from "../src/verify.ts";

export function defaultRpc(chainId: number): string {
  if (chainId === 998) return "https://rpc.hyperliquid-testnet.xyz/evm";
  if (chainId === 31337) return "http://127.0.0.1:8545";
  throw new Error(`set HYPEREVM_RPC for chain ${chainId}`);
}

export function targetFor(chainId: number, dir?: string): { target: VerifyTarget; deployedAtBlock: bigint } {
  const d = loadDeployments(chainId, dir);
  return {
    target: { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params },
    deployedAtBlock: BigInt(d.deployedAtBlock),
  };
}

export function formatResult(r: VerifyResult): string {
  const ok = (b: boolean) => (b ? "MATCH" : "MISMATCH");
  const lines = [
    `tx ${r.txHash ?? "?"} log ${r.logIndex ?? "?"}`,
    "  inputs:",
    ...Object.entries(r.inputs).map(([k, v]) => `    ${k.padEnd(16)} ${v}`),
    "  breakdown (recomputed):",
    ...Object.entries(r.breakdown).map(([k, v]) => `    ${k.padEnd(16)} ${v}`),
    `  on-chain fee     ${r.onchainFee}`,
    `  recomputed fee   ${r.recomputedFee}`,
    `  Swap event fee   ${r.swapEventFee ?? "(no matching Swap log)"}`,
    `  check A (fee == formula(inputs))        ${ok(r.checkA)}`,
    `  check B (PoolManager charged that fee)  ${ok(r.checkB)}`,
    `  => ${r.match ? "MATCH" : "MISMATCH"}`,
  ];
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const chainId = Number(process.env.CHAIN_ID ?? 998);
  const rpc = process.env.HYPEREVM_RPC ?? defaultRpc(chainId);
  const client = createPublicClient({ transport: http(rpc, { retryCount: 3 }) });
  const { target, deployedAtBlock } = targetFor(chainId, process.env.DEPLOYMENTS_DIR);

  if (args[0] === "--all") {
    const r = await verifyAll(client, target, { fromBlock: deployedAtBlock });
    console.log(`verify --all on chain ${chainId} from block ${deployedAtBlock}: ${r.txs} txs, ${r.count} FeeComputed events`);
    console.log(`  check A matches: ${r.checkA}/${r.count}`);
    console.log(`  check B matches: ${r.checkB}/${r.count}`);
    for (const m of r.mismatches) console.log(`  MISMATCH ${m.txHash} log ${m.logIndex}: onchain ${m.onchainFee} recomputed ${m.recomputedFee} swap ${m.swapEventFee}`);
    console.log(JSON.stringify({ chainId, txs: r.txs, count: r.count, checkA: r.checkA, checkB: r.checkB, mismatches: r.mismatches.length }));
    process.exitCode = r.mismatches.length === 0 ? 0 : 1;
    return;
  }
  const tx = args[0];
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    console.error("usage: pnpm verify <txHash> | pnpm verify --all");
    process.exitCode = 2;
    return;
  }
  const r = await verifyTx(client, tx as Hex, target);
  if (r.results.length === 0) {
    console.log(`no FeeComputed event from hook ${target.hook} in ${tx}`);
    process.exitCode = 1;
    return;
  }
  for (const x of r.results) console.log(formatResult(x));
  process.exitCode = r.match ? 0 : 1;
}

if (process.argv[1] && /verify\.ts$/.test(process.argv[1])) await main();
