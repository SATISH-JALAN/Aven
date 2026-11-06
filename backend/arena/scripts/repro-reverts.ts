/**
 * Diagnostic (found by the PLAN 7.3 load test): some bot swaps were mined and REVERTED. Reproduce with the bot alone
 * (no shocks, no RPC faults) while the oracle flips +-1.1% every 4 s, then replay each reverted bot tx at its parent
 * block to read the revert reason. `pnpm --filter @aven/arena repro:reverts`. Exit code 1 if any bot tx reverted.
 * Root cause found: out of gas on the first swap of a block (hook writes top-of-block + anchor); fixed by withGasMargin.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeErrorResult, type Hex } from "viem";
import { poolManagerAbi, poolSwapTestAbi, mockErc20Abi } from "@aven/core";
import { startLocalChain } from "@aven/scripts/src/localChain.ts";
import { Arena } from "../src/arena.ts";
import { makeChain } from "../src/chain.ts";
import { configSchema } from "../src/config.ts";

const SECONDS = Number(process.env.REPRO_SECONDS ?? 90);
const chain = await startLocalChain({ port: 8560, quiet: true });
const cfg = {
  ...configSchema.parse({
    BOT_PK: chain.keyOf(chain.bot),
    SHOCK_PK: chain.keyOf(chain.shock),
    HYPEREVM_RPC: chain.rpcUrl,
    CHAIN_ID: "31337",
    ARENA_ADMIN_TOKEN: "repro-admin-token",
    MAX_TRADE_BASE: "100",
    MAX_TRADE_QUOTE: "250000",
    POLL_MS: "500",
    DATA_DIR: mkdtempSync(join(tmpdir(), "aven-repro-")),
  }),
  corsOrigins: [],
};
const arena = new Arena(cfg, makeChain({ rpcUrl: chain.rpcUrl, chainId: 31337, botPk: cfg.BOT_PK as Hex, shockPk: cfg.SHOCK_PK as Hex, deployments: chain.deployments }));
const start = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
try {
  await arena.start();
  arena.setBot(true);
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    const o = BigInt(224_002 + (k++ % 2 === 0 ? 2_500 : -2_500));
    await chain.setPrices(o, o);
    await new Promise((r) => setTimeout(r, 4_000));
  }
  arena.stop();
  await new Promise((r) => setTimeout(r, 3_000));
  const end = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
  const bot = chain.bot.address.toLowerCase();
  let sent = 0;
  const reverted: Array<{ hash: Hex; block: bigint; reason: string }> = [];
  for (let b = start + 1n; b <= end; b++) {
    const blk = await chain.publicClient.getBlock({ blockNumber: b, includeTransactions: true });
    for (const tx of blk.transactions) {
      if (typeof tx === "string" || tx.from.toLowerCase() !== bot) continue;
      sent++;
      const r = await chain.publicClient.getTransactionReceipt({ hash: tx.hash });
      if (r.status === "success") continue;
      let reason = "unknown";
      try {
        await chain.publicClient.call({ account: tx.from, to: tx.to!, data: tx.input, blockNumber: b - 1n, gas: tx.gas });
        reason = "succeeds at parent block (state changed earlier in the same block)";
      } catch (e) {
        const data = (e as { cause?: { data?: Hex }; data?: Hex }).cause?.data ?? (e as { data?: Hex }).data;
        try {
          const dec = decodeErrorResult({ abi: [...poolManagerAbi, ...poolSwapTestAbi, ...mockErc20Abi] as never, data: data as Hex });
          reason = `${dec.errorName}(${(dec.args ?? []).map(String).join(", ")})`;
        } catch {
          reason = String((e as Error).message).split("\n").slice(0, 2).join(" ");
        }
      }
      reverted.push({ hash: tx.hash, block: b, reason });
      const before = blk.transactions.filter((x) => typeof x !== "string" && x.transactionIndex! < tx.transactionIndex!) as Array<{ from: string; to: string | null; input: Hex; nonce: number }>;
      const who = (a: string) => (a.toLowerCase() === bot ? "BOT" : a.toLowerCase() === chain.deployer.address.toLowerCase() ? "DEPLOYER" : a.slice(0, 10));
      const tgt = (a: string | null) => (!a ? "create" : a.toLowerCase() === chain.deployments.swapRouter.toLowerCase() ? "swapRouter" : a.toLowerCase().endsWith("0807") ? "oracleMock" : a.toLowerCase().endsWith("0806") ? "markMock" : a.slice(0, 10));
      console.log(`[repro]   reverted bot nonce ${tx.nonce} @ block ${b} idx ${tx.transactionIndex}; earlier in block: ${before.map((x) => `${who(x.from)}->${tgt(x.to)} nonce ${x.nonce}`).join(", ") || "(none)"}`);
    }
  }
  console.log(`[repro] ${SECONDS}s, blocks ${start + 1n}..${end}: bot sent ${sent} txs, ${reverted.length} reverted, arb trades recorded ${arena.trades(10_000).length}`);
  const byReason = new Map<string, number>();
  for (const r of reverted) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`[repro]   ${n} x ${reason}`);
  for (const r of reverted.slice(0, 3)) console.log(`[repro]   e.g. block ${r.block} ${r.hash}`);
  process.exitCode = reverted.length === 0 ? 0 : 1;
} finally {
  arena.stop();
  await chain.stop();
}
