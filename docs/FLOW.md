# FLOW.md — how code flows through Aven

How every part runs: where it **starts** (entry point), what it calls, and where it **ends** (exit point: output, event, file or response). Update this file in the same commit as any change that adds, moves or rewires code (AGENTS.md rule 4).

**Status:** ✅ exists in the repo · 🔜 planned (the build prompt that creates it). Section numbers (§) refer to [spec/ARCHITECTURE.md](spec/ARCHITECTURE.md).

_Last updated: 2026-11-06. Live Arena asset is testnet ETH (perp 4). Tx links go to the chain explorer when one exists (mainnet), else to our own `/verify/<tx>` page._

---

## 0. The big picture

```mermaid
flowchart LR
  subgraph contracts["contracts/ (Solidity, Foundry)"]
    FV["AvenFairValue (library) ✅"]
    HK["AvenHook ✅"]
    SC["script/*.s.sol ✅"]
    DEP["deployments/998.json 🔜P5"]
    REP["test/replay/Replay.t.sol ✅"]
    VEC["test/vectors/GenVectors.t.sol ✅"]
  end
  subgraph chain["HyperEVM (chain 998)"]
    PM["Uniswap v4 PoolManager (ours, canonical build)"]
    PC["HyperCore precompiles 0x806 mark / 0x807 oracle"]
  end
  subgraph backend["backend/ (TypeScript)"]
    CORE["core: fee, state, price, abi, pool, precompiles, addresses, verify ✅"]
    ARENA["arena: poller, bot, shock, API+SSE ✅"]
    SCR["scripts: fetch-market-data, replay, replay-to-web ✅"]
    DATA["data/: raw, replay, vectors, arena"]
  end
  subgraph frontend["frontend/ (Next.js) ✅"]
    WEB["Arena · Replay · Verify · How · Build"]
  end
  SC -->|deploy| PM
  SC --> DEP
  PM -->|beforeSwap| HK --> FV -->|staticcall, gas-capped| PC
  DEP --> CORE & ARENA & WEB
  ARENA -->|txs + eth_call| PM
  ARENA -->|REST + SSE| WEB
  CORE --> ARENA
  VEC --> DATA --> CORE
  SCR --> DATA --> REP --> DATA
  SCR -->|replay json| WEB
```

---

## 1. A swap through the Aven pool (the product, on-chain) ✅

**Entry:** any router calls `PoolManager.unlock()`. In the demo that's v4-core `PoolSwapTest.swap(key, params, testSettings, hookData)`; in production it's the Universal Router. The router's `unlockCallback` then calls `PoolManager.swap(key, SwapParams, hookData)` (`lib/v4-core/src/PoolManager.sol`).

1. `PoolManager.swap` → `Hooks.beforeSwap` (`lib/v4-core/src/libraries/Hooks.sol:263`). The pool's `key.fee == 0x800000` (dynamic), so the fee the hook returns will be used.
2. → `AvenHook.beforeSwap` (OZ `BaseHook`, `onlyPoolManager`) → `AvenHook._beforeSwap` (`contracts/src/AvenHook.sol`, P3).
3. → `_load(poolId)` (pure in-memory, §6.4):
   1. `getSlot0` via `extsload` gives the pool price `sqrtPriceX96`;
   2. top-of-block: if `block.number > topBlock`, store this price as `sqrtPriceTopX96`;
   3. `AvenFairValue.readPrices(perpIndex, precompileGas)` does gas-capped `staticcall`s to **0x807** (oracle) and **0x806** (mark). It never reverts; a bad read gives `readOk = false`;
   4. `AvenFairValue.compute(cfg, params, inputs)` runs §6.3 Steps 2–8: fallback, wad prices, gap with the top-of-block anchor, direction, premium, stress, then combine and clamp;
   5. the time-weighted mark anchor advances, only if `readOk`.
4. Write `PoolState` (2 slots) → emit **`FeeComputed`** (every input, §8.1).
5. Return `(beforeSwap.selector, ZERO_DELTA, fee | OVERRIDE_FEE_FLAG)`. The flag is always set (I3).
6. `Pool.swap` uses the override fee (`lib/v4-core/src/libraries/Pool.sol:303`), and the fee accrues to LPs (`feeGrowthGlobal`, input token).

**Exit:**
- the router settles the `BalanceDelta`;
- the PoolManager emits **`Swap(... fee)`**;
- the hook has emitted **`FeeComputed`**;
- the LPs' fee growth has increased.

**Failure exits, which never revert (I1):**
- a failed, empty or zero read gives `fee = fallbackFee`, `reason = READ_FAILED`;
- `gapBps > maxGapBps` gives `fallbackFee`, `reason = GAP_TOO_LARGE`.

The **control pool** (fee 3000, no hook) takes the same path minus steps 2–5.

## 2. Pool creation ✅ (hook checks; the testnet pool comes in P5)

- **Entry:** `PoolManager.initialize(key, sqrtPriceX96)`.
- **Path:** `Hooks.beforeInitialize` → `AvenHook._beforeInitialize`. It requires `key.fee == DYNAMIC_FEE_FLAG` (else `MustUseDynamicFee`) and `{currency0, currency1} == sorted(base, quote)` (else `WrongCurrencies`), then marks the pool initialized.
- **Exit:** the pool exists, with LP fee 0 (§2.3), or the call reverts (I10).

## 3. Quoting (read-only) ✅

- **Entry:** `AvenHook.getFee(key)` (`IDynamicFeeHook`) or `AvenHook.previewFee(key, zeroForOne)`. Called by routers, the Arena bot (`eth_call`) and the frontend.
- **Path:** `_load(poolId)` only; no storage writes. Unknown pool → `PoolNotInitialized`.
- **Exit:** `(feeZeroForOne, feeOneForZero)` or the full `Breakdown`. It equals what `beforeSwap` would charge in the same state (I6).

## 4. Deployment: scripts ✅, local chain ✅ (`pnpm local:once`), testnet run 🔜 (Sayan, docs/DEPLOYMENTS.md)

- **Entry:** `forge script` in `contracts/script/`. Keys come from `contracts/.env` (`DEPLOYER_PK`); `BOT_ADDRESS`/`SHOCK_ADDRESS` too. Shared plumbing is in `contracts/script/base/AvenScript.sol`; state between scripts goes in `deployments/<chainId>.wip.json`.
- **Path:**
  1. `FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol` → `contracts/out-v4core/` (byte-identical to Uniswap's canonical build, recon A.5);
  2. the deployer is made a HyperCore user and switched to big blocks (recon B.6);
  3. `DeployCore.s.sol`: PoolManager from `out-v4core`, plus PoolSwapTest and PoolModifyLiquidityTest;
  4. switch big blocks off;
  5. `DeployTokens.s.sol`: **aETH** (18 dec) / aUSD (6 dec), minted to the deployer, bot and shock addresses;
  6. `DeployAven.s.sol`: checks `perpAssetInfo(4)` (`coin == "ETH"`, `szDecimals == 4`), mines a salt with HookMiner (flags `0x2080`), deploys through CREATE2 proxy `0x4e59…956C`;
  7. `CreatePools.s.sol`: initial price from `oraclePx`, Aven pool + control pool, identical liquidity;
  8. `Smoke.s.sol`: one swap each direction on both pools.
- **Exit:** **`contracts/deployments/998.json`** (§8.3). It's the single source of addresses for `backend/` and `frontend/`; tx links go into the docs.
- **Mainnet (999), DEPLOYMENTS.md §M:**
  - `DeployCore` **reuses Uniswap's canonical PoolManager** (`POOL_MANAGER`, which defaults to `0x12D4…6B1F` on 999), so steps 1, 2 and 4 are skipped;
  - `PERP_INDEX=1` (ETH);
  - exit: `contracts/deployments/999.json`.
- **Precompile reads in scripts** (`DeployAven` perpAssetInfo, `CreatePools` oracle) go through `AvenScript._precompileCall`. With code at the address (local chain or a fork with mocks) it's a `staticcall`; on a live chain (no code) it's `vm.rpc("eth_call")`, because forge's simulation can't run precompiles.

## 5. Arena service (live demo bot) ✅ `backend/arena`

- **Entry:** `pnpm --filter @aven/arena start` (or `dev`) → `src/main.ts`:
  - `loadDotEnv` (strips trailing ` # comments` from unquoted values) + `loadConfig` (zod: `src/config.ts`);
  - `loadDeployments(CHAIN_ID)`;
  - `makeChain` (`src/chain.ts`: viem with a nonce manager per wallet);
  - `new Arena(...).start()` (`src/arena.ts`: reloads `backend/data/arena/trades.jsonl`, approves the routers for bot and shock, starts the poller);
  - `makeApp` (`src/server.ts`, Hono) served on `ARENA_PORT`.

  Pure maths lives in `src/math.ts`; the API types are `src/types.ts` (= B4).
- **Path:** one process, three loops (§7.2):
  1. **Poller:** every ~500 ms, `eth_blockNumber` (no websockets on HyperEVM, recon B.2).
  2. **Bot loop**, per new block, per pool (control, aven):
     1. read the oracle with an `eth_call` to 0x807, and the pool price from slot0;
     2. skip if |gap| < 1 bp; otherwise pick the direction toward fair;
     3. quote the fee: 3000 for control, `previewFee` for Aven;
     4. compute the target price p* and the `sqrtPriceLimitX96`;
     5. `eth_call` to simulate, then send the swap from the **bot wallet** only if it's profitable at oracle;
     6. read the receipt, decode `FeeComputed`, verify it, then append a `Trade` to `trades.jsonl` and update the stats.
  3. **SSE broadcaster:** pushes `state`, `trade`, `shock` and `bot` events.
- **Admin entry:** `POST /shock` sends one identical swap on both pools from the **shock wallet**. Also `POST /bot/start`, `/bot/stop` and `/reset-stats`. All of these need `x-admin-token`, which is checked **before** the per-client POST limit.
- **Bulk run:** `POST /burst {rounds}` → `Arena.startBurst` (at most 20 rounds, one run at a time) → `runBurst` in the background.
  - Each round: `shock()` with a quarter of the default size, alternating buy/sell, then `botPassAfter(shockBlock)`. That waits for a later block and for any in-flight auto-bot pass, then runs one `botIteration`; the gas cap and the balance floor still apply.
  - Every swap is recorded like any other trade. Progress is in `GET /burst` (public) and the SSE `burst` event. `POST /burst/stop` ends the run after its current round.
  - Dashboard: `frontend/src/components/arena/BulkRun.tsx` (the "Bulk run" block) starts a run with the admin token. It polls `/burst` and shows, per round, the shock block, the oracle, and each arb's fee and blocks after the shock.
  - **Client identity:** the socket address, or with `ARENA_TRUST_PROXY=1` the **last** `X-Forwarded-For` entry.
- **RPC-backed GETs:** `/verify/:tx` is cached per tx and limited per client (`ARENA_VERIFY_LIMIT_PER_MIN`, 429). `/bot/status` balances are cached per block. `/stream` is capped at `ARENA_MAX_SSE_CLIENTS` (503).
- **Config guards for chain 999:** `NATIVE_USD` > 0, `ARENA_ADMIN_TOKEN` ≥ 24 characters and `MAX_GAS_PRICE_GWEI` > 0, or the Arena refuses to start.
- **Gas cap** (`MAX_GAS_PRICE_GWEI`):
  - `botIteration` reads `eth_gasPrice` first and skips the whole iteration above the cap;
  - `shock` checks it before its first swap;
  - `writeWithMargin` sets `maxFeePerGas` = the cap on every tx.
- **State reads:** `GET /state` is single-flight per block. The block is max(poller's last block, newest block from our own shock/bot receipts), so right after a shock it never serves the pre-shock block.
- **Exit:**
  - REST JSON and the SSE stream to the frontend ([spec/API.md](spec/API.md));
  - swaps on chain;
  - `backend/data/arena/trades.jsonl`.

## 6. Verifier ✅ library (`backend/core/src/verify.ts`) + CLI (`backend/core/bin/verify.ts`)

- **Entry:** `pnpm verify <txHash>`, `pnpm verify --all` (`backend/core/bin/verify.ts`), or `GET /verify/:tx` on the Arena service.
- **Path:**
  1. fetch the receipt; decode each `FeeComputed` and its matching PoolManager `Swap` log;
  2. rebuild `Inputs`;
  3. recompute with `backend/core/src/fee.ts`;
  4. check A (recomputed == event fee) and check B (`Swap.fee` == expected).

  `--all` scans logs in ≤ 50-block chunks (recon B.3).
- **Exit:** MATCH or MISMATCH plus every intermediate value. The CLI prints them; the API returns them as JSON.

## 6b. Mainnet health check ✅ `pnpm health` (`backend/scripts/health.ts`, helpers in `src/health.ts`)

- **Entry:** `CHAIN_ID=999 [HYPEREVM_RPC=…] pnpm health [txHash …]`. Read-only: no key, no transaction, ~70 RPC calls (the public RPC is the default on 999).
- **Path:** `loadDeployments(chainId)` →
  1. chain id, hook code, address bits `0x2080`, `hook.poolManager/config/params` vs the deployment file;
  2. `PoolManager.protocolFeeController` = 0x0;
  3. `readPerpAssetInfo`, `readOracleMark`;
  4. per pool `readSlot0` (price, LP fee, protocol fee), price vs oracle (`pushStatus`, 25 bp), `poolState` and `previewFee` both ways on Aven;
  5. `eth_call` of `PoolSwapTest.swap` from the deployer (it holds demo tokens and approved the router), both pools, both directions;
  5b. Uniswap's own periphery on 999: `V4Quoter.quoteExactInputSingle`, then `UniversalRouter.execute(V4_SWAP)` (2.0 and 2.1.2) via `eth_call` with state overrides for the two Permit2 allowances; `minOut = quote` must pass and `quote + 1` must revert;
  6. `verifyTx` on the given txs (default: the four Aven txs in DEPLOYMENTS.md §M.5).
- **Exit:** one `[ ok ]`/`[FAIL]`/`[info]` line per check; exit code 1 if any check fails.

## 7. Differential proof (Solidity ≡ TypeScript) ✅

- **Entry:** `pnpm prove:diff` → `backend/core/scripts/prove-diff.ts`.
- **Path:** `contracts/test/vectors/GenVectors.t.sol` (`GEN_VECTORS=1`, fixed seed, 9 coverage classes, written line by line with `vm.writeLine`) → `backend/data/vectors/fee-vectors.json` + `anchor-vectors.json` → `backend/core/test/differential.test.ts` (vitest) recomputes each vector in TS.
- **Exit:** 10,000/10,000 fee vectors and 2,000/2,000 anchor vectors match, or the test fails (I7).

## 8. Replay (mainnet history, offline) ✅

- **Entry:** `pnpm replay:binance-halt` / `pnpm replay:calm` (root) → `backend/scripts/replay.ts`. The pre-step `src/replayPrep.ts` writes `backend/data/replay/<id>.input.json` (raw prices + the interpolated 60 s lag); then forge runs `test_replay_scenario` with `REPLAY_INPUT`/`REPLAY_CSV`/`REPLAY_SUMMARY`.
- **Path:**
  1. `pnpm --filter @aven/scripts fetch-market-data` (`backend/scripts/fetch-market-data.ts` → `src/marketData.ts`) reads `backend/scripts/scenarios.json`. It calls the Hyperliquid **mainnet** info API (`candleSnapshot`: 1m first, falling back to 5m, which is what's served for these dates; `fundingHistory` for the hourly premium). It writes `backend/data/raw/<scenario>/{candles,funding,meta}.json` + `normalized.csv` and `backend/data/raw/README.md` (source, time, method, limits);
  2. `contracts/test/replay/Replay.t.sol` runs a local PoolManager with 4 pools (fixed 0.05%, fixed 0.30%, Aven-delayed, Aven-live), `MockHyperCorePx` etched at 0x806/0x807, and per step `vm.warp`/`vm.roll`, an arb agent and a seeded retail agent;
  3. it writes `backend/data/replay/<scenario>.csv` + `.summary.json`;
  4. `backend/scripts/replay-to-web.ts` writes `frontend/public/replay/<scenario>.json`.
- **Exit:** CSV and summary files, plus the downsampled JSON that the Replay page loads.

## 9. Frontend ✅ `frontend/` (`@aven/web`)

- **Chain reads (every page):** `src/lib/chain.ts` `publicClient()` → `src/lib/rpc.ts` `balancedTransport(config.rpcUrls)`.
  - `config.rpcUrls` = `NEXT_PUBLIC_RPC` first, then `NEXT_PUBLIC_RPCS` or, on 999, the 7 public endpoints of recon §F.
  - Each call goes to the healthy endpoint with the lowest latency × (1 + in-flight). Skipped: endpoints ≥ 2 blocks behind, endpoints cooling down after a throttle (4 s, doubling up to 60 s) and endpoints over 90 calls/min. Reverts are thrown at once.
  - `eth_blockNumber` is hedged over the two best endpoints (the higher block wins). It's polled every `config.blockPollMs` (1 s) by the one shared `useBlockNumber` store, and the head shown never steps back.
  - Reads made in the same tick go out as one Multicall3 call (`batch.multicall`, 999 only), and each upstream batches JSON-RPC.
  - "RPC down" means every endpoint failed. The nav dot's tooltip shows healthy/total endpoints.
- **Wallet activity on connect:** `src/components/onchain/WalletActivity.tsx` `WalletActivityHost` (mounted once in `layout.tsx`).
  - Opens a drawer with the wallet's `useWalletActivity` scan (Transfer logs → receipts, verified in the browser) when a wallet connects, once per address per browser session.
  - The nav's address chip reopens it; Disconnect resets it.
- **Entry:** a browser opens the app (Vercel or `pnpm --filter @aven/web dev`). Next.js 16 App Router, client pages:
  - `/`: landing (`src/components/landing/*`):
    - a preloader, once per session;
    - `Hero` with the three.js `ParticleField` (the emblem as particles, driven by GSAP);
    - `LiveTicker`: oracle/mark via `@aven/core/precompiles` `readOracleMark` straight from `NEXT_PUBLIC_RPC` (perp from the deployment, else the recon index);
    - then `GapStory`, `Marquee`, `Features` (bento cards), `SwapStory` (fees from `@aven/core/fee` `compute`), `Stats`, `ReplayTeaser` (`public/replay/binance-halt.json`) and `BigRows`;
  - `/trade`: one-screen trading terminal (`src/components/trade/*`):
    - `MarketBar`: Hyperliquid ETH-PERP mark, 24h change, oracle, premium, funding, volume, open interest; plus the Aven pool price, gap and fees, and the plain pool's price and gap (gaps turn amber when `pushState` says pushed);
    - `PriceChart`: TradingView `lightweight-charts` 5.2.1, Hyperliquid candles + volume, an oracle line, and (LIVE) both pool prices and arb markers;
    - `OrderBook`: Hyperliquid `l2Book`, read-only;
    - `OrderPanel`: Buy / Sell aETH, spot on the Aven or plain pool (no leverage), with order types Market, Limit and Stop. The quote is `indicativeOut` × `feeFor`; it sends through `useSwap` (`execute` returns `{ok, hash, error}`).
      - Market orders can attach a take-profit / stop-loss: after the fill, two closing orders (99% of the quoted output) are stored, and one cancels the other.
      - Conditional orders live in `src/lib/orders.ts` (localStorage, per wallet). `triggered()` compares the chosen pool's price with the trigger: sells TP/limit fire at or above, SL/stop at or below; buys mirror that.
      - `useOrderEngine` checks the open orders on every new Arena block and fills the first one that's due through `execute` (the wallet signs), one at a time.
      - `PriceChart` draws each open order as a price line.
      - Orders only run while the tab is open. An order that was mid-signature when the tab closed is marked failed on reload, never re-sent.
    - `Activity`: arb feed, all trades, your trades, shocks, who earned what, and the proof drawer from `arena/Tape.tsx`;
  - `/swap`: a single swap card that routes to either pool and shows both quotes;
  - `/pool`: one tile per pool (Aven and plain) with price, gap, fees and a push status: "Pushed +N bp above/below the oracle" or "At the oracle" (`pushState`, threshold `PUSH_BPS` = 30), the last non-bot swap that pushed it and the bot's last arb back with its fee (`poolActivity`, from `/trades` or the recording); then who earns (LPs vs the arb bot) from live or recorded `/stats`, backed by the mainnet replay; cost per swap; add liquidity (`useAddLiquidity`);
  - `/dashboard`: the live protocol dashboard (`src/app/dashboard/page.tsx`, `src/components/dashboard/{sections,viz}.tsx`, derivations in `src/lib/dashboard.ts`). From the top:
    - `LiveStrip`: block, median block time, how long ago the Arena read the block, SSE/polling, bot state, last trade, oracle;
    - `Headline`: LPs kept more (hero figure, `/stats`), LP income per pool, the share of Aven fees that match §6.3 on their own inputs (`auditFees`), the share verified A + B;
    - one sticky filter row (window 2 / 10 / 30 min / all, on the Arena clock), scoping everything below;
    - `LatencyProof`: `episodes()`. Every block where the oracle or the mark changed (changes within 2 blocks merge) plus every shock is one episode. `BlockLanes` shows it per block (HyperCore input · Aven fee arb side · plain fee · Aven fee retail side · arb landed per pool). `Milestones` shows it in Arena ms: fee repriced, first arb per pool, retail side back to base, last arb. A columns chart compares first-arb latency per episode. Stat tiles: Aven 0 blocks, plain never, a 60 s-delayed oracle 60 s (replay design), 0 extra blocks;
    - `MarketCharts`: prices, gaps and `previewFee` per direction per block (`LineChart`, numbered event lines with a key);
    - `SwapInspector`: pick or follow an Aven swap. It shows before (stream point before its block), the swap (in/out, fee, gap, bot profit) and after; a fee waterfall (`feeParts`: base / gap / premium / stress, cap, plain 0.30% marker); proof chips (§6.3, verify A, B) with "Re-verify now" (Arena `/verify`) and a link to `/verify/<tx>`; the plain-pool twin; and gas from both receipts (`getTransactionReceipt`, cached, 2 calls per selection);
    - `NoExtraFee`: the audit checks, the live quotes split into terms, and a fee-vs-charged-gap `Scatter` with the §6.3 line;
    - `Composition`: two `Donut`s (LP $ by fee term; swaps by regime: live / capped / base only / fallback) and a fee-band histogram;
    - `Throughput`: volume per bucket, running LP income and bot profit, and a token in/out table (`flows`);
    - the live `TradeTape`, and `Controls` in a drawer.

    History: `ArenaProvider` now keeps 1,800 stream points (about 30 min), each with both gaps, both Aven quotes and the hook's `topBlock` (`HistoryPoint`, additive optional fields).

    Two chain-only parts (no Arena needed):
    - `WalletCard` (below the live strip): the connected wallet's swaps and fees, with a link to `/portfolio`;
    - the **On chain** section, `OnchainRecord` (`src/components/onchain/Ledger.tsx`):
      - scan status;
      - stat tiles: swaps per pool, the share verified A + B in the browser, price bumps answered, and the share of perp marks inside Hyperliquid's 1-min candle range (mainnet only);
      - a chart of pool price before / oracle / mark per Aven swap, plus Hyperliquid's 1m close (mainnet; time interpolated between the first and last block timestamps);
      - `LedgerTable` of every swap: block, time, pool, side, in → out, price before → after, oracle, mark, premium, gap before → after, oracle Δ, fee, proof, tx.
  - `/portfolio`: `Portfolio` (`src/components/onchain/Portfolio.tsx`). The address is the connected Privy wallet, or `?address=0x…` / the lookup box for any address. It shows:
    - balances: `useBalances`;
    - tiles: swaps, volume, fees paid vs a flat 0.30%, gas spent, verified;
    - charts: fee per swap vs 0.30% (`Columns`), transactions by kind (`Donut`);
    - an activity list (swap / liquidity / mint / transfer), each swap expandable into prices, oracle and mark, gap, fee terms, the A/B result and a link to the full proof.
  - `src/lib/onchain.ts` (the chain as the database):
    - `Scanner`: newest-first `eth_getLogs` scans in `LOG_CHUNK` blocks (999: 500, 998: 50, local: 5,000), one paced RPC queue, back-off on throttles (recon B.3), and a localStorage cache keyed by chain + hook (+ address). It resets when the chain is behind the cache (a restarted anvil);
    - `useLedger`: our pools' Swap / ModifyLiquidity / FeeComputed, one call per chunk. Each tx is verified by `@aven/core/verify` `verifyLogs` (protocol fee 0);
    - `useWalletActivity`: aETH / aUSD `Transfer` logs from and to the address (2 calls per chunk), then each tx's receipt and block, decoded into a `WalletTx`;
    - `useBlockTimes`: lazy block timestamps.
  - `src/lib/ledger.ts` `ledgerRows` / `ledgerStats` (pure):
    - price before = the swap's own `FeeComputed`, else the previous swap's price after on that pool;
    - a plain swap's oracle and mark come from an Aven swap in the same block (exact) or within 3 blocks (≈);
    - oracle Δ is measured against the previous Aven swap.
  - `src/lib/hl.ts` `fetchCandleRange`: Hyperliquid 1m candles for a time range (one call).
  - `/replay`: four-pool replay with playback, results, share link + QR, and method notes in a collapsible `Details` drawer;
  - `/docs/[[...slug]]`: GitBook-style docs (`src/components/docs/*`): `DocsShell` (sidebar with Ctrl+K search, content column, "On this page" scrollspy), `Doc` primitives (anchored headings, callouts, code with copy, tables, steps, link cards), 12 pages in four groups (`pages.tsx`). `/docs/verify` embeds `VerifyTool` (the old `/verify` page);
  - `/verify/[tx]`: our explorer stand-in and fee proof.
  - Redirects (`next.config.ts`): `/arena` → `/pool`, `/how` → `/docs/how-it-works`, `/build` → `/docs/build`, `/verify` → `/docs/verify`.

  Every inner page opens with `PageHero` (eyebrow, one-line headline, one-line lede) and uses `SectionHead` for sections, both in `src/components/ui.tsx`; long explanations sit in `Details` drawers. Headings use `text-wrap: balance` and body copy `text-wrap: pretty` (`globals.css`).

  Trade and Docs are app routes (`isAppRoute` in `shell.tsx`): native scroll and no marketing footer.

  Shell: `src/app/layout.tsx`. Privy `WalletProvider` (connect-only: `useConnectWallet`, no SIWE sign-in or Privy session) → `ArenaProvider` → `ReadyOutsideLanding`, custom `Cursor`, pill `Nav`, RPC banner, then `#smooth-wrapper` (GSAP ScrollSmoother) holding the page and the `Footer` (CTA, link columns, contracts, a giant wordmark that draws on scroll). The landing `Preloader` fires `aven:ready`; other pages are ready at once; the nav and hero intros wait for it. Config lives in one file: `src/config.ts` (+ `src/config/deployments.json`, synced from `contracts/deployments/` by `pnpm --filter @aven/web sync:deployments`).
- **Path:**
  - `src/lib/arena.tsx` `ArenaProvider`: `/health` → `/config`, `/stats`, `/trades`, `/bot/status`, `/state`, then the `/stream` SSE (`state`, `trade`, `shock`, `bot`). It polls `/state` while the stream reconnects; after a non-200 answer (the Arena's 503 client cap, or a tunnel without SSE) the browser gives up, so it reopens the stream itself with backoff (5 s doubling to 60 s). A 429 shows "too many requests from this browser". If the service is unreachable or unset, it loads `public/arena-fallback.json` (RECORDED). A recording from another chain supplies config/params for math (`math`) but never this chain's addresses (`deployments`).
  - Admin POSTs (`/shock`, `/bot/start|stop`, `/reset-stats`) send `x-admin-token` from `?admin=` or the session. The `?admin=` parameter is removed from the address bar once read (it can spend the bot account's mainnet gas).
  - `src/lib/chain.ts`: one shared `eth_blockNumber` poller (nav "last updated" block, RPC-down banner), paused in hidden tabs. `verifyTxInBrowser` calls `@aven/core/verify` `verifyTx` straight against `NEXT_PUBLIC_RPC`; `verifyKnownInBrowser` verifies the newest ≤ 25 Aven-pool swaps the Arena (or a same-chain recording) knows, one every 3 s (2 calls each). There is no scan since deployment in the browser: with 50-block `eth_getLogs` it grows ~1,700 calls a day on mainnet; use `pnpm verify --all`.
  - `src/lib/steps.ts` `feeSteps`: every §6.3 intermediate value with the core BigInt helpers, cross-checked against `compute()` (`consistent`).
  - Replay reads `public/replay/<scenario>.json`; playback is a GSAP tween over the step index.
  - `src/lib/hl.ts`: Hyperliquid info API from the browser (`candleSnapshot`, `l2Book`, `metaAndAssetCtxs`; CORS open, recon C.7) for the Trade page, budgeted to ~445 weight/min of Hyperliquid's 1,200 per IP (one shared `metaAndAssetCtxs` poll every 5 s, chart candles 10 s, sparkline 60 s, book 2 s; recon C.7). There is no mempool view (recon C.7).
  - `src/lib/pressure.ts` (pure): `pushState(gapBps)` and `poolActivity(pool, trades)` for the push status above.
  - `src/lib/trade-math.ts` (pure): `tokenSide`, `feeFor`, `indicativeOut`, `planLiquidity`, and the exact contract args `swapArgs`, `liquidityArgs`, `liquidityNeeds`, `withGasMargin` (estimate × 1.3 + 30k).
  - `src/lib/swap.ts` `useSwap` (Trade, Swap): from the user's Privy wallet, MockERC20 `mint` → `approve` → `PoolSwapTest.swap` on either pool, capped in the UI at `MAX_UI_TRADE` (5 aETH / 10,000 aUSD) and gated on enough HYPE for gas. `src/lib/liquidity.ts` `useAddLiquidity` (Pool): `mint` → `approve` both tokens → `PoolModifyLiquidityTest.modifyLiquidity`.
- **Exit:** the rendered UI (`/` needs only the RPC; `/trade`, `/swap`, `/pool` need the Arena or the recording for pool data, and Hyperliquid for market data); admin POSTs to the Arena; user swaps and liquidity on chain (Trade, Swap, Pool; LIVE only); CSV download and share link (replay). Every number carries a source label and a "Live mainnet" (999) / "Live testnet" (998) / "Recorded run" / "Replay" badge. The landing stats are read from `arena-fallback.json` and `replay/binance-halt.json`, never typed in. Measured public-RPC load per visible tab: landing 66/min, Trade/Swap/Docs 30, Pool 32 (limit 100/min per IP). Dashboard: the shared block poller plus 2 receipt reads per inspected swap; everything else comes from the Arena stream, plus the on-chain scanner (≤ 24 calls/min, newest-first, then cached).

## 9b. Demo run ✅

- **Entry:** `pnpm demo` (`backend/scripts/demo.ts` → `src/demo.ts` `runDemo`, HTTP only against `ARENA_URL`) or `pnpm --filter @aven/arena demo:local` (`backend/arena/scripts/demo-local.ts`: local chain + in-process Arena on a port).
- **Path:** `/bot/stop` → `/reset-stats` → `/shock` → `/bot/start` → poll `/trades` until both pools have an arb → `/bot/stop` → `/stats`, `/state`, `/verify/:tx`.
- **Exit:** a one-screen summary, plus `frontend/public/arena-fallback.json` (`badge: "Recorded run"`). Its `source` names the chain: "Recorded run on HyperEVM MAINNET (chain 999)…" / testnet 998 / LOCAL 31337.

## 10. Tests and checks

Contract code imports project files root-style (`src/…`, `test/…`, `script/…`), relative to `contracts/`; dependencies go through `contracts/remappings.txt` (`BaseHook` via `uniswap-hooks/`). Don't use `./` or `../` (see MEMORY.md, Gotchas).

| Command (run in) | Entry file | What it proves | Status |
|---|---|---|---|
| `forge test --match-path "test/recon/*"` (`contracts/`) | `contracts/test/recon/Recon.t.sol` | v4 paths and constants, mock-etch plan, gas-cap containment | ✅ 7 pass, 1 skipped |
| `FORK_READ=1 forge test --match-test test_forkRead` (`contracts/`) | same | live testnet `perpAssetInfo` / mark / oracle reads | ✅ passes |
| `FOUNDRY_PROFILE=v4core forge build --sizes lib/v4-core/src/PoolManager.sol` (`contracts/`) | v4-core `PoolManager.sol` | canonical PoolManager, 24,009 B | ✅ |
| `pnpm --filter @aven/scripts local:once` | `backend/scripts/local-chain.ts` → `src/localChain.ts` | full §11.3 deploy on anvil (mock precompiles at 0x806/0x807/0x80a), smoke swaps, live verify A+B | ✅ 2/2 MATCH |
| `forge test --match-path test/unit/AvenFairValue.t.sol` (`contracts/`) | `contracts/test/unit/AvenFairValue.t.sol` | §6.2–§6.4 math, reads, I2 (fuzz, 1,000 runs, fixed seed) | ✅ 34 pass |
| `forge test --match-path test/integration/AvenHook.t.sol` (`contracts/`) | `contracts/test/integration/AvenHook.t.sol` (`AvenHookTest` base = token0, `AvenHookBaseToken1Test` base = token1) | all nine §9 named tests, I1/I3/I4/I6/I8/I9/I10, constructor validation via mined CREATE2, gas overhead | ✅ 20 + 20 pass |
| `forge test --match-path test/replay/Replay.t.sol` (`contracts/`) | `contracts/test/replay/Replay.t.sol` | sanity: flat → 0 trades and LVR 0; flat + retail → collected fees = expected (0.01%), fixed30 ≈ 6× fixed05. The scenario run is skipped unless `REPLAY_INPUT` is set | ✅ 2 pass |
| `forge test --match-path test/invariant/AvenInvariant.t.sol` (`contracts/`) | `contracts/test/invariant/AvenInvariant.t.sol` (`AvenHandler`: swap both directions, exact-in and exact-out / movePrice / setFailure / nextBlock) | I1, I2, I3, I4, I9 over 64 × 64 random calls; non-vacuity test | ✅ 5 invariants + 1 test |
| `LOAD=1 forge test --match-path test/load/OnchainLoad.t.sol -vv` (`contracts/`) | `contracts/test/load/OnchainLoad.t.sol` | PLAN 7.1(a): 2,318 swaps / 250 blocks with broken reads; I1/I2/I3, top-of-block and anchor per block; gas distribution → `backend/data/load/onchain.json` | ✅ |
| `pnpm --filter @aven/arena loadtest` then `loadtest:report` | `backend/arena/scripts/loadtest.ts`, `loadtest-report.ts` | PLAN 7.1(b)–7.3: on-chain burst + verify, autocannon API load + 200 SSE + rate limit, bot under shocks with RPC fault proxy, auto-pause → `backend/data/load/loadtest.json` → `docs/LOADTEST.md` | ✅ |
| `forge snapshot` (`contracts/`) | `contracts/.gas-snapshot` | gas regression baseline (all but invariants) | ✅ |
| `pnpm test` (root) | `backend/core/test/{fee,differential,chain}.test.ts` | TS port mirrors the Solidity unit tests; vectors (skipped if absent); poolId/slot0/precompile decoding/§8.3 schema/verifier checks A and B | ✅ 29 pass |
| `pnpm prove:diff` (root) | `backend/core/scripts/prove-diff.ts` | I7: 10,000 fee + 2,000 anchor vectors, exact | ✅ |
| `pnpm verify <tx>` / `pnpm verify --all` (root; `CHAIN_ID`, `HYPEREVM_RPC`) | `backend/core/bin/verify.ts` | I8 per tx or for every FeeComputed since `deployedAtBlock` (≤ 50-block chunks) | ✅ local 2/2 |
| `pnpm proofs [--e2e]` (root) | `backend/scripts/proofs.ts` | runs every proof and writes `docs/PROOFS.md` | ✅ |
| `pnpm --filter @aven/scripts test` | `backend/scripts/test/{marketData,replayPrep}.test.ts` | premium forward-fill, oracleProxy, gaps, paging, 1m→5m fallback; raw conversion and lag interpolation | ✅ 9 pass |
| `pnpm --filter @aven/arena test` | `backend/arena/test/{math,server,chain,state}.test.ts` | direction, p*, sqrtPriceLimit (both orders), valuation, stats; B4 routes, admin token, CORS, rate limit, SSE; pre-mainnet hardening (auth before limiter, XFF spoofing, verify limit, SSE cap, mainnet config guards); `/state` + `/bot/status` + `/verify` caching | ✅ 36 pass |
| `pnpm --filter @aven/arena test:e2e` | `backend/arena/test/e2e.test.ts` (E2E=1, local anvil chain) | PLAN 4.4 gate: shock → arbs → Aven fee > control → lpKeptMoreUsd > 0 → verify MATCH; persistence reload | ✅ 2 pass (~2.5 min) |
| `pnpm --filter @aven/arena check:frontend` | `backend/arena/scripts/check-frontend.ts` (local anvil chain + Arena on HTTP; imports `frontend/src/lib/trade-math.ts`) | every GET the frontend reads + CORS; `/config` = deployments file; SSE `state`; a wallet swaps on both pools both ways with the UI's args (fee shown = FeeComputed = Swap event fee; output ≤ quote, within 1%); `/verify` MATCH; add liquidity on both pools (pulled ≤ approved, ≥ 95% of plan); shock + bot: bot profits on both pools, Aven LPs keep more | ✅ 30/30 (~2 min) |
| `pnpm --filter @aven/web test` | `frontend/test/{steps,format,landing,trade}.test.ts` | the proof walkthrough equals `compute()` (spec worked example 9,000/500, 2,000 random inputs, the recorded 8,700-pip trade); premium truncation; replay CSV and series shapes; the landing swap story's three claims against `compute()`; indicative quote; liquidity planner for both token orders | ✅ 25 pass |
| `pnpm --filter @aven/web build` | `frontend/` | Next production build (Turbopack bundles `@aven/core`, Privy and three.js), 8 routes | ✅ |

## 11. What exists today ✅

- `contracts/src/AvenFairValue.sol`: the product library. `readPrices` makes gas-capped, non-reverting reads of 0x807/0x806 (assembly, 32-byte buffer); `oracleWad`/`poolWad` do the scaling; `compute` runs §6.3 Steps 2–8; `advanceAnchor` is §6.4; `defaultParams`/`validateParams` are §6.2.
- `contracts/test/mocks/MockHyperCorePx.sol`: etchable precompile mock. Price mode and perpAssetInfo mode; failure modes `setFail`/`setBurn`/`setEmpty`/`setOverflow`.
- `contracts/test/unit/AvenFairValue.t.sol`: 34 unit + fuzz tests (worked example, direction matrix, top-of-block, clamps, fallbacks, scaling, anchor, validation, read failures).
- `contracts/src/AvenHook.sol`: the reference hook (OZ BaseHook). Entry points: `beforeInitialize`/`beforeSwap` (PoolManager only), and the views `getFee`/`previewFee`/`poolState`/`config`/`params`. Internals: `_load` (top-of-block → reads → anchor), `_requireInitialized`, `_config`/`_params` (immutables → structs).
- `contracts/src/interfaces/IAvenHook.sol`: `PoolState`, the `FeeComputed` event, errors, views; it extends `IDynamicFeeHook`.
- `contracts/test/utils/AvenTestBase.sol`: v4 Deployers + mocks at 0x806/0x807 + a hook at a 0x2080 address + Aven/control pools; helpers `swapLogged`, `nextBlock`, `inputsOf`.
- `contracts/test/utils/PriceMath.sol`: `sqrtPriceFromWad` (inverse of `poolWad`; reused by CreatePools in P5).
- `contracts/src/interfaces/IDynamicFeeHook.sol`: Uniswap's quoting interface (verbatim MIT copy).
- `contracts/test/recon/Recon.t.sol`: recon checks (above).
- `contracts/foundry.toml`: `default` profile (our code + tests) and `v4core` profile (deployable PoolManager); RPC aliases `hyperevm_testnet` / `hyperevm_mainnet`.
- `contracts/lib/*`: pinned dependencies (recon A.1).
- `backend/core` (`@aven/core`):
  - `src/fee.ts`: exact BigInt port of AvenFairValue, plus `calculateSwapFee`;
  - `src/state.ts`: top-of-block and anchor rules, `load()` = `AvenHook._load`;
  - `src/price.ts`: `sqrtPriceFromWad`, `sqrtBig`, display helpers;
  - `src/abi.ts`: generated by `pnpm abi` (`scripts/gen-abi.ts`) from `contracts/out`: AvenHook, PoolManager, PoolSwapTest, PoolModifyLiquidityTest, MockERC20, MockHyperCorePx;
  - `src/pool.ts`: `poolId`, `poolStateSlot`, `decodeSlot0`, `readSlot0` (extsload);
  - `src/precompiles.ts`: `readOracleMark` (same readOk rule as Solidity), `readPerpAssetInfo` (one struct);
  - `src/addresses.ts`: zod §8.3 schema, `loadDeployments(chainId)`;
  - `src/verify.ts`: `verifyLogs` (pure), `verifyTx`, `verifyAll` (≤ 50-block chunks);
  - `scripts/prove-diff.ts`, `scripts/run.ts`: forge runner that adds `~/.foundry/bin` to PATH.
- `contracts/test/vectors/GenVectors.t.sol`: the vector generator (runs only with `GEN_VECTORS=1`).
- `backend/scripts` (`@aven/scripts`): `local-chain.ts` (entry: `pnpm local:up` keeps running, `local:once` exits) → `src/localChain.ts` `startLocalChain()`:
  1. anvil chain 31337 with 1 s blocks;
  2. etches `MockHyperCorePx` at 0x806/0x807/0x80a;
  3. runs the 5 forge scripts;
  4. returns `{publicClient, deployer/bot/shock accounts, deployments, setPrices(), setMockMode(), stop()}`;
  5. `verifySmoke()` verifies the smoke swaps.
- `contracts/deployments/README.md`: what lives there (`998.json` committed after the testnet run; `31337.json` and `*.wip.json` are gitignored).
- `frontend/` (`@aven/web`):
  - `src/app/*`: pages (above), `layout.tsx`, `template.tsx` (route fade), `icon.svg`, `globals.css` (tokens + validated chart palette);
  - `src/components/brand.tsx`: the emblem as two parametric SVG lobes (`lobePath(which, h)`, lens = gap) and the stroke wordmark;
  - `src/components/landing/*`: `Preloader`, `ParticleField` (three.js, ~13k points sampled from the lobes; states form / lens / stream), `Hero`, `LiveTicker`, `GapStory`, `SwapStory`, `Sections` (Marquee, Features, Stats, ReplayTeaser, BigRows);
  - `src/components/motion.tsx`: GSAP `Smoother`, `useReveal`, `SplitReveal`, `CountUp`, `Magnetic` (all reduced-motion aware);
  - `src/components/{shell,ui,wallet,LineChart}.tsx`, `src/components/{arena,verify,trade,docs}/*`;
  - `src/lib/{arena.tsx,chain.ts,steps.ts,format.ts,replay.ts,types.ts,gsap.ts,hl.ts,trade-math.ts,swap.ts,liquidity.ts}` (`types.ts` re-exports `backend/arena/src/types.ts`, type-only);
  - imports `@aven/core` only through its browser-safe subpath exports `./fee`, `./abi`, `./pool`, `./price`, `./verify`, `./precompiles`.
