"use client";
/**
 * Docs content and navigation. Facts come from docs/spec/ARCHITECTURE.md (normative), AGENTS.md §4 (invariants),
 * docs/spec/API.md, docs/PROOFS.md and docs/LOADTEST.md. Keep them in sync when those change.
 */
import type { ReactNode } from "react";
import { VerifyTool } from "@/components/docs/VerifyTool";
import { A, C, Callout, Cards, Code, H2, H3, P, Steps, Table, Ul } from "@/components/docs/Doc";
import { AddressRow } from "@/components/ui";
import { config, DEFAULT_PARAMS, FV_PATH } from "@/config";
import { useArena } from "@/lib/arena";
import { pipsPct } from "@/lib/format";

export interface DocPage {
  slug: string; // "" = /docs
  title: string;
  description: string;
  Body: () => ReactNode;
}
export interface DocGroup {
  title: string;
  pages: DocPage[];
}

// ------------------------------------------------------------------------------------------------ code samples

const SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// forge install SATISH-JALAN/Aven   then remap   aven/=lib/Aven/contracts/
import {BaseHook} from "uniswap-hooks/base/BaseHook.sol";
import {AvenFairValue as FV} from "aven/src/AvenFairValue.sol";

contract MyHook is BaseHook {
    // Permissions must include beforeSwap; the pool must use DYNAMIC_FEE_FLAG.

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata p, bytes calldata)
        internal override returns (bytes4, BeforeSwapDelta, uint24)
    {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());

        // Gas-capped, never reverts: a bad read gives ok = false.
        (bool ok, uint64 oracleRaw, uint64 markRaw) = FV.readPrices(cfg.perpIndex, params.precompileGas);

        FV.Breakdown memory b = FV.compute(cfg, params, FV.Inputs({
            oracleRaw: oracleRaw, markRaw: markRaw, anchorMarkRaw: _anchor,
            sqrtPriceX96: sqrtP, sqrtPriceTopX96: _topOfBlock(sqrtP),
            zeroForOne: p.zeroForOne, readOk: ok
        }));

        // Always set the override flag: a dynamic pool's stored LP fee is 0.
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA,
                b.fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}`;

const VIEM = (hook: string, rpc: string) => `import { createPublicClient, http } from "viem";
import { avenHookAbi } from "@aven/core/abi";

const client = createPublicClient({ transport: http("${rpc}") });

// Exactly what the next swap in this block pays, with every input (I6).
const b = await client.readContract({
  address: "${hook}",
  abi: avenHookAbi,
  functionName: "previewFee",
  args: [poolKey, /* zeroForOne */ true],
});

// Or Uniswap's IDynamicFeeHook: both directions, size-independent.
const [feeZeroForOne, feeOneForZero] = await client.readContract({
  address: "${hook}", abi: avenHookAbi, functionName: "getFee", args: [poolKey],
});`;

const FORMULA = `raw = baseFee
    + (arb          ? gapBps × gapWeight            : 0)
    + (withPressure ? |premiumBps| × premiumWeight  : 0)
    + (moveBps > stressThresholdBps ? (moveBps − stressThresholdBps) × stressWeight : 0)

fee = clamp(raw, minFee, maxFee)      // bad read → fallbackFee`;

// ------------------------------------------------------------------------------------------------ pages

function Intro() {
  return (
    <>
      <P>
        Aven is a Uniswap v4 hook on HyperEVM. Before every swap it reads Hyperliquid&apos;s perp market in the same block, and sets the LP fee from what it sees. When the pool is stale, the trade that
        closes the gap pays for it, and that fee goes to LPs.
      </P>
      <Callout tone="tip" title="In one line">
        Uniswap&apos;s VolatilePairHook learns from the pool&apos;s past. Aven reads the market&apos;s present.
      </Callout>
      <H2>Why it exists</H2>
      <P>
        Prices move on the perp market first. An AMM pool only catches up when an arbitrageur trades it back, and that profit comes out of LPs. A flat fee can&apos;t tell that trade apart from any
        other. Aven can, because HyperEVM contracts read HyperCore prices directly.
      </P>
      <H2>What you can do here</H2>
      <Cards
        items={[
          { href: "/trade", t: "Trade", d: "Live perp chart and book, with the Aven fee before you sign." },
          { href: "/pool", t: "Pool", d: "Who earns: LPs or the arbitrage bot. Add liquidity." },
          { href: "/docs/how-it-works", t: "How it works", d: "One swap, step by step." },
          { href: "/docs/build", t: "Build a hook", d: "Use the fee library in your own hook." },
        ]}
      />
      <H2>Design rules</H2>
      <Ul
        items={[
          "No owner, keeper, relayer, proxy or custody. Nothing to upgrade.",
          "Every input is logged in FeeComputed, so anyone can recompute any fee.",
          "A failed price read never reverts a swap. It charges the fallback fee.",
          "Integer math only, identical in Solidity and TypeScript (10,000 vectors match).",
        ]}
      />
    </>
  );
}

function Quickstart() {
  return (
    <>
      <H2>Use the app</H2>
      <Steps
        items={[
          { t: "Open Trade", b: <>The chart and order book are Hyperliquid&apos;s live ETH perp. The panel on the right shows what the Aven pool would charge you, and why.</> },
          { t: "Connect wallet", b: <>Connect your wallet (via Privy). The app asks you to switch to {config.chainName} if needed.</> },
          { t: "Go long or short", b: <>Long buys aETH, short sells it, on the Aven pool. Demo tokens are open-mint, so the app mints what you need first.</> },
          { t: "Check the fee", b: <>Every trade links to its proof: the inputs the hook logged and the fee recomputed in your browser.</> },
        ]}
      />
      <H2>Run it locally</H2>
      <Code
        lang="bash"
        code={`pnpm install
pnpm --filter @aven/scripts local:up     # anvil + mock precompiles, deploys everything
pnpm --filter @aven/arena start          # the Arena service (bot + API)
pnpm --filter @aven/web dev              # this app, http://localhost:3000`}
      />
      <Callout tone="info">
        The frontend reads <C>NEXT_PUBLIC_CHAIN_ID</C>, <C>NEXT_PUBLIC_RPC</C> and <C>NEXT_PUBLIC_ARENA_API</C> from <C>frontend/.env</C>. Without an Arena it shows the last recorded run, labelled
        as such.
      </Callout>
    </>
  );
}

function HowItWorks() {
  return (
    <>
      <P>One swap, from the router to the LPs. Nothing runs between swaps: no keeper, no oracle push.</P>
      <Steps
        items={[
          { t: "A swap enters the PoolManager", b: "The pool's fee is dynamic, so the hook decides it." },
          { t: "The PoolManager calls beforeSwap", b: <>The hook&apos;s only permissions are <C>beforeInitialize</C> and <C>beforeSwap</C>.</> },
          { t: "The hook reads the pool price", b: "The block's first swap pins the top-of-block price, so splitting one arb into many swaps doesn't make it cheaper." },
          { t: "It reads the perp market, same block", b: <>Two gas-capped precompile calls: oracle at <C>0x…0807</C>, mark at <C>0x…0806</C>. A bad read never reverts.</> },
          { t: "It computes the fee", b: "Gap, premium and stress, in integer math. Every input is emitted in FeeComputed." },
          { t: "The fee goes to LPs", b: <>Returned with the override flag <C>0x400000</C>. The PoolManager charges it like any LP fee.</> },
        ]}
      />
      <H2>Why the same block matters</H2>
      <P>
        HyperEVM and HyperCore share one consensus. The price the hook reads is the price the perp market has in that block, not a feed pushed later. The pool and the market are compared at the same
        moment.
      </P>
      <Table
        head={["", "Static fee", "VolatilePairHook", "Aven"]}
        rows={[
          ["Knows the market price", "No", "No (pool history)", "Yes, in-block"],
          ["Charges the arb more", "No", "Partly", "Yes, by the gap"],
          ["Needs a keeper / feed", "No", "No", "No"],
          ["Admin keys", "—", "—", "None"],
        ]}
      />
    </>
  );
}

function FeeDoc() {
  const p = useArena().math?.params ?? DEFAULT_PARAMS;
  return (
    <>
      <P>Three signals on top of a base fee, then a clamp. Fees are in pips: 1,000,000 = 100%.</P>
      <Code lang="text" title="fee" code={FORMULA} />
      <H2>The signals</H2>
      <H3>Gap</H3>
      <P>
        How far the pool is from the oracle, in basis points. Only the swap that moves the pool <em>toward</em> the oracle pays it: that is the arbitrage. The top-of-block price counts too, so an arb
        split across swaps in one block keeps paying the full gap.
      </P>
      <H3>Premium</H3>
      <P>Mark versus oracle. Trading the way the perp market leans costs a little more.</P>
      <H3>Stress</H3>
      <P>How far the mark moved against a time-weighted anchor. Above the threshold, every swap pays more.</P>
      <H2>Parameters</H2>
      <Table
        head={["Parameter", "Value", "Meaning"]}
        rows={[
          [<C key="a">baseFee</C>, pipsPct(p.baseFee), "Calm-market fee and floor"],
          [<C key="b">maxFee</C>, pipsPct(p.maxFee), "Cap"],
          [<C key="c">fallbackFee</C>, pipsPct(p.fallbackFee), "Charged when a read fails or the gap is implausible"],
          [<C key="d">gapWeight</C>, `${p.gapWeight} pips / bp`, "Weight of the gap term"],
          [<C key="e">premiumWeight</C>, `${p.premiumWeight} pips / bp`, "Weight of the premium term"],
          [<C key="f">stressThresholdBps</C>, `${p.stressThresholdBps} bp`, "Mark move before stress applies"],
          [<C key="g">stressWeight</C>, `${p.stressWeight} pips / bp`, "Weight above the threshold"],
          [<C key="h">maxGapBps</C>, `${p.maxGapBps} bp`, "Above this, use the fallback"],
          [<C key="i">precompileGas</C>, p.precompileGas.toLocaleString("en-US"), "Gas forwarded to each read"],
        ]}
      />
      <H2>Worked example</H2>
      <P>Pool 1.50% above the oracle, mark 0.20% below the oracle, mark moved 0.30% against its anchor.</P>
      <Ul
        items={[
          <>
            <strong className="text-ink">Seller (the arb):</strong> gap 150 bp × 50 = 7,500; selling with a negative premium 20 × 50 = 1,000; stress 30 &lt; 50 → 0. Fee = 500 + 7,500 + 1,000 ={" "}
            <strong className="text-ink">9,000 pips (0.90%)</strong>.
          </>,
          <>
            <strong className="text-ink">Buyer, same state:</strong> not the arb, no pressure. Fee = <strong className="text-ink">500 pips (0.05%)</strong>.
          </>,
        ]}
      />
      <Callout tone="info">
        The exact code is <A href={config.sourceUrl(FV_PATH)}>AvenFairValue.sol</A>. The TypeScript port in <C>@aven/core</C> matches it on 10,000 random vectors.
      </Callout>
    </>
  );
}

function Safety() {
  return (
    <>
      <P>What always holds, and how it is proven.</P>
      <Table
        head={["#", "Invariant", "Proven by"]}
        rows={[
          ["I1", "A swap never reverts because of a precompile read", "unit + invariant (failure injection)"],
          ["I2", "fee ∈ [minFee, maxFee], or fee == fallbackFee with reason ≠ OK", "fuzz + invariant"],
          ["I3", "The override flag is set on every beforeSwap return", "integration"],
          ["I4", "The hook never holds tokens and returns ZERO_DELTA", "invariant (balances 0)"],
          ["I5", "No state-changing external function except beforeInitialize / beforeSwap", "code review + slither"],
          ["I6", "previewFee(key, d).fee == fee charged for the same pre-state", "integration"],
          ["I7", "Solidity compute == TypeScript compute on every vector", "differential (10k vectors)"],
          ["I8", "FeeComputed inputs are enough to recompute the fee exactly", "live verifier"],
          ["I9", "Anchor and top-of-block only change under their rules", "unit + invariant"],
          ["I10", "A pool with other currencies or a static fee can't initialize with the hook", "unit"],
        ]}
      />
      <H2>Trust</H2>
      <Ul
        items={[
          "No owner, setters, proxy, receive or token handling in the hook.",
          "Our PoolManager has owner address(0): nobody can ever turn on a protocol fee.",
          "Prices come from HyperCore consensus. Aven trusts Hyperliquid's oracle and mark, nothing else.",
        ]}
      />
      <Callout tone="warn" title="Limits">
        LPs still carry directional risk; Aven doesn&apos;t hedge. Splitting an arb across blocks lowers its fee somewhat. Parameters are calibrated, not optimised.
      </Callout>
    </>
  );
}

function TradeDoc() {
  return (
    <>
      <P>The Trade page is a spot terminal on top of the perp market Aven reads.</P>
      <Table
        head={["Panel", "Source"]}
        rows={[
          ["Chart, order book, funding, open interest", "Hyperliquid info API, read-only"],
          ["Oracle line", "Hyperliquid oracle (what the hook reads)"],
          ["Pool lines, arb markers, arb feed", "Arena service, live"],
          ["Fee quote", <span key="q">AvenHook <C>previewFee</C>, via the Arena</span>],
        ]}
      />
      <H2>Long and short</H2>
      <P>
        Long buys aETH and short sells it, as a spot swap on the pool you pick. There is no leverage and nothing to liquidate: Aven reads the perp market, it never trades it.
      </P>
      <H2>Why your fee can be lower</H2>
      <P>
        The gap term only applies to the side that closes the gap. If your trade goes the other way, you usually pay the base fee, which is below the plain pool&apos;s 0.30%.
      </P>
      <Callout tone="info">The panel shows which terms fired before you sign, and the receipt links to the full proof.</Callout>
    </>
  );
}

function LiquidityDoc() {
  return (
    <>
      <P>LPs earn the fee on every swap. On the Aven pool, the fee on arbitrage rises with the gap the arb closes, so LPs keep more of it.</P>
      <H2>Who earns what</H2>
      <P>
        Arbitrage always pays somebody. With a flat fee most of it goes to the arbitrageur. With Aven, the same arb still happens (it stays profitable) but a larger share lands with LPs. The Pool page
        shows both numbers side by side.
      </P>
      <H2>Adding liquidity</H2>
      <Steps
        items={[
          { t: "Pick a pool and a range", b: "±5% to ±50% around the current pool price." },
          { t: "Enter the base amount", b: "The quote amount follows from the range." },
          { t: "Confirm", b: "The app mints demo tokens if needed, approves the router, then adds the position." },
        ]}
      />
      <Callout tone="warn">The router is Uniswap&apos;s test router (PoolModifyLiquidityTest). It is for this demo, not for production funds.</Callout>
    </>
  );
}

function VerifyDoc() {
  return (
    <>
      <P>Paste a swap. The app fetches the receipt from the RPC and redoes the math in your browser.</P>
      <Ul
        items={[
          <>
            <strong className="text-ink">Check A:</strong> the logged fee equals <C>compute()</C> on the logged inputs.
          </>,
          <>
            <strong className="text-ink">Check B:</strong> the PoolManager&apos;s own Swap event charged exactly that fee.
          </>,
        ]}
      />
      <div className="mt-8">
        <VerifyTool />
      </div>
      <H2>From the command line</H2>
      <Code lang="bash" code={`pnpm verify <txHash>     # one swap\npnpm verify --all        # every FeeComputed since deployment`} />
    </>
  );
}

function BuildDoc() {
  const d = useArena().deployments;
  return (
    <>
      <P>
        <C>AvenFairValue</C> is a library of internal functions, inlined at compile time. No runtime dependency, nothing to call.
      </P>
      <Code lang="solidity" title="MyHook.sol" code={SOL} />
      <Callout tone="tip">Keep a top-of-block price and a mark anchor per pool, like AvenHook.sol does.</Callout>
      <H2>Quote from TypeScript</H2>
      <P>
        Routers need no changes: the hook implements <C>IDynamicFeeHook.getFee</C>, and V4Quoter simulates the hook.
      </P>
      <Code lang="ts" title="quote.ts" code={VIEM(d?.hook ?? "0xYourAvenHook", config.rpcUrl)} />
      <H2>Gas</H2>
      <Table
        head={["What", "Gas", "Source"]}
        rows={[
          ["Full swap through the test router (p50)", "~175k", "docs/PROOFS.md"],
          ["Hook overhead per swap", "~46.9k", "Aven swap minus control swap"],
          ["One precompile read", "≤ 3.1k", "recon C.5"],
          ["Aven swaps per 3M-gas small block", "~16", "docs/LOADTEST.md"],
        ]}
      />
      <Callout tone="warn" title="Estimate gas with a margin">
        The block&apos;s first swap writes extra state. Use the estimate × 1.3 + 30k.
      </Callout>
    </>
  );
}

function ApiDoc() {
  return (
    <>
      <P>
        The Arena service runs the demo bot and serves pool state. Base URL: <C>NEXT_PUBLIC_ARENA_API</C>. POST routes need the <C>x-admin-token</C> header.
      </P>
      <Table
        head={["Method", "Path", "Returns"]}
        rows={[
          ["GET", <C key="1">/health</C>, "chain, block, bot status, version"],
          ["GET", <C key="2">/config</C>, "hook, PoolManager, pools, fee config and params"],
          ["GET", <C key="3">/state</C>, "block, oracle, mark, both pools with fee previews"],
          ["GET", <C key="4">/stats</C>, "LP fee income and bot profit per pool, LPs kept more"],
          ["GET", <C key="5">/trades?limit=50&pool=aven|control</C>, "trades, newest first"],
          ["GET", <C key="6">/verify/:tx</C>, "checks A and B for one swap"],
          ["GET", <C key="7">/stream</C>, "SSE: state, trade, shock, bot"],
          ["POST", <C key="8">/shock</C>, "push both pools off the market price"],
          ["POST", <C key="9">/bot/start · /bot/stop</C>, "start or stop the arb bot"],
        ]}
      />
      <Callout tone="info">
        HyperEVM&apos;s RPC has no websockets and no mempool API (<C>txpool_*</C> isn&apos;t served), so the app polls blocks and shows your own transactions as pending until they land.
      </Callout>
    </>
  );
}

function ContractsDoc() {
  const d = useArena().deployments;
  return (
    <>
      <P>
        {config.chainName} (chain {config.chainId}). Addresses come from <C>contracts/deployments/{config.chainId}.json</C>.
      </P>
      {d ? (
        <div className="not-prose mt-6 divide-y divide-line rounded-xl border border-line px-4">
          <AddressRow label="AvenHook" value={d.hook} />
          <AddressRow label="PoolManager" value={d.poolManager} />
          <AddressRow label="Aven pool id" value={d.pools.aven.id} kind="id" />
          <AddressRow label="Plain pool id" value={d.pools.control.id} kind="id" />
          <AddressRow label={d.tokens.baseSymbol} value={d.tokens.base} />
          <AddressRow label={d.tokens.quoteSymbol} value={d.tokens.quote} />
          <AddressRow label="Swap router" value={d.swapRouter} />
          <AddressRow label="Liquidity router" value={d.liquidityRouter} />
        </div>
      ) : (
        <Callout tone="warn" title="Pending deploy">
          No deployment is recorded for chain {config.chainId} yet.
        </Callout>
      )}
      <H2>Precompiles read</H2>
      <Table
        head={["Address", "Returns"]}
        rows={[
          [<C key="o">0x…0807</C>, "oracle price (raw, scaled by szDecimals)"],
          [<C key="m">0x…0806</C>, "mark price"],
          [<C key="a">0x…080a</C>, "perp asset info (checked at deploy: coin, szDecimals)"],
        ]}
      />
    </>
  );
}

function Faq() {
  return (
    <>
      <H3>Is this perp trading?</H3>
      <P>No. Aven only reads the perp market. Trades on this site are spot swaps on Uniswap v4 pools.</P>
      <H3>What if Hyperliquid&apos;s price read fails?</H3>
      <P>The swap still goes through at the fallback fee (0.30%), and the event says why.</P>
      <H3>Can anyone change the parameters?</H3>
      <P>No. They are fixed when the pool is created. There is no owner and no setter.</P>
      <H3>Do routers need to integrate anything?</H3>
      <P>No. The fee is a normal v4 dynamic fee; quoters simulate it.</P>
      <H3>Where do the replay numbers come from?</H3>
      <P>
        Hyperliquid mainnet candles for Oct 29, run through a real PoolManager in Foundry. See <A href="/replay">Replay</A>.
      </P>
    </>
  );
}

export const DOCS: DocGroup[] = [
  {
    title: "Getting started",
    pages: [
      { slug: "", title: "Introduction", description: "A Uniswap v4 fee that reads the perp market.", Body: Intro },
      { slug: "quickstart", title: "Quickstart", description: "Trade in a minute, or run everything locally.", Body: Quickstart },
    ],
  },
  {
    title: "Concepts",
    pages: [
      { slug: "how-it-works", title: "How it works", description: "One swap, from the router to the LPs.", Body: HowItWorks },
      { slug: "fee", title: "The fee formula", description: "Gap, premium and stress, then a clamp.", Body: FeeDoc },
      { slug: "safety", title: "Invariants and trust", description: "What always holds, and how it's proven.", Body: Safety },
    ],
  },
  {
    title: "Use Aven",
    pages: [
      { slug: "trade", title: "Trade and swap", description: "What the Trade page shows, and what long and short mean here.", Body: TradeDoc },
      { slug: "liquidity", title: "Provide liquidity", description: "Who earns, and how to add a position.", Body: LiquidityDoc },
      { slug: "verify", title: "Verify a swap", description: "Recompute any fee in your browser.", Body: VerifyDoc },
    ],
  },
  {
    title: "Developers",
    pages: [
      { slug: "build", title: "Build a hook", description: "Use AvenFairValue in your own hook.", Body: BuildDoc },
      { slug: "api", title: "Arena API", description: "REST and SSE for pool state and trades.", Body: ApiDoc },
      { slug: "contracts", title: "Contracts", description: "Addresses and the precompiles the hook reads.", Body: ContractsDoc },
      { slug: "faq", title: "FAQ", description: "Short answers.", Body: Faq },
    ],
  },
];

export const ALL_DOCS = DOCS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.title })));
