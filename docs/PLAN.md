# PLAN.md — backend build plan (contracts + backend/)

The loop's to-do list. Each iteration takes the **first unchecked step**, builds it, runs its check, then does the same bookkeeping every time:
- update `docs/FLOW.md`, `docs/MEMORY.md` and `docs/ai/ATTRIBUTION.md`;
- tick the box here;
- commit locally (no push, no AI tag; see AGENTS.md §0).

A step that needs something only Sayan can provide (keys, testnet funds, a decision) is marked **BLOCKED** with the exact ask. The loop then moves on to the next unblocked step.

**Scope:** `contracts/` and `backend/` only. The frontend is the teammate's (P10). The only frontend work here is writing replay JSON into `frontend/public/replay/`, a file contract defined in DATA.md.

**Live asset:** testnet ETH (perp 4, szDecimals 4, aETH/aUSD). The replay uses HYPE mainnet data (perp 159). See MEMORY.md.

**Testnet runs need Sayan:**
- a funded deployer key;
- a HyperCore user;
- big blocks.

So every deploy and bot path is first proven end-to-end on a **local anvil chain** with mock precompiles etched at `0x806`/`0x807`/`0x80a`. Running it on testnet is then just Sayan's commands in step 5.6.

---

## Phase 1: Contracts (prompts P2, P3)

- [x] **1.1 `AvenFairValue` library** (`contracts/src/AvenFairValue.sol`, §6.2–§6.4)
  - constants;
  - the Config/Params/Inputs/Reason/Breakdown types;
  - `defaultParams`, `validateParams`;
  - `readPrices` (gas-capped, non-reverting);
  - `oracleWad`, `poolWad`;
  - `compute` (Steps 2–8);
  - `advanceAnchor`.

  Check: `contracts/test/unit/AvenFairValue.t.sol`:
  - the worked example (9,000 / 500 pips);
  - each signal alone;
  - the direction matrix for both token orders;
  - top-of-block same/opposite side, and exactly at fair;
  - clamps; READ_FAILED and GAP_TOO_LARGE;
  - scaling for szDecimals 0/2/4/5, and the poolWad round trip for 18/6 and 6/18;
  - anchor math;
  - every validateParams rule;
  - fuzz: never reverts, I2 holds.
- [x] **1.2 Mocks + test base**:
  - `contracts/test/mocks/MockHyperCorePx.sol` (`set`, `setFail`, `setBurn`, `setEmpty`, and a perpAssetInfo mode for 0x80a);
  - `contracts/test/utils/AvenTestBase.sol` (etches 0x806/0x807, `setOracle`/`setMark`).
- [x] **1.3 `IAvenHook` + `AvenHook`** (§6.4–§6.5, §8.1):
  - permissions 0x2080;
  - immutables;
  - `_beforeInitialize` checks;
  - `_load` / `_beforeSwap` with the override flag always set;
  - `getFee` / `previewFee` (`onlyValidPools` + `PoolNotInitialized`);
  - `poolState`, `config`, `params`.
- [x] **1.4 Integration tests** (`contracts/test/integration/AvenHook.t.sol`): an Aven pool and a control pool with identical liquidity.
  - Check: **all nine §9 named tests**;
  - arb pays more than the reverse;
  - Swap.fee == FeeComputed.fee;
  - getFee == previewFee;
  - beforeSwap gas logged.

## Phase 2: TypeScript core (P4)

- [x] **2.1 Workspace:**
  - root `package.json` scripts;
  - `tsconfig.base.json`;
  - `backend/core` package `@aven/core` (TS strict, ESM, viem, zod, vitest).
- [x] **2.2 `fee.ts` + `state.ts`:** a line-for-line BigInt port of §6.3/§6.4 (no floats).
  - Check: unit tests mirroring 1.1 (worked example etc.).
- [x] **2.3 Differential proof:**
  - `contracts/test/vectors/GenVectors.t.sol` writes `backend/data/vectors/{fee,anchor}-vectors.json` (10,000 + 2,000, fixed seed, covering the edge classes);
  - `backend/core/test/differential.test.ts`;
  - `pnpm prove:diff`.
  - Check: 10,000/10,000 and 2,000/2,000 exact.
- [x] **2.4 `abi.ts` (generated from `contracts/out` by `pnpm abi`), `precompiles.ts`, `addresses.ts`** (zod schema §8.3).
- [x] **2.5 `verify.ts`** (§7.3): checks A and B; logs scanned in ≤ 50-block chunks.
  - Check: unit tests on a fixture receipt, then a live local check in 3.x.

## Phase 3: Deploy scripts + local chain (P5)

- [x] **3.1 Scripts** in `contracts/script/`:
  - `DeployCore` (PoolManager from `out-v4core` + test routers; prints the big-block steps);
  - `DeployTokens` (aETH 18 / aUSD 6; mints to the deployer, bot and shock addresses; approvals);
  - `DeployAven` (`perpAssetInfo` check `coin == "ETH"`, HookMiner salt via the CREATE2 proxy);
  - `CreatePools` (sqrtPrice from the oracle; Aven pool 0x800000 and control pool 3000, tickSpacing 60, identical liquidity);
  - `Smoke` (both directions on both pools);
  - writes `contracts/deployments/<chainId>.json` exactly per §8.3.

  Plus a unit test: `poolWad(sqrtP)` is within 1 bp of `oracleWad` for both token orders.
- [x] **3.2 Local chain:** `backend/scripts/local-chain.ts`.
  1. Starts anvil (chain 31337).
  2. Deploys the CREATE2 proxy if missing.
  3. Etches mock precompiles (`MockHyperCorePx` runtime) at 0x806/0x807/0x80a with ETH-like prices.
  4. Runs the five scripts.

  Check:
  - `deployments/31337.json` written;
  - smoke swaps emit `FeeComputed`;
  - `pnpm verify <smokeTx>` gives MATCH on A and B.
- [x] **3.3 Testnet runbook:** written (`docs/DEPLOYMENTS.md`). **BLOCKED on Sayan** for the actual run. The ask: fund the deployer with testnet HYPE (gas), make it a HyperCore user (USDC on Core), then run the runbook commands. `docs/DEPLOYMENTS.md`. Exact commands in order, for Sayan to run:
  1. become a Core user;
  2. switch big blocks on (Python SDK one-liner);
  3. build the v4core artifact;
  4. run the five scripts;
  5. switch big blocks off;
  6. verify.

  **BLOCKED on Sayan** for the actual testnet run.

## Phase 4: Arena service (P6)

- [x] **4.1 Core loop:** `backend/arena`:
  - Hono + `@hono/node-server`;
  - config from `backend/.env` + `deployments/<chainId>.json`;
  - block poller (500 ms);
  - bot loop: read the oracle, quote via `previewFee`, compute p* and the sqrtPriceLimit, simulate, send if profitable;
  - nonce manager; retry/backoff;
  - `MAX_TRADE` cap and the balance auto-pause.
- [x] **4.2 Shock, stats and persistence:**
  - shock = identical swaps on both pools from the shock wallet;
  - per-pool stats, `lpKeptMoreUsd`, `botProfitDiffUsd`;
  - `backend/data/arena/trades.jsonl` append + reload.
- [x] **4.3 HTTP + SSE:** exactly per `docs/spec/API.md` (B4), plus `/config`.
  - admin token on POSTs;
  - CORS allowlist;
  - POST rate limit.
- [x] **4.4 Tests + local e2e:**
  - vitest: direction, p*, sqrtPriceLimit for both token orders, profit, stats;
  - e2e on the local chain: shock → bot trades both pools → the Aven fee is higher than control's for the same gap → `lpKeptMoreUsd > 0` → `/verify/:tx` MATCH.

## Phase 5: Replay data and engine (P7, P8)

- [x] **5.1 Market data:**
  - `backend/scripts/fetch-market-data.ts` + `scenarios.json`;
  - A = 2026-10-29 18:00–24:00 UTC. 1m is unavailable (the API returns 0 candles), so it uses **5m**: 73 candles available, plus funding.
  - B = calm (2026-10-25 06:00–12:00);
  - C = placeholder;
  - outputs raw JSON + `normalized.csv` + `backend/data/raw/README.md`.
- [x] **5.2 Replay engine:** `contracts/test/replay/Replay.t.sol`.
  - 4 pools: fixed05, fixed30, avenDelayed (perpIndex 1, lagged 60 s), avenLive;
  - an arb agent;
  - a seeded retail agent;
  - LP accounting;
  - outputs `backend/data/replay/<scenario>.csv` + `.summary.json`.

  Check: a zero-move sanity test; hand-check a few steps; report honestly, with no tuning.
- [x] **5.3 `backend/scripts/replay-to-web.ts`:** writes `frontend/public/replay/<scenario>.json` (downsampled). Plus `backend/data/replay/README.md` (method, limits, rerun).

## Phase 6: Proofs and hardening (P9, P11, P13 backend part)

- [x] **6.1 Verify CLI:**
  - `pnpm verify <tx>` / `--all`;
  - `pnpm proofs` writes `docs/PROOFS.md` (named tests, gas report, diff, verify --all).
- [x] **6.2 Invariant suite:** `contracts/test/invariant/AvenInvariant.t.sol` covering I1, I2, I3, I4, I9. Plus `forge snapshot` and the gas report vs §6.7.
- [x] **6.3 `docs/SECURITY.md`:** maps each §10 threat to its test or a stated limit. Slither isn't installed; note it.
- [x] **6.4 `backend/scripts/demo.ts`:** reset → shock → bot → summary, saved to `frontend/public/arena-fallback.json`.

## Phase 7: Load testing (Sayan, 2026-11-06: "at the end do load testing")

- [ ] **7.1 On-chain load** on the local chain: many swaps per block on the Aven pool (both directions, mixed sizes, many blocks). Plus a burst of reads that fail or burn gas.
  - Check: 0 reverts caused by reads (I1); every fee within I2; the `beforeSwap` gas distribution (p50/p95/max) stays far under the 3M small-block limit; top-of-block and anchor behave as specified under load.
- [ ] **7.2 Arena API load** with `autocannon` against the local Arena service while the bot loop runs: `/health`, `/state`, `/stats`, `/trades`, `/config`, many concurrent `/stream` SSE clients, POST rate limits.
  - Check: p50/p95/p99 latency, error rate 0 for reads, POSTs rejected past the limit, the bot loop never stalls, memory stays flat.
- [ ] **7.3 Bot under stress:** repeated shocks + RPC failure injection (bad URL / timeouts) on the local chain.
  - Check: the loop never crashes; nonces stay consistent; retries back off; auto-pause triggers on low balance.
- [ ] **7.4 Report:** `docs/LOADTEST.md` with the commands, numbers and findings. Fix anything it finds (and add a regression test).

## Testing rule for every step (Sayan, 2026-11-06)

A step is ticked only when:
- its own tests pass, **and** the whole suite still passes (`forge test` + `pnpm -r test`);
- edge cases from the spec are covered;
- no test was weakened.

Record the test counts in the commit message body.

## Out of scope for this loop

- Frontend pages (teammate, P10).
- README memo / FEEDBACK.md (P12): after the backend is done.
- Pushing (Sayan says when).
- The actual testnet deployment (needs Sayan's keys; step 3.3).
