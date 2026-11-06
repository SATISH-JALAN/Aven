# MEMORY.md — project memory

The running record of status, decisions and open items. It saves you from re-reading the whole history. Update it in the same commit as any change (AGENTS.md rule 4). Newest entries go first in each section.

## Status

| Prompt | State | Commit(s) / notes |
|---|---|---|
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
| **Pre-mainnet audit + mainnet fork rehearsal** | ✅ done 2026-11-06 (SECURITY.md §6, recon §E, DEPLOYMENTS.md §M); **not deployed yet**.
  - Fork of 999: all 5 scripts on Uniswap's canonical PoolManager, smoke A+B MATCH. Full app: 8,800 vs 3,000 pips, LPs kept $64.05 more, `verify --all` 4/4.
  - Deep tests: fuzz 10× (90/0); invariants × 4 seeds (16,384 calls, 0 reverts); on-chain load; diff 10k+2k; Arena e2e; load test on the hardened code (p99 ≤ 63 ms, 0 errors, 0 nonce errors).
  - **Found and fixed:** the deploy scripts read precompiles directly, which gets 0 bytes in forge's simulation on a live chain, so `DeployAven` would have failed on mainnet → `vm.rpc` path. Backend B-1…B-5 (rate-limit spoofing, RPC-amplifying GETs, SSE cap, `NATIVE_USD` guard, admin token length); 8 mutations caught.
  - **Budget:** ~0.008 HYPE ($0.62) of gas for the deploy + 200 bot swaps + 10 shocks; fund 0.11 HYPE (survives 10× gas). | `contracts/script/base/AvenScript.sol`, `backend/arena/src/{server,config,arena}.ts` |
| **Backend plan** | ✅ every step done or BLOCKED on Sayan (testnet deploy) | docs/PLAN.md |
| P3–P13 | not started | — |

GitHub: `origin` = github.com/SATISH-JALAN/Aven (private), branch `main` only. Last push: 2026-11-06 (`4978cd0`), on Sayan's "push". **Local commits after that are not pushed** until Sayan says so.

## Decisions (with date and reason)

- **2026-11-06: Go to HyperEVM mainnet (999); live mode reverted. Decided by Sayan.**
  - Live mode (local chain + relayed prices, `4ae5305`) is reverted in full, with two exceptions.
    - The **Arena `/state` fix** is kept, because the bug affects any chain. `state()` serves max(poller block, newest block in our own receipts), so right after a shock it no longer serves the pre-shock block. Mutation-checked test in `backend/arena/test/state.test.ts`.
    - The **prompt log** is kept (ETHGlobal disclosure).
  - Before anything is deployed: a mainnet budget, a full re-test and a security audit. Results go in DEPLOYMENTS.md (mainnet section) and SECURITY.md.
- **2026-11-06: Mainnet setup (pre-mainnet audit).**
  - **PoolManager:** reuse **Uniswap's canonical PoolManager** `0x12D4…6B1F` on 999. It's identical to our build (recon §E.2), so no big blocks and no HyperCore-user step. `DeployCore` defaults `POOL_MANAGER` to it on chain 999.
  - **Asset:** mainnet **ETH, perp 1, szDecimals 4**, so `aETH`/`aUSD` and `EXPECT_COIN=ETH` stay.
  - **RPC:** the Arena and the deploy need a **dedicated HyperEVM RPC**. The public one allows 100 requests/min per IP; the Arena makes 118/min idle and ~1,900/min active.
  - **Funding:** 0.02 / 0.08 / 0.01 HYPE for deployer / bot / shock (DEPLOYMENTS.md §M.2). Buy ~$10–15 of HYPE, not 5–10 HYPE.

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

- **Replay scenario C (`volatile-2`):** pick a window (`backend/scripts/scenarios.json`; placeholder Oct 29 00:00–06:00 is skipped by default).

0. **Mainnet deploy (Sayan):**
   - get a **dedicated HyperEVM RPC** that handles ~30–40 requests/s;
   - buy ~$10–15 of HYPE and fund the deployer, bot and shock wallets (DEPLOYMENTS.md §M.2–M.3);
   - run §M.4.
0a. **Decide C-5 (SECURITY.md §6.2):** keep open-mint demo tokens (anyone can swap, including judges, but also grief the pools) or deploy owner-mint demo tokens.
0b. **Frontend (teammate):**
   - chain **999** and badge **"Live mainnet"**;
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
