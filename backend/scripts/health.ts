/**
 * `pnpm health` (root) / `pnpm --filter @aven/scripts health`: read-only health check of a deployed Aven.
 * Sends no transaction and needs no key. About 30 RPC calls, so the public endpoint is fine.
 *
 *   CHAIN_ID=999 HYPEREVM_RPC=https://rpc.hyperliquid.xyz/evm pnpm health [txHash ...]
 *
 * Checks, against contracts/deployments/<chainId>.json:
 *   1. chain id, hook code, hook address bits 0x2080, hook.poolManager / config / params
 *   2. PoolManager protocolFeeController (0x0 means no protocol share, so verify check B is exact)
 *   3. perpAssetInfo(perpIndex).coin, oracle + mark reads
 *   4. both pools: slot0 (price, LP fee, protocol fee), price vs the oracle, and the hook's previewFee
 *   5. a swap on each pool, each direction, SIMULATED with eth_call through the real router and Uniswap's
 *      PoolManager (the hook runs with the real precompiles); skipped if SIM_FROM holds no tokens
 *   6. pnpm-verify of the given txs (default: the Aven txs recorded in docs/DEPLOYMENTS.md §M.5)
 * Exit code 1 if any hard check fails.
 */
import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import {
  avenHookAbi,
  loadDeployments,
  mockErc20Abi,
  poolManagerAbi,
  poolSwapTestAbi,
  rawToPrice,
  readOracleMark,
  readPerpAssetInfo,
  readSlot0,
  verifyTx,
  type PoolKey,
  type VerifyTarget,
} from "@aven/core";
import {
  encodeV4SwapInput,
  erc20AllowanceSlot,
  permit2AllowanceSlot,
  permit2PackedAllowance,
  poolPriceNumber,
  pushStatus,
  simulatedSwapOut,
  UR_V4_SWAP,
} from "./src/health.ts";

// Uniswap's own v4 periphery on HyperEVM mainnet (ARCHITECTURE.md §2.6; code and poolManager() checked on 999).
const UNISWAP: Record<number, { quoter: Address; permit2: Address; universalRouters: { version: string; address: Address }[] }> = {
  999: {
    quoter: "0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    universalRouters: [
      { version: "2.0", address: "0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa" },
      { version: "2.1.2", address: "0xeD270A1Bcdc63cf1356D695e7f40961d4819d6bF" },
    ],
  },
};
const V4_QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const MAX_WORD = `0x${"f".repeat(64)}` as Hex;
const UNIVERSAL_ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

const REASONS = ["OK", "READ_FAILED", "GAP_TOO_LARGE"] as const;
const MIN_SQRT_PRICE_PLUS_1 = 4295128740n;
const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970341n;
// Aven txs on 999 recorded in docs/DEPLOYMENTS.md §M.5 (2 smoke swaps, the live shock and the bot arb).
const DEFAULT_TXS: Record<number, Hex[]> = {
  999: [
    "0x7b28ee95600b0f2967542ec98b43f52435edab12a9ee6acf43e6c1306f337eed",
    "0x2dd33f423c553cf4abd89af9ea725690039fb1105e883071a6c931bcea57f3a9",
    "0x4f70aa22483255d5140d786afd0945c0d825303d84a2bea1844a6c049e80d4c1",
    "0xfce164020d09a93c06fc212d41e7a24abde051339aa4d9013ed26c86e5ba868f",
  ],
};
// The one-account deployer on 999 (DEPLOYMENTS.md §M.5): it holds demo tokens and has approved both routers.
const DEFAULT_SIM_FROM: Record<number, Address> = { 999: "0x4412A5313aFd9b6f447EcE820Ce55a30A20034Ee" };

const chainId = Number(process.env.CHAIN_ID ?? 999);
const rpc = process.env.HYPEREVM_RPC ?? (chainId === 999 ? "https://rpc.hyperliquid.xyz/evm" : undefined);
if (!rpc) throw new Error(`set HYPEREVM_RPC for chain ${chainId}`);
const d = loadDeployments(chainId);
const client = createPublicClient({ transport: http(rpc, { retryCount: 3, retryDelay: 1500 }), cacheTime: 0 });

let failed = 0;
const line = (ok: boolean | null, what: string, detail = "") => {
  if (ok === false) failed++;
  const tag = ok === null ? "info" : ok ? " ok " : "FAIL";
  console.log(`[${tag}] ${what}${detail ? `: ${detail}` : ""}`);
};

const hook = d.hook as Address;
const pm = d.poolManager as Address;
const keys = { aven: d.pools.aven.key as PoolKey, control: d.pools.control.key as PoolKey };
const ids = { aven: d.pools.aven.id as Hex, control: d.pools.control.id as Hex };
const cfg = d.config;
const decBase = cfg.baseIsToken0 ? cfg.decimals0 : cfg.decimals1;
const decQuote = cfg.baseIsToken0 ? cfg.decimals1 : cfg.decimals0;

console.log(`Aven health check, chain ${chainId}, ${rpc.replace(/\/\/([^/]+)\/.+/, "//$1/…")}`);

// 1. chain + hook
const liveChain = await client.getChainId();
line(liveChain === chainId, "chain id", String(liveChain));
const block = await client.getBlockNumber();
line(null, "head block", block.toString());
const code = await client.getCode({ address: hook });
const codeBytes = code ? (code.length - 2) / 2 : 0;
line(codeBytes > 0, "hook has code", `${codeBytes} bytes`);
line((BigInt(hook) & 0x3fffn) === 0x2080n, "hook address flags 0x2080 (beforeInitialize + beforeSwap)");
const hookPm = (await client.readContract({ address: hook, abi: avenHookAbi, functionName: "poolManager" })) as Address;
line(hookPm.toLowerCase() === pm.toLowerCase(), "hook.poolManager() is the deployment's PoolManager", hookPm);
const liveCfg = (await client.readContract({ address: hook, abi: avenHookAbi, functionName: "config" })) as Record<string, unknown>;
const cfgOk = Object.entries(cfg).every(([k, v]) => String(liveCfg[k]) === String(v));
line(cfgOk, "hook.config() matches the deployment file", JSON.stringify(liveCfg));
const liveParams = (await client.readContract({ address: hook, abi: avenHookAbi, functionName: "params" })) as Record<string, unknown>;
const paramsOk = Object.entries(d.params).every(([k, v]) => String(liveParams[k]) === String(v));
line(paramsOk, "hook.params() matches the deployment file");

// 2. PoolManager
const pfc = (await client.readContract({ address: pm, abi: poolManagerAbi, functionName: "protocolFeeController" })) as Address;
line(BigInt(pfc) === 0n, "PoolManager protocolFeeController is 0x0", pfc);

// 3. HyperCore reads
const info = await readPerpAssetInfo(client, cfg.perpIndex);
line(info.szDecimals === cfg.szDecimals, `perpAssetInfo(${cfg.perpIndex})`, `coin ${info.coin}, szDecimals ${info.szDecimals}`);
const px = await readOracleMark(client, cfg.perpIndex);
const oracle = rawToPrice(px.oracleRaw, cfg.szDecimals);
const mark = rawToPrice(px.markRaw, cfg.szDecimals);
line(px.readOk, "oracle + mark precompile reads", `oracle ${oracle} / mark ${mark}`);

// 4. pools
for (const name of ["aven", "control"] as const) {
  const s = await readSlot0(client, pm, ids[name]);
  const price = poolPriceNumber(s.sqrtPriceX96, cfg);
  const status = pushStatus(price, oracle);
  line(s.sqrtPriceX96 > 0n, `${name} pool initialized`, `price ${price.toFixed(2)}, ${status.label} (${status.bps >= 0 ? "+" : ""}${status.bps.toFixed(1)} bp vs oracle)`);
  if (name === "aven") {
    line(s.lpFee === 0, "aven pool stored LP fee is 0 (dynamic; every swap's fee comes from the hook)", String(s.lpFee));
    const st = (await client.readContract({ address: hook, abi: avenHookAbi, functionName: "poolState", args: [ids.aven] })) as { initialized: boolean };
    line(st.initialized, "hook.poolState(aven).initialized");
    for (const zeroForOne of [true, false]) {
      const b = (await client.readContract({ address: hook, abi: avenHookAbi, functionName: "previewFee", args: [keys.aven, zeroForOne] })) as {
        fee: number; reason: number; gapBps: bigint; premiumBps: bigint; moveBps: bigint;
      };
      const side = zeroForOne === cfg.baseIsToken0 ? "sell base" : "buy base";
      line(REASONS[b.reason] === "OK", `previewFee ${side}`, `${b.fee} pips (${REASONS[b.reason]}, gap ${b.gapBps} bp, premium ${b.premiumBps} bp, move ${b.moveBps} bp)`);
    }
  } else {
    line(s.lpFee === Number(keys.control.fee), "control pool static LP fee", String(s.lpFee));
  }
  line(s.protocolFee === 0, `${name} pool protocol fee is 0`, String(s.protocolFee));
}

// 5. simulated swaps through the real router + PoolManager
const simFrom = (process.env.SIM_FROM as Address | undefined) ?? DEFAULT_SIM_FROM[chainId];
if (!simFrom) {
  line(null, "swap simulation skipped", "set SIM_FROM to an address that holds both demo tokens and approved the router");
} else {
  const base = d.tokens.base as Address;
  const quote = d.tokens.quote as Address;
  const [balB, balQ] = await Promise.all([
    client.readContract({ address: base, abi: mockErc20Abi, functionName: "balanceOf", args: [simFrom] }) as Promise<bigint>,
    client.readContract({ address: quote, abi: mockErc20Abi, functionName: "balanceOf", args: [simFrom] }) as Promise<bigint>,
  ]);
  const sellBase = parseUnits(process.env.SIM_BASE ?? "0.01", decBase);
  const buyQuote = parseUnits(process.env.SIM_QUOTE ?? "20", decQuote);
  if (balB < sellBase || balQ < buyQuote) {
    line(null, "swap simulation skipped", `${simFrom} holds ${formatUnits(balB, decBase)} base / ${formatUnits(balQ, decQuote)} quote`);
  } else {
    for (const [label, baseIn] of [[`sell ${formatUnits(sellBase, decBase)} ${d.tokens.baseSymbol}`, true], [`buy with ${formatUnits(buyQuote, decQuote)} ${d.tokens.quoteSymbol}`, false]] as const) {
      const zeroForOne = baseIn === cfg.baseIsToken0;
      const amountIn = baseIn ? sellBase : buyQuote;
      const outs: Record<string, bigint> = {};
      for (const name of ["aven", "control"] as const) {
        try {
          const { result } = await client.simulateContract({
            account: simFrom,
            address: d.swapRouter as Address,
            abi: poolSwapTestAbi,
            functionName: "swap",
            args: [keys[name], { zeroForOne, amountSpecified: -amountIn, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1 }, { takeClaims: false, settleUsingBurn: false }, "0x"],
          });
          outs[name] = simulatedSwapOut(result as bigint, zeroForOne);
        } catch (e) {
          line(false, `simulated swap on ${name}: ${label}`, (e as Error).message.split("\n")[0]);
        }
      }
      if (outs.aven !== undefined && outs.control !== undefined) {
        const dec = baseIn ? decQuote : decBase;
        const sym = baseIn ? d.tokens.quoteSymbol : d.tokens.baseSymbol;
        line(outs.aven > 0n && outs.control > 0n, `simulated swap through Uniswap v4: ${label}`,
          `aven pool pays ${formatUnits(outs.aven, dec)} ${sym}, control pool ${formatUnits(outs.control, dec)} ${sym}`);
      }
    }
  }
}

// 5b. Uniswap's own periphery: V4Quoter quotes, then Universal Router executes, the same swaps on our pools.
// Uniswap's router pulls tokens through Permit2. The deployer never approved Permit2, so the simulation overrides the
// two allowances (token -> Permit2, Permit2 -> router) for this eth_call only. minOut = the quote must succeed and
// minOut = quote + 1 must revert, which pins the router's output to Uniswap's own quote.
const uni = UNISWAP[chainId];
if (!uni || !simFrom) {
  line(null, "Uniswap router check skipped", uni ? "no SIM_FROM" : `no Uniswap periphery recorded for chain ${chainId}`);
} else {
  const amounts = { sell: parseUnits(process.env.SIM_BASE ?? "0.01", decBase), buy: parseUnits(process.env.SIM_QUOTE ?? "20", decQuote) };
  const maxU160 = (1n << 160n) - 1n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  for (const name of ["aven", "control"] as const) {
    for (const side of ["sell", "buy"] as const) {
      const baseIn = side === "sell";
      const zeroForOne = baseIn === cfg.baseIsToken0;
      const amountIn = amounts[side];
      const tokenIn = (baseIn ? d.tokens.base : d.tokens.quote) as Address;
      const label = `${name} pool, ${baseIn ? `sell ${formatUnits(amountIn, decBase)} ${d.tokens.baseSymbol}` : `buy with ${formatUnits(amountIn, decQuote)} ${d.tokens.quoteSymbol}`}`;
      let quoted: bigint;
      try {
        const { result } = await client.simulateContract({ address: uni.quoter, abi: V4_QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ poolKey: keys[name], zeroForOne, exactAmount: amountIn, hookData: "0x" }] });
        quoted = result[0];
      } catch (e) {
        line(false, `Uniswap V4Quoter: ${label}`, (e as Error).message.split("\n")[0]);
        continue;
      }
      const outDec = baseIn ? decQuote : decBase;
      const outSym = baseIn ? d.tokens.quoteSymbol : d.tokens.baseSymbol;
      line(quoted > 0n, `Uniswap V4Quoter: ${label}`, `${formatUnits(quoted, outDec)} ${outSym}`);
      for (const ur of uni.universalRouters) {
        const stateOverride = [
          { address: tokenIn, stateDiff: [{ slot: erc20AllowanceSlot(simFrom, uni.permit2), value: MAX_WORD }] },
          { address: uni.permit2, stateDiff: [{ slot: permit2AllowanceSlot(simFrom, tokenIn, ur.address), value: permit2PackedAllowance(maxU160, (1n << 48n) - 1n) }] },
        ];
        const run = async (minOut: bigint, withMinHopPrice: boolean) => {
          const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: "execute", args: [UR_V4_SWAP, [encodeV4SwapInput(keys[name], zeroForOne, amountIn, minOut, withMinHopPrice)], deadline] });
          try {
            await client.call({ account: simFrom, to: ur.address, data, stateOverride });
            return true;
          } catch {
            return false;
          }
        };
        let layout: string | null = null;
        for (const withMinHopPrice of [false, true]) {
          if (await run(quoted, withMinHopPrice)) {
            layout = withMinHopPrice ? "with minHopPriceX36" : "without minHopPriceX36";
            const exact = !(await run(quoted + 1n, withMinHopPrice));
            line(exact, `Uniswap Universal Router ${ur.version}: ${label}`, exact ? `delivers exactly the quote (params ${layout})` : "delivered more than its own quote");
            break;
          }
        }
        if (!layout) line(false, `Uniswap Universal Router ${ur.version}: ${label}`, "execute reverted with both param layouts");
      }
    }
  }
}

// 6. verify recorded txs
const target: VerifyTarget = { hook, poolManager: pm, avenPoolId: ids.aven, config: cfg, params: d.params };
const txs = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TXS[chainId] ?? []) as Hex[];
for (const tx of txs) {
  try {
    const r = await verifyTx(client, tx, target);
    const fees = r.results.map((x) => `${x.onchainFee} pips (${x.breakdown.reason})`).join(", ");
    line(r.results.length > 0 && r.match, `verify ${tx.slice(0, 10)}…`, r.results.length ? `${fees}; checks A + B ${r.match ? "MATCH" : "MISMATCH"}` : "no FeeComputed in this tx");
  } catch (e) {
    line(false, `verify ${tx.slice(0, 10)}…`, (e as Error).message.split("\n")[0]);
  }
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exitCode = failed ? 1 : 0;
