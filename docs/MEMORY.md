# MEMORY.md — project memory

The running record of status, decisions and open items. It saves you from re-reading the whole history. Update it in the same commit as any change (AGENTS.md rule 4). Newest entries go first in each section.

## Status

| Prompt | State | Commit(s) / notes |
|---|---|---|
| **Bulk run on the dashboard (prompt F42, part 5)** | ✅ 2026-11-07.
  - **Arena:** `POST /burst {rounds ≤ 20}` (admin) runs N × (shock both pools with a quarter of the default size, alternating buy/sell; then a bot pass in a later block). `GET /burst` shows progress publicly; `POST /burst/stop` ends a run.
  - **Dashboard:** the "Bulk run" block starts runs and shows each round's shock block, oracle, the Aven arb fee and the plain arb fee, with blocks after the shock.
  - **Local chain:** 4 rounds via the API, then 6 rounds from the dashboard button. Aven arbs paid 1,250–2,500 pips (avg 1,683), each 2 blocks after its shock, all verified A+B. The plain pool's flat 3,000 pips didn't pay after round 1.
  - **Cost on mainnet:** ~4 swaps per round, ≈ 0.00008 HYPE per round at 0.1 gwei.
  - **Tests:** Arena 45/45 (3 new route tests), frontend 53/53. | `backend/arena/src/arena.ts`, `frontend/src/components/arena/BulkRun.tsx` |
| **RPC load balancer + wallet activity (prompt F42, parts 1–3)** | ✅ 2026-11-07.
  - **Balancer:** the browser spreads reads over 7 public mainnet RPCs (recon §F), with failover, a 90 calls/min budget per endpoint, a hedged 1 s head poll and Multicall3.
  - **Measured:** ~277 calls/min with 0 errors; a new block seen every 1.01 s median.
  - **Verify:** the page that failed with "Request exceeds defined limit" now shows 9,950 = 9,950 = 9,950. Scanner and verify pacing were tightened.
  - **Wallet activity:** a drawer with the wallet's on-chain activity opens on connect. Not yet clicked through with a real wallet.
  - **Replay** checked on the Vercel site: Binance-halt plays, and the final table matches (+$141.25 / +$114.47).
  - **Tests:** frontend 53/53 (9 new for the balancer, 2 mutations caught), tsc clean. | `frontend/src/lib/{rpc,chain,onchain}.ts`, `frontend/src/components/onchain/WalletActivity.tsx` |
| **Hosting (prompts F37–F38)** | ✅ 2026-11-07. **Frontend https://aven-lovat.vercel.app** (Vercel project `aven`, builds from GitHub `main`) in LIVE mode against the **Arena at https://aven-arena.onrender.com** (Render free, chain 999). Dashboard checked in Chrome: SSE stream, block-level live data. Open: keep-alive pinger, bot is off (`botEnabled: false`), `/verify` per-client limit doesn't trigger on Render (DEPLOYMENTS.md §M.6). | no code change |
| **On-chain record + wallet portfolio** | ✅ 2026-11-06 ~23:40 UTC (prompt F34). Chain-only: no DB, no Arena needed. The dashboard's "On chain" section shows every swap on both pools with the oracle and mark the hook read in that block, verified A+B in the browser, compared with Hyperliquid's 1m candles on mainnet. `/portfolio` shows any address's swaps, liquidity and mints from Transfer logs → receipts.
  - Local check (headless Chrome): a test wallet (anvil #3) did 2 mints, approvals, an Aven sell (0.14%), a plain sell (0.30%), a liquidity add and an Aven buy (0.05%). The portfolio showed all 6 txs with amounts, both Aven swaps MATCH, 0 console errors. The ledger table showed the plain pool sitting 30 bp above the oracle because its 0.30% fee stops the arb.
  - Mainnet: the decoder passes on the real logs of arb `0xfce1…` (9,950 pips, A+B). A full browser scan is **throttled by the public RPC** (recon B.3), so the first visit fills newest-first over minutes, then it's cached.
  - Frontend 39/39, tsc clean. | `frontend/src/{lib/onchain.ts,lib/ledger.ts,components/onchain/,app/portfolio/}` |
| **Live dashboard `/dashboard`** | ✅ 2026-11-06 ~22:20 UTC (prompt F33).
  - Latency lanes per block, milestones, market charts, swap inspector, no-extra-fee checks plus scatter, two donuts, histogram, throughput and live feed; derivations in `src/lib/dashboard.ts` (10 tests; frontend 35/35, tsc clean).
  - Checked live on the local chain with headless Chrome: the HyperCore input changed in block B, and the Aven quote changed in B (0 blocks, also when the mark moved a block before the oracle). First arb: plain 1–2 blocks, Aven 2–3 (bot order).
  - Scatter: every gap-only Aven swap sits on the §6.3 line. Fees matching §6.3 100%; verify A+B 100% (188/188). Hook +47,592 gas, 0 extra blocks. | `frontend/src/{app/dashboard,components/dashboard,lib/dashboard.ts}` |
| **Full-stack local run + price-bump test** | ✅ 2026-11-06 ~21:25 UTC (prompt F32), frontend laptop.
  - Backend tests 78 pass; `prove:diff` OK; forge 89/1/5 (the known salt-mining OutOfGas, see Gotchas).
  - `local:up` deploy plus smoke MATCH, then the Arena on 31337. Oracle +150 bp, +200 bp, a shock, then −200 bp: Aven LPs kept **$675** more; bot profit $477 vs $1,289; 69/69 Aven trades verify A+B. The fee reprices in the same block; the bot mines control at +1 block and Aven at +2 (sequential).
  - Website (headless CDP): the `/pool` shock button → both swaps mined 0.46 s after the click; `/verify/<tx>` shows 2,900 = 2,900 = 2,900.
  - **Bug:** the `/pool` "Two pools" tiles stay hidden (reveal tween reverted).
  - Mainnet read-only: `pnpm verify 0xfce1…` MATCH (9,950). | scratchpad only; nothing in the repo changed except docs |
| P0 bootstrap | ✅ done | `5934448`, aligned in `f94f3b5` |
| P1 recon | ✅ done; gate passed (precompile = info API after scaling) | `2a56c3b`; details in [recon.md](recon.md) |
| Repo restructure | ✅ done 2026-11-06 | backend/, contracts/, frontend/; AGENTS.md, MEMORY.md, FLOW.md |
| Backend build loop | ✅ finished 2026-11-06 | see [PLAN.md](PLAN.md) |
| P2 AvenFairValue | ✅ done 2026-11-06 (PLAN 1.1): 34 unit + fuzz tests (1,000 runs each) | `contracts/src/AvenFairValue.sol` |
| P3 mocks + AvenHook | ✅ done 2026-11-06 (PLAN 1.2–1.4): 20 integration tests × 2 token orders, incl. all nine §9 named tests; 3 mutation checks caught | `contracts/src/AvenHook.sol` (9,337 B runtime) |
| P4a TS port + differential | ✅ done 2026-11-06 (PLAN 2.1–2.3): **10,000/10,000 fee + 2,000/2,000 anchor vectors match exactly**; 2 mutation checks caught | `pnpm prove:diff` (~45 s) |
| P4b ABIs, precompiles, addresses, verify | ✅ done 2026-11-06 (PLAN 2.4–2.5): 29 core tests; poolId/slot checked against `cast`, perpAssetInfo against real testnet bytes | live check on the local chain in PLAN 3.2 |
| P5a deploy scripts | ✅ written 2026-11-06 (PLAN 3.1); initial price within 1 bp (fuzz) | end-to-end proof on the local chain in 3.2 |
| P5b local chain | ✅ done 2026-11-06 (PLAN 3.2): `pnpm local:once` deploys all 5 scripts on anvil with mock precompiles. Smoke swaps verify **MATCH on A and B**; ~2 min | `backend/scripts/src/localChain.ts` |
| P5c testnet runbook | ✅ written 2026-11-06 (`docs/DEPLOYMENTS.md`). **Testnet run BLOCKED on Sayan**: funded deployer + HyperCore user | — |
| P6 Arena service | ✅ done 2026-11-06 (PLAN 4.1–4.4): 22 unit/API tests (auth and rate-limit mutations caught). **E2E gate passes on the local chain**: shock → bot arbs both pools → Aven fee > control fee → `lpKeptMoreUsd > 0` → `/verify` MATCH; trades reload after restart (156 s) | `backend/arena` |
| P7 market data | ✅ done 2026-11-06 (PLAN 5.1): binance-halt and calm each have 72 × 5m HYPE candles + 8 funding samples, 0 gaps. Oct 29 18:00–24:00 HYPE range 88.96–95.24. volatile-2 is a placeholder (Sayan to pick) | `backend/data/raw/` |
| P8 replay engine | ✅ done 2026-11-06 (PLAN 5.2–5.3). **Oct 29: avenLive +$141 vs HODL, avenDelayed +$114, fixed30 +$7, fixed05 −$318. Calm: Aven ≈ fixed30 (+$323 vs +$317), live ≈ delayed.** Spec defaults, no tuning. Hand-checked steps 1–2; sanity tests (flat → LVR 0; collected fees = expected within 0.01%) | `backend/data/replay/README.md` |
| P9 verify CLI + proofs | ✅ done 2026-11-06 (PLAN 6.1): `pnpm verify <tx>` / `--all`; `pnpm proofs --e2e` writes docs/PROOFS.md. Forge 88/0/4; diff 10k/10k + 2k/2k; local verify 2/2. Hook overhead 46,877 gas. **Arena e2e: Aven arb fee 8,700 vs 3,000; LPs kept $64.33 more** | docs/PROOFS.md |
| P11 invariants + security | ✅ done 2026-11-06 (PLAN 6.2–6.3): I1/I2/I3/I4/I9 hold over 64 runs × 64 calls (0 reverts); 3 mutations each caught by the matching invariant; `.gas-snapshot` baseline; docs/SECURITY.md maps every §10 threat to a test or limit. Forge **90 passed / 0 failed / 4 skipped** | `contracts/test/invariant/AvenInvariant.t.sol` |
| P13 demo | ✅ done 2026-11-06 (PLAN 6.4): `pnpm demo` (any Arena) and `pnpm --filter @aven/arena demo:local` (local chain, in-process Arena over HTTP). The local run gave Aven arb fee 8,700 vs 3,000 and LPs kept $64.33 more; verify MATCH. `frontend/public/arena-fallback.json` holds the LOCAL recording; re-record on testnet. docs/DEMO.md has the script and video list | — |
| Phase 7 load testing | ✅ done 2026-11-06 (PLAN 7.1–7.4).
  - Foundry: 2,318 swaps / 250 blocks with broken reads, 0 reverts or violations; ~16 Aven swaps fit a 3M small block.
  - Burst: 280/280 swaps verified.
  - API: ≤ 71 ms p99 at ~1.6–2.7k req/s, 0 errors; 200 SSE clients, no leak; rate limit exact.
  - Stress: 348/348 verified, 0 nonce errors; bot 64 iterations over 75 blocks under API load.
  - **4 bugs found and fixed** (viem block-number cache, 4 s receipt polling, /state thundering herd, out of gas on the first swap of a block), each with a regression test. | docs/LOADTEST.md |
| **Production check (2026-11-07, Om)** | ✅ All green, nothing sent on chain.
  - Builds and tests: typecheck in all 4 packages; forge 90/0/5; TS tests; web build (8 routes); Arena e2e 2/2; `check:frontend` 30/30 (`CHECK_PORT=18797` on this Windows machine, see Gotchas).
  - **`pnpm health` on 999 passes**: hook code, bits, config and params match `999.json`; Uniswap's PoolManager with protocol fee controller 0x0; real oracle/mark reads; both pools initialized; Aven LP fee 0 (dynamic); the 4 recorded Aven txs verify MATCH A + B.
  - **Uniswap's own routers reach the Aven pool:** V4Quoter quotes both pools, and Universal Router 2.0 and 2.1.2 (`execute(V4_SWAP)`, simulated with Permit2 allowance overrides) deliver exactly the quote on both pools, both directions.
  - **Frontend:** push status per pool (Pool page tiles; plain pool gap on the Trade bar); default chain is now 999 + the public mainnet RPC (was 998 testnet); `src/config/deployments.json` holds 999 (was `{}`). | `backend/scripts/health.ts`, `frontend/src/lib/pressure.ts` |
| **Mainnet recording** | ✅ 2026-11-07: `frontend/public/arena-fallback.json` now holds a HyperEVM **mainnet** run, labelled with the chain.
  - Shock 194 bp → Aven 10,000 pips (ceiling) vs 3,000; LPs kept $124.91 more; verify MATCH.
  - `docs/DEMO.md` has the mainnet numbers and a one-take video plan. | `backend/scripts/demo.ts` labels the chain |
| **First live Arena test on mainnet** | ✅ 2026-11-07 (DEPLOYMENTS.md §M.5).
  - Shock 188 bp → bot arb on Aven paid **9,950 pips** vs 3,000 on control. **LPs kept $97.25 more** (demo-token $ at the oracle).
  - Aven arb verify MATCH A+B on real HyperCore oracle/mark.
  - All txs carried the 2-gwei cap and paid ~0.1 gwei; 0.000083 HYPE spent. | Alchemy RPC, `backend/.env` |
| **🚀 Deployed on HyperEVM mainnet (999)** | ✅ 2026-11-06, block 50,557,638 (DEPLOYMENTS.md §M.5).
  - Hook `0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080` on Uniswap's PoolManager `0x12D4…6B1F`.
  - Aven pool `0x659c…d1df`, control pool `0x4bf2…81b6`.
  - 23 txs, all succeeded, 0.001044 HYPE (~$0.08).
  - Live hook bytecode = the audited build. Smoke swaps read the REAL HyperCore oracle/mark and verify MATCH A+B (fees 700 / 500 pips).
  - Account `0x4412…34Ee` has 0.0165 HYPE left. | `contracts/deployments/999.json` |
| **Pre-mainnet audit + mainnet fork rehearsal** | ✅ done 2026-11-06 (SECURITY.md §6, recon §E, DEPLOYMENTS.md §M); **not deployed yet**.
  - Fork of 999: all 5 scripts on Uniswap's canonical PoolManager, smoke A+B MATCH. Full app: 8,800 vs 3,000 pips, LPs kept $64.05 more, `verify --all` 4/4.
  - Deep tests: fuzz 10× (90/0); invariants × 4 seeds (16,384 calls, 0 reverts); on-chain load; diff 10k+2k; Arena e2e; load test on the hardened code (p99 ≤ 63 ms, 0 errors, 0 nonce errors).
  - **Found and fixed:** the deploy scripts read precompiles directly, which gets 0 bytes in forge's simulation on a live chain, so `DeployAven` would have failed on mainnet → `vm.rpc` path. Backend B-1…B-5 (rate-limit spoofing, RPC-amplifying GETs, SSE cap, `NATIVE_USD` guard, admin token length); 8 mutations caught.
  - **Budget (corrected on re-check):** the base fee is volatile (0.10–10.8 gwei over 3 h), so every tx is capped at 2 gwei: forge `--with-gas-price`, Arena `MAX_GAS_PRICE_GWEI`. The deploy + 200 bot swaps + 10 shocks cost $0.43 calm / $1.29 median / **max $7.07 at the cap**. Fund 0.03 / 0.10 / 0.02 HYPE; buy ~$20. | `contracts/script/base/AvenScript.sol`, `backend/arena/src/{server,config,arena,chain}.ts` |
| **Backend plan** | ✅ every step done or BLOCKED on Sayan (testnet deploy) | docs/PLAN.md |
| Frontend wiring Phase A (mainnet, frontend only) | ✅ 2026-11-07. No backend change, no tx sent.
  - Points at mainnet 999 (`deployments.json` synced; `.env.example` and code defaults are 999 + the public RPC); badge "Live mainnet".
  - The landing stats are read from the recording and the replay file (were hard-coded 8,700 / 141.25).
  - Verify: the newest ≤ 25 known swaps, paced (no scan since deployment).
  - Stream reopens with backoff after a 503; a clear 429 message; `?admin=` is removed from the URL.
  - UI trade cap (5 aETH / 10,000 aUSD), HYPE-for-gas checks (incl. add liquidity) and a mainnet gas note.
  - Polling within limits: Hyperliquid ~1,610 → ~445 weight/min; Pool RPC 61 → 32/min; hidden tabs don't poll.
  - Tests: web 25, build OK; checked in headless Chrome (landing +$141 / 10,000 from the files). | `frontend/src/` |
| P10 frontend: Trade / Swap / Pool / Docs | ✅ 2026-11-06/07 (prompts F22–F25; the session froze and was resumed). Nav is now Trade · Swap · Pool · Replay · Docs.
  - **Trade:** ClickOptions-style one-screen terminal with a TradingView chart and live Hyperliquid book and stats; Long/Short = spot buy/sell aETH on either pool.
  - **Swap:** card routing to either pool.
  - **Pool:** who earns, plus add liquidity.
  - **Docs:** GitBook-style, 12 pages.
  - Arena/How/Build/Verify are folded in, with redirects.
  - Tests: web 25 and build OK (8 routes); all four pages render in headless Chrome with no console errors.
  - **`pnpm --filter @aven/arena check:frontend` 30/30 on the local chain:** the UI's own swap/liquidity args; fee shown = fee charged on all four swaps; quote within 0.05%; liquidity 99.5% of plan; Aven LPs $156 vs plain $96 after one shock.
  - Not yet run against testnet (no deployment). | `frontend/src/components/{trade,docs}/`, `frontend/src/lib/{hl,trade-math,swap,liquidity}.ts` |
| P10 frontend polish | ✅ 2026-11-06, second pass (prompt F18: Uniswap / Unichain references, "clean and professional", crisp captions, breathing space). Every page: shorter copy, shared `PageHero`/`SectionHead`, long notes in `Details` drawers, balanced headings (no one-word widows), one left edge on every page. Fixes from screenshots: hero ticker no longer overlaps the CTAs, gap-story legend matches the solid pool line, recorded-run banner is one line, the pending replay scenario shows "Soon", share card compact, empty-target GSAP warnings gone. 15 tests; build OK (8 routes); checked with headless Chrome over CDP (the Chrome extension wasn't connected) | `frontend/src/` |
| P10 frontend redesign | ✅ 2026-11-06 (requested: "product level", less text). New landing `/`: preloader, three.js particle emblem, live ticker, pinned gap story, morphing swap card, stats, replay teaser, big rows. Arena moved to `/arena`; new pill nav, cursor and footer. 15 tests; build OK (8 routes); checked in Chrome. three 0.186.1 added | `frontend/src/components/landing/` |
| P10 frontend | ✅ built 2026-11-06 (`@aven/web`, Next 16.4.2 + React 19.3.1 + GSAP 3.15.0 + Privy 3.51.0 + Tailwind 4.3.3). Pages: Arena `/`, `/replay`, `/verify`, `/verify/[tx]`, `/how`, `/build`. 12 vitest tests (fee walkthrough ≡ `compute()` on the spec example, 2,000 random inputs and the recorded 8,700-pip trade); production build passes (7 routes); checked in Chrome in RECORDED and REPLAY modes. **Not yet exercised against a live Arena or chain** (no deployment). Optional "Try it yourself" swap: written but untested on chain | `frontend/README.md`, FLOW.md §9 |
| P12 README memo, FEEDBACK.md | not started | — |

GitHub: `origin` = github.com/SATISH-JALAN/Aven (private), branch `main` only. Last push: 2026-11-07 (`1198f4f`, 15 frontend + merge commits), on Sayan's "push" (relayed by Satish). **Local commits after that are not pushed** until Sayan says so.

## Decisions (with date and reason)

- **2026-11-07: Browser RPC = a client-side load balancer over public endpoints, not a server proxy.**
  - Why client-side: the public limits are per IP, so each visitor gets 7 budgets of their own. A Vercel proxy would put every visitor behind Vercel's shared IPs (one budget), and it would need an RPC key the Arena's Alchemy quota can't spare.
  - Consistency: endpoints ≥ 2 blocks behind the freshest head are skipped, and reverts are never retried elsewhere.
  - Latency floor: the oracle and the mark land in the same block, so one block (~1 s) plus one round trip. No contract change can lower it.
- **2026-11-07: Trade page = spot Buy/Sell with stop-loss/take-profit that run in the open tab** (the user chose this over real margin).
  - Real leverage would need a lending/margin contract.
  - Orders that execute while the user is away need an order contract plus a keeper holding the user's approval.
  - Both are new mainnet contracts (Sayan + audit), so neither is built.

- **2026-11-07: Connect wallet without Privy sign-in.** MetaMask failed on "Could not log in with wallet" (console: Privy's generic "Error authenticating session"). Privy's servers were fine: the same SIWE init + authenticate from Node with a throwaway key returned 200 for chains 999 and 1, the clock matched, `wallet_auth` was on and no origin was restricted. The failure was in the browser-side sign step, and Privy hides the cause. The app never uses a Privy session (no server-side calls), so `components/wallet.tsx` now calls `useConnectWallet().connectWallet()` instead of `login()`. This means no sign-in signature, and `authenticated` means "a wallet is connected". MetaMask ignores programmatic `disconnect()`, so Disconnect sends `wallet_revokePermissions` and hides the wallet until the next connect. Typecheck and 29 web tests pass. **Not yet clicked through with a real MetaMask.**
- **2026-11-07: Wallet only, "Connect wallet" wording.** Privy `loginMethods` is `["wallet"]` (email sign-in and the embedded-wallet-on-login option removed), and every "Log in" / "Log out" / "Login off" label now reads "Connect wallet" / "Disconnect" / "Wallet off"; the Privy modal title is "Connect a wallet" (`appearance.landingHeader`). Checked in headless Brave on localhost:3000 with the app ID: every page shows "Connect wallet", no console errors, and the modal lists MetaMask, Coinbase Wallet, Rainbow and Other wallets only. Reason (Om): Aven is a web3 app, so users connect their own wallet.
- **2026-11-07: Swaps stay on `PoolSwapTest` → Uniswap's PoolManager; no other DEX.** Every swap (web app, bot, shock) goes through our `PoolSwapTest` into Uniswap's canonical v4 PoolManager, which calls AvenHook. `pnpm health` proves Uniswap's own V4Quoter and Universal Router (2.0, 2.1.2) also route the Aven pool. Other HyperEVM DEXs were not added: `aETH`/`aUSD` only have liquidity in our two pools, another DEX wouldn't run the hook, and AGENTS.md §6 rules out extra integrations. Moving the web app's swap path to the Universal Router (Permit2 approvals) is possible but was not done right before submission.
- **2026-11-07: "Pushed" = |pool price − oracle| ≥ 30 bp** in the web app (`PUSH_BPS`, the threshold the gap colour already used); the health CLI reports at 25 bp. The last push is the newest non-bot trade on the pool (shock or wallet swap); the last arb is the newest bot trade.
- **2026-11-07: Web app defaults to mainnet** (`NEXT_PUBLIC_CHAIN_ID` 999, `NEXT_PUBLIC_RPC` the public mainnet RPC), because that's where Aven is deployed. Wallet swaps still need the Arena (LIVE mode), since quotes and fee previews come from its live state.
- **2026-11-06: The chain is the database for history and portfolios** (prompt F34: "I'm not adding any particular DB"). Pool history and wallet activity are read from HyperEVM logs and receipts in the browser and cached in localStorage. That's a cache only: clearing it gives the same answer from the chain.
  - Plain-pool swaps don't log an oracle, and HyperEVM serves no past `eth_call` (recon B.3). Their oracle and mark therefore come from an Aven swap in the same block (exact) or within 3 blocks (shown with ≈), else "—". It is never estimated.
  - A wallet's swaps are found through its aETH / aUSD `Transfer` logs, because the PoolManager's `Swap.sender` is the router, not the user. Approvals and reverted txs move no tokens, so they don't show.
  - Faster full-history option, not built: a dedicated log RPC with a domain-restricted key, or Arena-side indexing (Sayan's backend, and a change to the frozen API).

- **2026-11-06: Dashboard latency claims are measured, never typed.** The request said "about 100 ms for a plain transaction, 80 ms for Aven". That isn't true and isn't shown: both kinds land in the same 1 s blocks, and an Aven swap costs about 47.6k more gas.
  - What *is* shown: the Aven fee reprices in **0 blocks** after a HyperCore input changes (oracle or mark), the plain fee **never**, and a 60 s-delayed oracle in 60 s (the replay design).
  - Blocks are the headline unit (exact, from the chain). ms are Arena server time (`state.ts` / `trade.ts`, one clock), so browser clock skew can't enter.
  - The first Aven arb landing a block after the plain one is labelled as bot ordering (one wallet, plain first), not hook latency.
- **2026-11-06: Dashboard colours** (dataviz validator, dark, surface `#0e1110`). Pools keep aqua `#199e70` / orange `#d95926`, with blue `#3987e5` as the third series (all pairs PASS). Gray next to aqua FAILS (CVD ΔE 4.5), so fee terms use the ring gap aqua → premium blue → base magenta `#d55181` → stress yellow `#c98500`, which passes every adjacent pair including the wrap-around.

- **2026-11-07: Frontend guards for open-mint tokens on mainnet** (recommended to Sayan: keep open mint, because new tokens would mean a new hook and pools, since the hook binds the token addresses). The UI caps a trade at 5 aETH / 10,000 aUSD (a 40,000 aUSD shock moves a pool ~190 bp) and says gas is real HYPE. It's a UI guard only; the router stays open. Pending Sayan's confirmation of C-5.

- **2026-11-07: Frontend thread merged with Sayan's mainnet work** (merge commit, not a rebase: every frontend commit touched the same docs). Only docs conflicted. The two prompt logs had clashing numbers, so the frontend thread is listed as **F13–F28** after Sayan's #13–#27. The frontend test pinned to the old local recording (8,700 pips) now pins the mainnet recording (10,000, ceiling; recomputed = on-chain). **Rule from F28: no backend or contract change without a reviewed plan; never send mainnet txs from the frontend machine** (it holds no keys).

- **2026-11-07: Privy is configured.** App ID `cmw5c1yk300nh0ilbwmn26mnw` (public by design) is in `frontend/.env.local` (gitignored); set the same `NEXT_PUBLIC_PRIVY_APP_ID` on the host. Checked on localhost:3000: the Privy API accepts the ID, and the modal shows wallets + email. The **app secret is not used anywhere**: the app has no server-side Privy calls, and a `NEXT_PUBLIC_*` secret would ship to browsers. Never put it in the repo or the frontend env; rotate it if it leaks. Before the hosted site works, add its domain to the Privy dashboard's allowed origins.

- **2026-11-06: Go to HyperEVM mainnet (999); live mode reverted. Decided by Sayan.**
  - Live mode (local chain + relayed prices, `4ae5305`) is reverted in full, with two exceptions.
    - The **Arena `/state` fix** is kept, because the bug affects any chain. `state()` serves max(poller block, newest block in our own receipts), so right after a shock it no longer serves the pre-shock block. Mutation-checked test in `backend/arena/test/state.test.ts`.
    - The **prompt log** is kept (ETHGlobal disclosure).
  - Before anything is deployed: a mainnet budget, a full re-test and a security audit. Results go in DEPLOYMENTS.md (mainnet section) and SECURITY.md.
- **2026-11-06: One account for everything (Sayan).** Deployer = bot = shock = **`0x4412A5313aFd9b6f447EcE820Ce55a30A20034Ee`**. Sayan confirmed it; the key he pasted derives to it, not to the screenshot's `0xFF844…AB535`, so the deploy waited for his confirmation. It had 0.017544 native HYPE on HyperEVM.
  - **Tested on a local chain:** one key as bot + shock concurrently gave 35 txs, 0 reverted, contiguous nonces (viem's shared `nonceManager` is keyed by address), 12 shocks + 21 arbs, verify 21/21.
  - **Budget:** 0.0176 HYPE covers the whole deploy even at the 2-gwei cap. The full 200-swap test needs ~0.08 HYPE more.
  - **Risk accepted:** the key sits in two `.env` files; keep only demo funds in that account.
  - **Funding:** MetaMask Swap is acceptable if the result is native HYPE on HyperEVM (not a HYPE token on another chain, not WHYPE).
- **2026-11-06: Mainnet setup (pre-mainnet audit).**
  - **PoolManager:** reuse **Uniswap's canonical PoolManager** `0x12D4…6B1F` on 999. It's identical to our build (recon §E.2), so no big blocks and no HyperCore-user step. `DeployCore` defaults `POOL_MANAGER` to it on chain 999.
  - **Asset:** mainnet **ETH, perp 1, szDecimals 4**, so `aETH`/`aUSD` and `EXPECT_COIN=ETH` stay.
  - **RPC:** the Arena and the deploy need a **dedicated HyperEVM RPC**. The public one allows 100 requests/min per IP; the Arena makes 118/min idle and ~1,900/min active.
  - **Funding:** 0.03 / 0.10 / 0.02 HYPE for deployer / bot / shock (DEPLOYMENTS.md §M.2). Buy ~$20 of HYPE, not 5–10 HYPE.
  - **Route:** the official one only (DEPLOYMENTS.md §M.3): USDC + a little ETH on Arbitrum → Hyperliquid deposit (≥ 5 USDC; less is lost) → spot buy (≥ 10 USDC) → "Transfer to/from EVM" → three NEW MetaMask accounts. Never put the main key in `.env`.
  - **Gas cap:** every mainnet tx is capped at 2 gwei (deploy: `$FEES`; Arena: `MAX_GAS_PRICE_GWEI=2`, required on 999).
- **2026-11-06: Frontend restructure** (prompt F23: "remove pages with no details", trading like clickoptions.ai, docs like GitBook / docs.clickoptions.ai).
  - **Routes:** Trade, Swap, Pool, Replay and Docs. `/arena` → `/pool`; `/how`, `/build` and `/verify` → `/docs/*` (redirects in `next.config.ts`).
  - **"Long / Short" on Trade is spot.** It buys or sells aETH on a pool: no leverage, no liquidation, no perp orders, because the scope rules forbid perp trading and CoreWriter. The page says so under the toggle. The chart, book, funding and OI are read-only Hyperliquid data, labelled as such.
  - **No mempool panel:** the RPC has no txpool or pending block (recon C.7); only the user's own pending txs are shown.
  - **Charts:** TradingView `lightweight-charts` 5.2.1 (exact pin). Hyperliquid info API is called from the browser (CORS `*`, recon C.7).
  - **The UI's contract args live in `lib/trade-math.ts`,** so `check:frontend` sends the very same transactions from Node.

- **2026-11-06: Frontend redesign.** References given: vouch-zcash.vercel.app, silica-monard.vercel.app, arc.io, qclay.design, 1inch.com, plus the sponsor sites uniswap.org and hyperliquid.xyz.
  - **Look:** near-black with a deep HyperCore green. Hyperliquid mint `#97fce4` is the brand accent, with a Uniswap pink `#ff4fb8`; both are **UI only**. Tested as chart series, they fail CVD (deutan ΔE < 5), so data keeps the validated aqua/orange/blue. Type: Instrument Serif (display), Michroma (labels; it matches the Λ wordmark), Manrope (UI), JetBrains Mono (numbers).
  - **Landing at `/`, Arena at `/arena`.** The content checklist put Arena at `/`, but the redesign asked for a landing page, so Arena moved and every link points to `/arena`.
  - **Motion:** the particle field is three.js, but its states (form / lens / stream) and its render loop are all GSAP (tweens, ScrollTrigger scrub, `gsap.ticker`). There's a static SVG fallback without WebGL or with reduced motion.
  - **Honesty on the landing page:**
    - the swap story's fees come from `compute()` on stated, illustrative inputs, and a test pins its claims;
    - the ticker reads the live precompiles;
    - each stat cites its source (replay, recorded run, prove:diff, AvenHook.sol).
- **2026-11-06: Frontend design and data rules** (`frontend/`).
  - **Brand:** the emblem from `frontend/public/*Emblem.png` is rebuilt as two parametric SVG lobes. The lens between them is the price gap: it opens with the live gap on the Aven pool card and on scroll in the hero. Monochrome ink on near-black; colour only for meaning.
  - **Motion:** GSAP only (ScrollSmoother, ScrollTrigger pins/scrub, SplitText, DrawSVG; all free in `gsap` 3.13+), built inside `gsap.matchMedia()` and off for reduced motion. ScrollSmoother is created by a component placed before the page inside `#smooth-content`, so it exists before any page ScrollTrigger; drawers are portalled to `<body>`; the route transition is opacity-only (a transform would offset pins).
  - **Chart colours** validated with the dataviz checker against `#111113`, all-pairs PASS: Aven/live aqua `#199e70`, plain/fixed 0.30% orange `#d95926`, delayed blue `#3987e5`; fixed 0.05% is a dashed neutral. Status good/warn/crit always with icon + label.
  - **Modes:** LIVE (Arena reachable) / RECORDED (`arena-fallback.json`) / REPLAY. A recording from another chain (today's is LOCAL anvil 31337) supplies config/params for math (`math`) but **never** this chain's addresses (`deployments`): the footer shows "pending deploy" instead of local addresses.
  - **Verify runs in the browser** (`@aven/core/verify` against `NEXT_PUBLIC_RPC`), independent of the Arena. `@aven/core/package.json` gained subpath exports (`./fee`, `./abi`, `./pool`, `./price`, `./verify`) so the bundle never pulls `addresses.ts` (node:fs). This is additive; the `.` export is unchanged.
  - **Privy is optional:** without `NEXT_PUBLIC_PRIVY_APP_ID` the button reads "Login off".
  - **Content spec mapped to the repo:** "HyperFairValue.sol" → `AvenFairValue.sol`; "FeeQuoter" → none (AvenHook quotes itself via `getFee`/`previewFee`); "prevMarkRaw" → `anchorMarkRaw`; "fallbackUsed" → `reason ≠ OK`; "velocity" → stress `moveBps`.
  - **Replay settings** (fee ceiling 3%, premium off, other seeds) are shown but not precomputed: only the untuned spec defaults exist, and the page says so. Arbitrage profit and LP share per replay pool are "n/r": the replay doesn't log arb profit, and we don't estimate it.
- **2026-11-06: Solidity imports are root-style** (`src/…`, `test/…`, `script/…`), never `./` or `../`. Reason: the Nomic Foundation Solidity extension on Windows names sources with backslashes, so relative imports showed false "Source not found" errors in the editor. Forge resolves both forms; the runtime bytecode is identical (only the metadata hash changed); forge 90/0/5.

- **2026-11-06: Replay design.**
  - 5m steps (1m isn't served).
  - The `avenDelayed` lag is 60 s, linearly interpolated between candles.
  - One arb attempt per pool per step, with profit measured at the true oracle.
  - Seeded retail of $100–$3,000, the same sequence on every pool.
  - 1,000 aHYPE of liquidity per pool, ±50% range.
  - Every limit is written in `backend/data/replay/README.md` and in each `frontend/public/replay/*.json`.
- **2026-11-06: Arena defaults** (`backend/.env`, all overridable): `MAX_TRADE_BASE` 5, `MAX_TRADE_QUOTE` 10,000, shock = buy base with `SHOCK_QUOTE` 40,000 aUSD, `MIN_NATIVE_BALANCE` 0.01 (auto-pause), `NATIVE_USD` 0 (testnet gas is valued at $0 in profit), poll 500 ms, 30 POSTs/min per client. Stats count only bot (`arb`) trades; shock swaps are recorded as `retail`.
- **2026-11-06: PoolManager owner = `address(0)`** (DeployCore default, `PM_OWNER` overrides). Nobody can ever set a protocol fee, so verify check B is exact and there are no admin keys. The canonical Uniswap PoolManager has a governance owner; ours deliberately doesn't.
- **2026-11-06: Deploy state.** Scripts pass addresses via `contracts/deployments/<chainId>.wip.json` (gitignored); `CreatePools` writes the final §8.3 `<chainId>.json`. The bot and shock wallets approve routers themselves (the Arena holds their keys); `DeployTokens` only needs their addresses (`BOT_ADDRESS`, `SHOCK_ADDRESS`).
- **2026-11-06: Node deps** are pinned to exact versions at least two weeks old: viem 2.57.10, zod 4.6.7, vitest 5.0.5, tsx 4.23.15, typescript 5.9.3, @types/node 22.20.5 (hono 4.13.13 and @hono/node-server 2.1.5 for the Arena). pnpm 12 needs `allowBuilds: {esbuild: true}` in `pnpm-workspace.yaml`.
- **2026-11-06: Generated vectors** (`backend/data/vectors/*.json`, ~6.7 MB) are gitignored. Regenerate them with `pnpm prove:diff`. The TS differential suite skips when they're absent, unless `PROVE_DIFF=1`.
- **2026-11-06: Replay data interval.** HYPE 1m candles for Oct 29 are no longer served (`candleSnapshot` 1m → 0 candles). 5m is available (73 candles for 18:00–24:00 UTC), as is hourly funding. Scenario A uses 5m, as the spec fallback allows.
- **2026-11-06: Backend first.** Sayan builds the backend (contracts + backend/) via a loop driven by docs/PLAN.md; the teammate does the frontend. Everything is proven on a local anvil chain with mock precompiles before Sayan runs the testnet deploy.
- **2026-11-06: Live Arena asset = testnet ETH** (perp **index 4**, `szDecimals` **4**; `perpAssetInfo` coin `"ETH"`). Decided by Sayan, because testnet HYPE's oracle is ~91× its mark. Mock tokens are `aETH` (18 dec) / `aUSD` (6 dec); the deploy check is `coin == "ETH"`. The **replay stays HYPE on mainnet** (index 159). Testnet ETH premium is currently +37–39 bp, so base-buying swaps on the Aven pool pay ~+1,850 pips. For the clearest demo, shock by **buying** aETH, so the bot's arb is a **sell**, which shows the pure gap fee (recon C.6).
- **2026-11-06: No testnet explorer.** Sayan confirmed purrsec is down, and nothing else covers chain 998. Tx links use our frontend route `/tx/<hash>` (receipt + decoded events via RPC) and `pnpm verify <tx>`.
- **2026-11-06: Layout.** Code lives in `backend/` (core, arena, scripts, data), `contracts/` and `frontend/`, so teammates can work in parallel without confusion. Spec paths map via the table in AGENTS.md §2. Each tool has its own `.env.example`. `docs/spec/TOOLS.md` was removed (duplicate of prompts B7).
- **2026-11-06: Git.** Commits are authored by `Sayan Roy <169074736+mesayanroy@users.noreply.github.com>` (repo-local config). There are no AI co-author tags; history was rewritten once, before the first push. Only `main`. Never push without Sayan's explicit go-ahead.
- **2026-11-06: VS Code.** `.vscode/settings.json` hides the 65 dependency submodule repos from Source Control (`git.detectSubmodules: false`).
- **2026-11-05: Dependencies.**
  - v4-core `d153b048`: source-identical to `main` `bea7f6d`; the `v4.0.0` tag can't compile OZ BaseHook.
  - v4-periphery `main` `c6e4754`: HookMiner is at `test/shared/`.
  - OZ uniswap-hooks `v1.3.0-rc.0`: the only v1.3.x tag; re-pin if 1.3.0 ships.
  - forge-std `v1.17.0`; hyper-evm-lib `v1.1` (tests only).
- **2026-11-05: PoolManager** is deployed by us on 998 (none exists). It's built separately with `[profile.v4core]` (via-IR, 44,444,444 runs, `bytecode_hash=none`), which is byte-identical to Uniswap's HyperEVM mainnet PoolManager. Tests use the fast default profile.
- **2026-11-05: Hook deployer:** CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` (live on 998) + HookMiner, flags `0x2080`.
- **2026-11-05: HYPE perp index:** testnet **135**, mainnet **159**, `szDecimals` 2 on both.
- **2026-11-05: Gas cap** `precompileGas = 30,000`. The measured precompile charge is ≤ 3,112, versus 6,160 for the doc formula, which is an upper bound only.
- **2026-11-05: Polling.** HyperEVM RPC has no websockets; `eth_call` works on latest only; `eth_getLogs` should use ≤ 50-block chunks.
- **2026-11-05:** `docs/spec/ARCHITECTURE.md` (team's `AVEN_ARCHITECTURE.md`) is normative.

## Open questions (need a decision)

- **Deploy target: ✅ RESOLVED 2026-11-06: HyperEVM mainnet (999)**, see the decision above and DEPLOYMENTS.md §M. The original proposal is kept below for the record. Testnet HYPE is the blocker: the testnet faucet only serves addresses that have deposited on **mainnet**, so some real money is needed either way. Proposal: **deploy on HyperEVM mainnet (chain 999) with mock tokens**; the only real cost is gas.
  - **Evidence** (read-only RPC/API calls, 2026-11-06 ~09:50 UTC):
    - official v4 PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F` has code on 999; its owner is `0x2d09d0c2f82c59b19b3c65a48ce2c550bf0921f9` and `protocolFeeController()` is `address(0)`, so new pools start with protocol fee 0 (verify reads `protocolFee` from slot0 anyway);
    - the CREATE2 proxy `0x4e59…956C` exists on 999;
    - precompile `eth_call`s on the mainnet RPC are free and sane: ETH oracle raw 223952 (2,239.52), HYPE 778625 (77.86);
    - mainnet perp indexes: **ETH = 1 (szDecimals 4)**, HYPE = 159 (szDecimals 2), BTC = 0;
    - base fee ≈ 0.14 gwei, HYPE ≈ $78, so ≈ $0.01 per 1M gas.
  - **Cost:** deploy (2 test routers, 2 mock tokens, hook, 2 pools, smoke) ≈ 10M gas ≈ $0.10; a bot swap ≈ 190k gas ≈ $0.002. $5–10 of HYPE covers the whole demo.
  - **Why it's simpler than testnet:** no PoolManager deploy, so **no big blocks and no HyperCore-user step** (AvenHook, 9.3 KB, fits a 3M small block). It uses the official Uniswap PoolManager and real prices, and mainnet has block explorers.
  - **Getting HYPE onto HyperEVM:** (a) a teammate or the venue help desk sends ~0.1 HYPE; (b) deposit USDC to Hyperliquid, buy HYPE on spot, "Transfer to EVM"; (c) an exchange that withdraws HYPE on HyperEVM (UNVERIFIED which). Use a fresh wallet holding only a few dollars. A mainnet deposit also unlocks the testnet faucet for that address.
  - **Changes needed if chosen (~1–2 h):**
    - `DeployCore.s.sol`: option to reuse the official PoolManager and deploy only the test routers;
    - `DeployAven`: `PERP_INDEX=1 EXPECT_COIN=ETH` (same decimals as today);
    - Arena: `CHAIN_ID=999`, `NATIVE_USD≈78`, a `MIN_NATIVE_BALANCE`;
    - frontend: chain 999 + mainnet RPC;
    - docs: mainnet runbook in DEPLOYMENTS.md, facts into recon.md, AGENTS.md §2 asset row.
  - **Rejected:** Unichain Sepolia with relayed prices (needs a relayer, contradicting the pitch, and a price-source rewrite; too late). **Zero-cost fallback:** the local anvil chain with live mainnet oracle/mark copied into the mock precompiles every second, labelled "local chain, live mainnet prices".
- **Replay scenario C (`volatile-2`):** pick a window (`backend/scripts/scenarios.json`; placeholder Oct 29 00:00–06:00 is skipped by default).

0. **Mainnet deploy: ✅ DONE 2026-11-06** (DEPLOYMENTS.md §M.5). Next:
   - **Rotate the key.** It was pasted into chat. Move anything of value out of `0x4412…34Ee`, and use it for demo funds only.
   - **Arena on mainnet** needs a dedicated RPC (Alchemy or Chainstack free tier, ~25 rps; `POLL_MS=2000`, DEPLOYMENTS.md §M.4b). `backend/.env` is pre-created with every setting; Sayan fills in the RPC URL and the key himself. It needs with `BOT_PK`=`SHOCK_PK`= that key, `CHAIN_ID=999`, `NATIVE_USD`, `MAX_GAS_PRICE_GWEI=2` and a 24+ character admin token. Sayan should write the key into the file himself, not paste it in chat.
   - **Bot testing:** 0.0165 HYPE left, about 60 bot swaps at median gas before the 0.01 auto-pause. Top up ~0.08 HYPE for the full 200-swap test.
0-old. **Mainnet deploy (Sayan), original plan:**
   - get a **dedicated HyperEVM RPC** that handles ~30–40 requests/s;
   - one account (Account 2, 0.0176 HYPE now): enough to deploy. Top up ~0.08 HYPE (MetaMask Swap to native HYPE on HyperEVM is fine) for the full bot test (DEPLOYMENTS.md §M.2–M.3);
   - run §M.4.
0a. **Decide C-5 (SECURITY.md §6.2):** keep open-mint demo tokens (anyone can swap, including judges, but also grief the pools) or deploy owner-mint demo tokens.
0b. **Frontend (teammate):**
   - chain **999**: ✅ the default since 2026-11-07; badge **"Live mainnet"** still open;
   - handle **429** on `/verify/:tx` (per-client limit) and **503** on `/stream` (client cap: retry with backoff);
   - put a read RPC in `NEXT_PUBLIC_RPC`. The public endpoint is OK for a few reads; the dedicated one if traffic grows.
0c. Testnet (998) stays blocked: no testnet HYPE (DEPLOYMENTS.md §T).
1. **Big blocks on testnet: UNVERIFIED** until we send `evmUserModify`. The deployer must be a HyperCore user. The faucet only serves addresses that have deposited on mainnet; otherwise someone must `usdSend` testnet USDC to the deployer.
2. Repo must be made **public** before submission (Sat Nov 7, 09:00 IST).

## Spec additions (safety, behaviour-identical for valid configs; review welcome)

- `validateParams` also rejects `decimals0` or `decimals1` > 18. Without it, `poolWad` could overflow and revert a swap (I1). §6.2 doesn't list this rule.
- `readPrices` treats a returned word > `type(uint64).max` as a failed read. §6.3 says "decoded uint64 > 0"; a plain `abi.decode` would revert. It copies at most 32 bytes of return data.
- `compute` evaluates `|a−b|·10000/oracle` as `FullMath.mulDiv(|a−b|, 10000, oracle)`. The floor result is identical; it just can't overflow for extreme pool prices.

## Gotchas learned

- **Windows reserves port ranges** (Hyper-V/WinNAT): on the 2026-11-07 machine `netsh int ipv4 show excludedportrange protocol=tcp` lists 8699–8798, which contains the Arena default 8787 and `check:frontend`'s 8797 (`listen EACCES`). Use `ARENA_PORT` / `CHECK_PORT` / `DEMO_PORT` outside the ranges.
- **Uniswap's Universal Routers on 999 (2.0 and 2.1.2) take `ExactInputSingleParams` with `minHopPriceX36`**, the layout in our pinned v4-periphery; the older layout without it reverts. Found by simulating both in `pnpm health`.
- **Simulating a Universal Router swap without approvals:** `eth_call` state overrides work on the public HyperEVM RPC. solmate ERC20 `allowance` is mapping slot 4 (`balanceOf` slot 3); Permit2 `allowance[owner][token][spender]` is slot 1, packed amount | expiration << 160 | nonce << 208 (checked against Permit2's own getter).
- **MockERC20 (solmate) names the Transfer amount `amount`, not `value`.** Decoding with `args.value` threw inside a catch, so mints showed as empty "Transfer" rows. Read `amount ?? value`. The wallet cache key was bumped to v2 so bad records are dropped.
- **Mainnet public RPC throttling looks like a range error.** `-32005 "Request exceeds defined limit"` came back even for 15-block `eth_getLogs`. Shrinking the range only adds calls; wait (exponential back-off) instead. A throwaway mainnet test left in `frontend/test/` also ran inside the normal `vitest run` and spent the budget: keep network tests out of `test/`.

- **`[data-reveal]` is hidden by CSS (`.js-motion`) until GSAP shows it.** A reveal-marked element that mounts *after* the section's `useReveal` pass stays hidden forever. Separately, the `/pool` "Two pools" tiles are marked `data-revealed` but sit at opacity 0 with no tween left: the reveal was reverted (likely the `deps` re-run), still open. On the dashboard, only always-rendered wrappers carry `data-reveal`, and `useReveal` runs once.
- **A GSAP `from()` that re-runs when data arrives** (`useGSAP` deps) tweens to the half-drawn state and freezes it (the scatter's formula line stayed undrawn). Use `fromTo` with explicit ends, plus a ran-once ref.
- **CDP `Runtime.enable` replays console messages the tab already logged.** Warnings from a page's earlier code show up in a new capture: navigate first, or count only messages after the navigation.
- **The Arena bot's in-flight arb can land in the same block as a shock, after it.** It then pays the post-shock gap fee (seen: 5,600 pips, 8 ms after the shock). Episode logic counts only arbs after the episode start on the Arena clock (a routine nibble mined earlier in the shock block is not "the answer").

- **`forge test` on the frontend laptop (forge 1.8.1, 2026-11-07): `test_constructor_rejectsBadConfig` fails with OutOfGas** inside `HookMiner.find` on its third case (89 pass / 1 fail / 5 skip). The constructor reverts correctly on the cases before it; the gas goes on salt mining. Test and `foundry.toml` are unchanged since it passed, so it's likely the forge version. Not fixed (contracts are Sayan's): he should run it with his forge and compare versions.
  - **Measured 2026-11-06 21:25 UTC:** with `--gas-limit 20000000000` both suites pass; the base-token1 suite needs **1,375,455,324 gas** (vs the ~1.07B default), the other 366M. It's salt mining: four `HookMiner.find` searches, each hashing the ~13 KB init code per attempt; the bytecode (metadata) change in `4978cd0` moved the salts later. **Proposed fix for Sayan:** wrap the `HookMiner.find` line in `_expectCtorRevert` with `vm.pauseGasMetering()` / `vm.resumeGasMetering()`. The revert assertions stay unchanged. Tried in the working tree: forge **90 / 0 / 5**; then reverted, because contracts are his.

- **`useGSAP` with a `scope` ref that isn't rendered** (footer on app routes, an empty feed) floods the console with "Invalid scope" / "GSAP target not found" in dev. Return early when `ref.current` is null.
- **2026-11-06 23:27 IST: the dev server died from low memory again** (Brave ~4.8 GB + `next dev` 1.6 GB; Windows Resource-Exhaustion event). Pages that "rendered blank" in screenshots were just the dead server. Close the browser's heavy tabs, or check with `next build` + `next start` instead of `next dev`.

- **Hydration: never put raw float math into an inline style.** `50 + Math.cos(a) * 48` serialized as `26%` on the server and `25.99999999999998%` in the browser (landing `NoKeysGraphic`). Round with `toFixed(3)` so both sides render the same string.
- **Don't run `next build` while `next dev`/`next start` is up on this laptop.** Together they ran out of memory (Windows error 1450) and are the likely cause of the two freezes on 2026-11-06. Stop the server, build, then start it again. `TaskStop` on `npx next start` kills only the npx wrapper; the node child keeps the port and serves a stale `.next` (chunk 404s, "Uncaught (in promise)"). Start the server as `node node_modules/next/dist/bin/next start` so stopping it really stops it.
- **Headless Chrome screenshots of the site:** `--virtual-time-budget` doesn't run the GSAP intros, and a tall window just stretches the 100svh hero. Drive Chrome over CDP instead (1440×900 viewport, wheel-scroll, real time).

- **Fixed overlays must live outside `#smooth-content`.** ScrollSmoother transforms it, so `position: fixed` inside acts like absolute. The preloader and drawers are portalled to `<body>`; the cursor and nav sit outside the wrapper.
- **React StrictMode runs effects twice in dev.** A "once per session" check that writes sessionStorage inside the effect skips itself on the second run. Decide once per page load in a module variable.
- **GSAP `.from(..., { paused: true })` applies its start state at creation.** If the tween is later reverted or the element re-created, the element can stay hidden. For intros that wait for an event, create a `fromTo` with `clearProps` when the event fires.
- **SplitText breaks `background-clip: text`** on the words it wraps, so gradient text went invisible. Use a solid colour on split headlines.
- **2026-11-06 11:27 UTC: the HyperEVM testnet RPC returned HTTP 502** (CloudFront) for minutes. The site showed "RPC down" and kept the last block, as designed.
- **Next 16 `next dev` writes `frontend/AGENTS.md`** (its own agent notes). The repo has one rulebook at the root (rule 6), so `next.config.ts` sets `agentRules: false`.
- **pnpm on this machine:** the global pnpm 10.6.5 tries to self-switch to `packageManager: pnpm@12.9.1`, then runs pnpm 12's native `.exe` through node and crashes ("Invalid or unexpected token"). Workaround: run `%LOCALAPPDATA%\pnpm\.tools\pnpm\12.9.1_tmp_*\node_modules\pnpm\pnpm.exe` directly. Fix: `npm i -g pnpm@12.9.1`. pnpm 12 also fails an install on unreviewed build scripts: Privy's optional `@reown/appkit`, `bufferutil`, `keccak` and `utf-8-validate` are set to `false` in `allowBuilds`.
- **Browser automation tabs get ~1 animation frame per second**, so GSAP's lag smoothing (≤ 33 ms per frame) makes a 2.6 s intro take over a minute and pages look half-revealed. Not a site bug. In dev, `window.gsap` is exposed: run `gsap.ticker.lagSmoothing(0)` before judging motion in automation.
- **Hydration:** never read `window` during render (the replay share URL did, and React threw away the tree). Compute it after mount.
- **Python on Windows** reads piped text as cp1252, so `cat file | python` showed a correct "—" as "â€”". Pass a path and `encoding='utf-8'` instead.

- **`.env` trailing comments.** Our loader used to keep `  # comment` as part of the value, so `NATIVE_USD=78  # price` failed to parse. Since 2026-11-06 it strips a trailing ` # …` from unquoted values (test `loadDotEnv`). Keep comments on their own lines anyway.

- **The HyperEVM RPC's `eth_feeHistory` returns only 5 blocks, whatever count you ask for.** A "1,024-block" fee window built on it is really 5 blocks. Sample block headers to measure gas. Mainnet base fee measured 0.10–10.8 gwei within 3 h: always cap `maxFeePerGas`.

- **`forge script` can't read HyperCore precompiles in its simulation.** On a live HyperEVM chain the precompile addresses have no code (`eth_getCode` = 0x). Forge runs every script in its own EVM first, where a `staticcall` to them "succeeds" with 0 bytes. Scripts must read them with `vm.rpc("eth_call")` (`AvenScript._precompileCall`). The hook's own reads inside a simulated swap take the fallback path, so give Smoke a bigger gas multiplier. Found by the pre-mainnet audit; a fork with mocks etched can't show it.
- **The public HyperEVM RPC allows 100 requests/min per IP** (official docs). A polling bot at 500 ms already needs 118/min. Measure an app's request rate with a counting proxy before going live.

- **`/state` right after our own tx could be one block stale.** It's cached by the poller's last block, refreshed every 500 ms, so a recording once showed "0 bp off fair" after a shock. Fixed with `ownTxBlock` (kept through the live-mode revert).
- **Mutation checks: restore from a copy, never `git checkout`.** `git checkout` reset a file with uncommitted work in it (caught and restored, 2026-11-06).

- **Editor "Source not found" (error 6275) on relative Solidity imports, Windows only.** The Nomic Foundation extension (`hardhat-solidity` 0.9.3, also in Antigravity IDE) renames Foundry sources with `path.relative`, which gives `src\interfaces\X.sol`. solc resolves `./Y.sol` to `src/interfaces/Y.sol`, so nothing matches. Remapped or root-style imports go through the extension's own resolver and work. Use root-style imports; reload the window after changing them.
- **The same extension applies the LAST matching remapping, not the longest.** Forge's auto-detected `@openzeppelin/=lib/v4-core/lib/openzeppelin-contracts/` therefore hijacked `@openzeppelin/uniswap-hooks/...`, and `BaseHook.sol` showed "not found". `BaseHook` is now imported as `uniswap-hooks/base/BaseHook.sol` through an explicit `uniswap-hooks/=lib/uniswap-hooks/src/` remapping. The runtime bytecode is identical. Checked by driving the extension's own language server headless: the old `IAvenHook.sol` reproduced the two errors exactly, and the new one gives 0.

- **Gas estimates for Aven swaps need a margin.** `eth_estimateGas` sees the cheap "later swap in this block" hook path; the real tx is usually the first swap of the next block (top-of-block + anchor writes) and runs out of gas. Found by the load test (12/70 bot txs reverted); fixed with `withGasMargin` (×1.3 + 30k) → 0/76. Routers need the same.
- **viem defaults that hurt a 1 s-block chain:**
  - `getBlockNumber()` is cached ~4 s: pass `cacheTime: 0` on clients that poll or scan to head;
  - `waitForTransactionReceipt` polls at `pollingInterval` (4 s default): set 250 ms.
  - Both were found by the load test.
- A per-block cache that is only filled after the computation finishes still stampedes: cache the in-flight promise (single-flight).
- `vm.pauseGasMetering()` plus a mock that burns "all gas" loops forever. Resume metering around any call that can burn gas.

- Foundry persists failing invariant sequences (`cache/invariant/failures`) and replays them first. An `afterInvariant` assertion like "swaps > 0" then fails on a short replayed sequence. Keep non-vacuity in a deterministic test and only log counters in `afterInvariant`.
- Invariant handler sizing matters: swaps too big for the pool's ~21-base virtual depth drift it >20% from the oracle, so most swaps hit GAP_TOO_LARGE and the clamped OK path goes under-tested.

- Windows + Node 23: `process.exit()` while fetch sockets are closing trips a libuv assertion (`UV_HANDLE_CLOSING`), and a passing CLI exits non-zero. Use `process.exitCode` and return.
- Foundry's gas report doesn't track contracts placed with `deployCodeTo` (etch). Measure hook gas inside tests (`test_gas_*`, read with `-vv`).
- `forge test --json` omits `decoded_logs` unless run with `-vv`; the test logs are parsed from text instead.

- A mutation check showed the first replay fee sanity test was too weak: ratio-only asserts survive dropping one token's fees. It now asserts both tokens collect fees and that collected fees equal independently expected fees (0.01%).
- Bash: avoid double-quoted `python -c "...$141..."` (bash expands `$1`) and writing `−` through Windows cp1252. Generate text with a script file, then use the Write tool.
- The Claude Code safety check refuses long multi-heredoc bash lines it can't parse. Split them up.

- `sqrtBig` originally seeded Newton with `Math.sqrt(Number(x))`. When the float seed landed below the root, the fix-up loop stepped by ±1 ~1e8 times (hang). Now it's integer Newton from a 2^ceil(bits/2) over-estimate, with a 300-size randomized floor test.
- vitest hides `console.log` from passing tests, so e2e numbers must be asserted or written to a file to be seen.

- On Windows, spawn long-running children (anvil) with `shell: false`. A `cmd.exe` wrapper leaves anvil orphaned when you kill the wrapper's pid, and the parent pipeline hangs.
- `LiquidityAmounts.getLiquidityForAmounts(…, huge, …)` reverts with SafeCastOverflow: it computes both sides. Size from one side with `getLiquidityForAmount0/1`.
- `contracts/deployments/` must exist for Foundry `fs_permissions` (it's committed with a README; scripts also `vm.createDir`).

- Foundry `fs_permissions` can't resolve a path that doesn't exist yet: `vm.createDir` under `../backend/data` fails until the folder exists. `prove:diff` creates it first.
- Building 10k JSON strings in a Foundry test runs out of gas through memory expansion unless you call `vm.pauseGasMetering()`. Also move per-item work into a helper to avoid stack-too-deep.

- `vm.expectRevert` does **not** enforce against an inline-assembly `CREATE2` in the test's own frame; the test passed with valid args too. Do the CREATE2 in an external self-call (`this.deployRaw`). Found by a mutation check, 2026-11-06.
- Measured hook overhead in tests: ~46.9k gas per swap (Aven swap minus identical control swap), with the mock precompile, which costs more than the real one (≤ 3.1k/read). §6.7 estimated 35–45k; re-measure in PLAN 7.1.
- Mutation checks run on the hook (2026-11-06): no override flag → 5 tests fail; top-of-block reset every swap → 2 fail; anchor advancing on a failed read → 1 fails.

- `perpAssetInfo` (0x80a) returns **one struct** (`abi.encode(PerpAssetInfo)`), not five flat values.
- Offline, precompile addresses have no code: `staticcall` succeeds with **0 bytes**. Always check the return length.
- An invalid precompile index burns the **entire** forwarded gas.
- Foundry is at `~/.foundry/bin` and may not be on PATH. `forge install` only works from inside `contracts/` on this Windows setup ("prefix not found" from the repo root).
- `forge test` with `compilation_restrictions` on PoolManager makes every importer via-IR (slow builds, a different test bytecode). That's why the separate `v4core` profile exists.
