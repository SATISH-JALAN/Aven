# Aven — Claude Code Build Prompts (ETHGlobal Mumbai 2026)

**Aven:** a Uniswap v4 fee library and hook on HyperEVM that prices every swap from Hyperliquid's in-block perp market, so LPs stop losing money to arbitrageurs. No oracle operator, keeper, model, owner, upgrade path or custody.

**Positioning:** Uniswap's own `VolatilePairHook` learns from the pool's past; Aven reads the market's present. `AvenHook` implements Uniswap's `IDynamicFeeHook`, so anything that quotes Uniswap's dynamic-fee hooks can quote Aven.

**Deadline:** Saturday Nov 7, 09:00 IST. Track: Uniswap Foundation + finalist judging.

**Normative design:** `AVEN_ARCHITECTURE.md` (copied to `docs/spec/ARCHITECTURE.md` in P0). Section numbers below (§) refer to it. Where this file and the architecture disagree, **the architecture wins**.

---

## How to use this file

1. Put this file and `AVEN_ARCHITECTURE.md` in an empty `aven/` folder, `git init`, and open Claude Code there.
2. Run the prompts **in order, one at a time**. After each: read the diff, run the tests yourself, then let it commit. Don't start the next prompt until its **Gate** passes.
3. Every prompt you send gets appended to `docs/ai/PROMPTS.md` (P0 sets this up). ETHGlobal requires AI attribution and all spec, prompt and planning files in the repo.
4. Claude Code must never guess an external API. If unsure, it checks installed sources or docs and records the answer in `docs/recon.md`.
5. **Already ran P0–P3 with the older version of this file?** Run prompt **M** (migration) first, then continue from P4.

**Suggested timing (≈34h from Thu 22:30):**

| When | Prompts |
|---|---|
| Thu night | P0, P1, P2 |
| Fri early morning | P3 |
| Fri morning | P4, P5 |
| Fri midday | P6, P7 |
| Fri afternoon | P8, P9 |
| Fri evening | P10 |
| Fri night | P11, P12 |
| Sat early → 09:00 | P13, video, submit |

**Cut order if late:** Replay share card → third replay scenario → "try it yourself" swap panel → fork-read test. **Never cut** the hook's named tests (§9), Arena, or verify.

---

# PART A — Prompts

## P0 — Bootstrap the repo and ground rules

```
You are building "Aven" for ETHGlobal Mumbai 2026 (Uniswap track). Read AVEN_ARCHITECTURE.md fully (it is the normative design), then this prompts file (aven-claude-code-prompts.md, Part B appendices). Don't write contract or app code in this step.

Tasks:
1. Create a pnpm monorepo with the layout in Appendix B1: contracts/ (Foundry), packages/core/, services/arena/, apps/web/, data/{raw,replay,vectors,arena}/, docs/{spec,planning,ai}/.
2. Move AVEN_ARCHITECTURE.md to docs/spec/ARCHITECTURE.md and this prompts file to docs/planning/aven-claude-code-prompts.md. Copy Part B appendices B4-B7 verbatim into docs/spec/API.md, docs/spec/DATA.md, docs/spec/FRONTEND.md, docs/spec/TOOLS.md. B1-B3 only point to ARCHITECTURE.md; don't copy them.
3. Write CLAUDE.md at the repo root containing:
   - a one-paragraph product summary and the positioning line vs Uniswap's VolatilePairHook (§4)
   - "docs/spec/ARCHITECTURE.md is normative; read the relevant section before every task"
   - the invariants I1-I10 from §6.6, verbatim
   - design rules that must never be broken: every beforeSwap return sets OVERRIDE_FEE_FLAG (dynamic pools start at LP fee 0, §2.3); hook permissions are beforeInitialize + beforeSwap only (address low bits 0x2080); precompile reads are non-reverting and gas-capped (§3.2); fee math is integer-only and identical in Solidity and TypeScript; no owner, setters, proxy, receive or token handling in the hook
   - hard scope rules: no perp hedging, no CoreWriter calls, no custody, no admin keys, no extra sponsor integrations, never hard-code demo numbers in live views, never guess external APIs (record findings in docs/recon.md)
   - workflow: small commits after each passing step, conventional commit messages, run tests before committing, never weaken a test to make it pass
   - AI attribution: append every user prompt verbatim to docs/ai/PROMPTS.md with a timestamp; keep docs/ai/ATTRIBUTION.md listing which files AI wrote or helped with
4. Create docs/ai/PROMPTS.md (entry #0 = this prompt), docs/ai/ATTRIBUTION.md (table: file | written by | notes), docs/recon.md (template with the headings from P1).
5. Root files: .gitignore (node_modules, out, cache, broadcast, .env*), .env.example with placeholders only (DEPLOYER_PK, BOT_PK, SHOCK_PK, HYPEREVM_RPC=https://rpc.hyperliquid-testnet.xyz/evm, HL_INFO_API_TESTNET=https://api.hyperliquid-testnet.xyz/info, HL_INFO_API_MAINNET=https://api.hyperliquid.xyz/info, ARENA_ADMIN_TOKEN, ARENA_CORS_ORIGINS, NEXT_PUBLIC_ARENA_API, NEXT_PUBLIC_RPC, NEXT_PUBLIC_CHAIN_ID=998), LICENSE (MIT), README stub.
6. If docs/planning/ contains a pre-event handoff file, add at its top: "Written before kickoff; ideas and specs only, no code."

Commit: "chore: bootstrap Aven monorepo, specs and AI attribution".
```

**Gate:** tree matches B1; `docs/spec/ARCHITECTURE.md` exists; CLAUDE.md lists I1–I10; nothing secret committed.

---

## P1 — Recon and toolchain: confirm every external fact

```
Read CLAUDE.md and docs/spec/ARCHITECTURE.md §2, §3, §11. The architecture already states what upstream code and docs say; your job is to CONFIRM each fact in our installed versions and on the live chain, and record the evidence (file path + line, doc URL, or cast/RPC output) in docs/recon.md. Mark anything unconfirmed as UNVERIFIED with a fallback. Do not guess.

A. Dependencies and toolchain (contracts/):
   - forge init (no template contracts); install and pin: Uniswap/v4-core (tag v4.0.0 or the latest commit if needed for PoolOperation.sol), Uniswap/v4-periphery, OpenZeppelin/uniswap-hooks (v1.3.x), foundry-rs/forge-std. Optional, tests only: hyperliquid-dev/hyper-evm-lib.
   - foundry.toml per §11.2: solc 0.8.26, evm_version cancun, our code optimizer_runs 200 / via_ir false; remappings @uniswap/v4-core/, @uniswap/v4-periphery/, @openzeppelin/uniswap-hooks/, forge-std/. rpc_endpoints: hyperevm_testnet, hyperevm_mainnet. fs_permissions for data/ and contracts/deployments/.
   - Confirm and record: BaseHook path @openzeppelin/uniswap-hooks/src/base/BaseHook.sol and the exact _beforeInitialize/_beforeSwap signatures; SwapParams in v4-core src/types/PoolOperation.sol; LPFeeLibrary DYNAMIC_FEE_FLAG=0x800000, OVERRIDE_FEE_FLAG=0x400000, MAX_LP_FEE=1_000_000; Hooks BEFORE_INITIALIZE_FLAG=1<<13, BEFORE_SWAP_FLAG=1<<7; that Hooks.beforeSwap only reads the fee for dynamic-fee pools and Pool.swap only uses it when the override flag is set; HookMiner location (v4-periphery test/shared/HookMiner.sol; if the remapping is awkward, vendor a copy into contracts/test/utils with its license header); Deployers/PoolSwapTest/PoolModifyLiquidityTest paths.
   - PoolManager build: can we compile v4-core's PoolManager with v4-core's own profile (via_ir true, optimizer_runs 44444444) alongside our code (additional_compiler_profiles or a separate build)? Record `forge build --sizes` for PoolManager (must be < 24,576 bytes).
   - Copy Uniswap's IDynamicFeeHook interface (§2.5) into contracts/src/interfaces/IDynamicFeeHook.sol with an MIT header and a source link.

B. HyperEVM testnet (chain 998, https://rpc.hyperliquid-testnet.xyz/evm) using cast:
   - eth_chainId, latest block, base fee; confirm the RPC has no websocket (we will poll)
   - eth_getCode of the CREATE2 deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C
   - is a Uniswap v4 PoolManager deployed on 998? (Uniswap's deployments page lists 999 only: mainnet PoolManager 0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F.) If none on 998, record "deploy our own"
   - big blocks: exact steps to send {"type":"evmUserModify","usingBigBlocks":true} for our deployer and to switch back; the deployer must first be a HyperCore user (receive USDC on Core)
   - a testnet block explorer URL that shows HyperEVM txs and logs

C. HyperCore reads:
   - info API {"type":"meta"} on testnet AND mainnet: HYPE perpIndex (position in universe) and szDecimals
   - cast call 0x...080a (perpAssetInfo) with abi.encode(uint32 perpIndex) on testnet: decode (string coin, uint32 marginTableId, uint8 szDecimals, uint8 maxLeverage, bool onlyIsolated); confirm coin == "HYPE" and szDecimals matches meta
   - cast call 0x...0807 (oraclePx) and 0x...0806 (markPx) with abi.encode(uint32 perpIndex); convert raw / 10^(6 - szDecimals); compare with the info API (allMids / metaAndAssetCtxs). Record both values with timestamps.
   - measure gas of one oraclePx eth_call (estimateGas) to confirm the precompile cost formula 2000 + 65*(in+out)

D. A tiny offline Foundry test (contracts/test/recon/Recon.t.sol) that etches a stub at 0x0806/0x0807 and reads it, proving the mock plan works without a fork. Optionally a fork-read test using vm.rpc("eth_call", ...) against hyperevm_testnet (the hyper-evm-lib RealL1Read pattern, §3.5), skipped unless FORK_READ=1.

Output: docs/recon.md filled in, ending with a "Decisions" section: BaseHook source, PoolManager (deploy own or existing), hook deployer (CREATE2 proxy or our own factory), PoolManager build approach, HYPE perpIndex + szDecimals on testnet and mainnet. Commit: "docs: recon of v4, HyperCore precompiles and HyperEVM testnet".
```

**Gate:** you read the HYPE oracle and mark price from the testnet precompiles, and after scaling they match the info API. If not, stop and fix before P2.

---

## P2 — The product: `AvenFairValue` library

```
Read CLAUDE.md, docs/spec/ARCHITECTURE.md §2.3, §3.2, §6.2-§6.4, and docs/recon.md.

Implement contracts/src/AvenFairValue.sol exactly per §6.2-§6.4:
- constants MARK_PX (0x806), ORACLE_PX (0x807), Q96
- types Config, Params, Inputs, Reason {OK, READ_FAILED, GAP_TOO_LARGE}, Breakdown
- defaultParams() with the §6.2 defaults; validateParams(Config, Params) enforcing every constructor rule in §6.2 (reverts InvalidParams)
- readPrices(perpIndex, gasCap) returns (bool readOk, uint64 oracleRaw, uint64 markRaw): each staticcall forwards exactly gasCap; never reverts; readOk rules from §6.3 Step 1
- oracleWad(cfg, raw) = raw * 10^(12 + szDecimals)
- poolWad(cfg, sqrtPriceX96): both baseIsToken0 branches with the exact mulDiv order from §6.3 Step 3 (FullMath from v4-core)
- compute(cfg, params, inputs) -> Breakdown: Steps 2-8 in order (fallback on !readOk; gap with top-of-block anchor; GAP_TOO_LARGE; direction; premium; stress vs anchor; combine and clamp in uint256)
- advanceAnchor(anchorMark, anchorTime, markRaw, nowTs, tau) -> (newMark, newTime) per §6.4 step 5 (signed math, truncation toward zero)

Tests in contracts/test/unit/AvenFairValue.t.sol:
- the §6.3 worked example (seller = 9,000 pips, buyer = 500 pips), and each signal alone
- direction matrix for baseIsToken0 true and false (sell/buy × above/below fair)
- top-of-block: same side -> max(gapCur, gapTop); opposite side -> gapCur; pool exactly at fair -> arb false
- clamps at floor and ceiling; READ_FAILED and GAP_TOO_LARGE return fallbackFee with the right Reason
- scaling: a known raw price with szDecimals 0, 2 and 5; poolWad round-trip for decimals 18/6 (base token0) and 6/18 (base token1)
- anchor: first update snaps to mark; dt = 0 unchanged; dt >= tau snaps; partial dt moves by (mark-anchor)*dt/tau
- validateParams: each rule rejects a bad value
- fuzz: for bounded inputs (document the bounds), compute never reverts and fee is in [minFee,maxFee] or == fallbackFee with reason != OK

NatSpec every function with the § it implements. Update docs/ai/ATTRIBUTION.md. forge fmt && forge test -vv. Commit: "feat(contracts): AvenFairValue library with unit and fuzz tests".
```

**Gate:** all tests pass; you can explain every expected number in the worked example.

---

## P3 — `MockHyperCorePx`, `AvenHook` and v4 integration tests

```
Read CLAUDE.md, docs/spec/ARCHITECTURE.md §2.2-§2.5, §6.4-§6.6, §8.1, §9, §10, and docs/recon.md.

1. contracts/test/mocks/MockHyperCorePx.sol: fallback(bytes) decodes abi.encode(uint32 index) and returns abi.encode(uint64 price[index]); set(uint32 index, uint64 price); setFail(bool) to revert; setBurn(bool) to loop until out of gas (tests the gas cap); setEmpty(bool) to return no data. A base test (contracts/test/utils/AvenTestBase.sol) etches separate instances at 0x...0806 and 0x...0807 and exposes setOracle/setMark helpers.

2. contracts/src/interfaces/IAvenHook.sol per §6.5: extends IDynamicFeeHook; FeeComputed event (exact field order from §8.1); errors MustUseDynamicFee, WrongCurrencies, InvalidParams; getFee, previewFee, poolState, config, params.

3. contracts/src/AvenHook.sol (OpenZeppelin uniswap-hooks BaseHook) per §6.4-§6.5:
   - getHookPermissions: beforeInitialize = true, beforeSwap = true, everything else false
   - constructor(IPoolManager, AvenFairValue.Config, AvenFairValue.Params, Currency base, Currency quote): AvenFairValue.validateParams + currency/baseIsToken0 consistency; store everything as immutables (unpack structs into immutable fields); no owner, setters, proxy, receive or token handling
   - PoolState {topBlock, sqrtPriceTopX96, anchorMark, anchorTime, initialized} in 2 storage slots; mapping(PoolId => PoolState)
   - _beforeInitialize: revert MustUseDynamicFee unless key.fee == DYNAMIC_FEE_FLAG; revert WrongCurrencies unless {currency0, currency1} == sorted(base, quote); set initialized
   - _load(PoolId) internal view: getSlot0 -> advance top-of-block in memory -> readPrices -> compute -> advance anchor in memory (only if readOk). Returns (newState, inputs, breakdown)
   - _beforeSwap: _load -> write state -> emit FeeComputed -> return (IHooks.beforeSwap.selector, ZERO_DELTA, fee | OVERRIDE_FEE_FLAG). ALWAYS set the flag, including fallback.
   - getFee(key) (both directions) and previewFee(key, zeroForOne) use _load only; revert PoolNotInitialized for unknown pools

4. contracts/test/integration/AvenHook.t.sol using v4-core Deployers (deployFreshManagerAndRouters, initPool, modifyLiquidityRouter, swapRouter) and either deployCodeTo or HookMiner to place the hook at an address with low bits 0x2080. Set up an Aven pool (fee 0x800000, hook) and a control pool (fee 3000, no hook) with identical liquidity. Implement EVERY required named test from §9:
   test_splitSwapSameBlock_paysTopOfBlockGap, test_dustSwap_doesNotResetStress, test_precompileRevert_chargesFallback, test_precompileBurnsGas_capped, test_wrongPair_cannotInitialize, test_staticFeePool_cannotInitialize, test_previewEqualsCharged_bothDirections, test_overrideFlagAlwaysSet, test_sandwichBackLeg_paysGapFee
   plus: arb direction pays more than reverse in the same state; PoolManager Swap event `fee` == FeeComputed fee (protocol fee 0); getFee == previewFee for both directions; vm.roll/vm.warp used to cross blocks; beforeSwap gas logged with gasleft deltas.

Commit after mocks, after interfaces + hook, after integration tests.
```

**Gate:** `forge test` green, including all nine named tests.

---

## M — Migration (only if P2/P3 were built on the older spec)

```
docs/spec/ARCHITECTURE.md (from AVEN_ARCHITECTURE.md) is now normative. Copy it into docs/spec/ if missing and update CLAUDE.md per P0 step 3.
Diff our AvenFairValue and AvenHook against §6.2-§6.6 and list every difference first. Then update code and tests to match, including: Inputs/Reason types; validateParams; top-of-block gap anchor (§6.3 Step 4); time-weighted mark anchor replacing any lastMark/prevMark logic (§6.4); FeeComputed fields (§8.1); IDynamicFeeHook.getFee; the beforeInitialize currency check; OpenZeppelin uniswap-hooks BaseHook; override flag on every return; the nine named tests in §9. Don't change the spec; ask me if something in it seems wrong.
```

---

## P4 — Proof #1: Solidity ↔ TypeScript differential test + `packages/core`

```
Read docs/spec/ARCHITECTURE.md §6.3, §6.4, §7.1, §7.3, §8 and docs/spec/DATA.md.

1. packages/core (TypeScript strict, ESM, viem, vitest):
   - src/fee.ts: line-for-line BigInt port of oracleWad, poolWad, compute (Steps 1-8). mulDiv(a,b,d) = (a*b)/d on BigInt. No floats anywhere in fee math.
   - src/state.ts: port of advanceAnchor and the top-of-block rule
   - src/abi.ts: AvenHook + PoolManager ABIs generated from contracts/out (a script, not hand-written); FeeComputed and Swap events
   - src/precompiles.ts: readOracleMark(client, perpIndex) via eth_call to 0x806/0x807; readPerpAssetInfo; display-only float helpers
   - src/addresses.ts: loads contracts/deployments/<chainId>.json (schema §8.3) with zod validation
   - src/verify.ts per §7.3: for a tx, decode each FeeComputed and its matching PoolManager Swap log (same PoolId); rebuild Inputs (readOk = reason != READ_FAILED); recompute; check A (recomputed == event.fee); check B (Swap.fee == calculateSwapFee(protocolFee, event.fee), which equals event.fee when protocol fee is 0). Return {match, checkA, checkB, onchainFee, recomputedFee, swapEventFee, inputs, breakdown}.
2. Differential vectors: contracts/test/vectors/GenVectors.t.sol (vm.writeJson, fixed seed) generating 10,000 valid input sets for compute (covering both baseIsToken0 cases, decimals 18/6 and 6/18, exact thresholds, clamp edges, both fallback reasons, top-of-block same/opposite side) plus 2,000 advanceAnchor cases. Write inputs and Solidity outputs to data/vectors/fee-vectors.json and data/vectors/anchor-vectors.json.
3. packages/core/test/differential.test.ts: assert the TS port matches every fee and every Breakdown field, and every anchor output, exactly.
4. Root scripts: "pnpm abi" (regenerate ABIs) and "pnpm prove:diff" (regenerate vectors, run the TS test).

Commit: "feat(core): TS fee port and Solidity-TS differential proof (10k vectors)".
```

**Gate:** 10,000/10,000 fee vectors and 2,000/2,000 anchor vectors match.

---

## P5 — Testnet deployment and smoke run

```
Read docs/recon.md (Decisions), docs/spec/ARCHITECTURE.md §2.6, §3.1, §8.3, §11.3.

Foundry scripts in contracts/script/ (keys from .env, never printed), following the §11.3 flowchart:
1. DeployCore.s.sol: if recon says no PoolManager on 998, deploy v4-core PoolManager (built with v4-core's profile per recon) + PoolSwapTest + PoolModifyLiquidityTest. Header comment + console output: the exact evmUserModify big-block step to run first, and how to switch back after.
2. DeployTokens.s.sol: MockERC20 "Aven HYPE" (aHYPE, 18 dec) and "Aven USD" (aUSD, 6 dec); mint to deployer, bot and shock wallets; approve both routers.
3. DeployAven.s.sol:
   - read perpAssetInfo(perpIndex) via the precompile; require coin == "HYPE" and record szDecimals
   - sort currencies; derive baseIsToken0, decimals0/1 from the tokens
   - mine a salt with HookMiner for flags BEFORE_INITIALIZE_FLAG | BEFORE_SWAP_FLAG (0x2080) using the deployer chosen in recon; deploy AvenHook(poolManager, config, defaultParams(), base, quote) with that salt; require the address matches
4. CreatePools.s.sol: read oraclePx; compute sqrtPriceX96 from the oracle price for our token order and decimals (inverse of §6.3 Step 3; add a unit test that poolWad(sqrtP) is within 1 bp of oracleWad); initialize (a) Aven pool {fee 0x800000, tickSpacing 60, hooks AvenHook} and (b) control pool {fee 3000, tickSpacing 60, hooks 0}; add identical full-width liquidity (same tick range, e.g. ±50% around price rounded to tickSpacing, same amounts).
5. Smoke.s.sol: one exact-input swap each direction on both pools (negative amountSpecified); print fees and tx hashes.
6. Write contracts/deployments/998.json exactly per §8.3 (including hookSalt and deployedAtBlock).

Give me the exact commands to run, in order. After I run them, run `pnpm --filter core verify <smokeTx>` and record tx links in docs/DEPLOYMENTS.md. Commit per script.
```

**Gate:** both pools live on testnet; the Aven smoke swap emits `FeeComputed`; verify shows MATCH on both checks A and B.

---

## P6 — Proof #2: Arena service (live bot, shock, API)

```
Read docs/spec/ARCHITECTURE.md §7.2, docs/spec/API.md, docs/spec/DATA.md and CLAUDE.md.

Build services/arena (Node 20, TypeScript, Hono, viem, zod; uses packages/core). One process, three loops (§7.2):
1. Block poller every ~500 ms via eth_blockNumber (the official RPC has no websockets).
2. Bot loop, once per new block while enabled, for each pool (control, aven):
   - read oracleRaw (precompile eth_call) and sqrtPriceX96 (StateLibrary/extsload or StateView equivalent)
   - skip if |gap| < 1 bp; direction = sell base if pool above fair, buy base if below
   - quote fee f: control = 3000 pips; aven = hook.previewFee(key, zeroForOne).fee
   - target p* = oracle/(1-f) when selling base, oracle*(1-f) when buying; convert to sqrtPriceLimitX96 for our token order and decimals
   - exact-input swap (negative amountSpecified, capped by MAX_TRADE) with that limit via PoolSwapTest from the BOT wallet; eth_call first and send only if value(out) - value(in) - gasCost > 0, all valued at oracle
   - on receipt: record a Trade (B4/B5) including feePips, LP fee income = amountIn*feePips/1e6 valued at oracle, bot profit, txHash; for aven decode FeeComputed and attach the Breakdown (with reason) and the verify result
3. SSE broadcaster for state, trade, shock and bot events.
Also:
- Shock (src/shock.ts): one identical exact-input swap of the same size and direction on both pools from the SHOCK wallet. On Aven this is a non-arb move and should pay near the base fee; record a Shock.
- Stats: per pool trades, botProfitUsd, lpFeeIncomeUsd, volumeUsd; lpKeptMoreUsd = aven.lpFeeIncome - control.lpFeeIncome over bot trades since last reset; botProfitDiffUsd.
- Persistence: append to data/arena/trades.jsonl; reload on start.
- HTTP exactly per API.md (B4), including GET /config. POST routes require x-admin-token; CORS allowlist from ARENA_CORS_ORIGINS; rate-limit POSTs.
- Robustness: nonce manager per wallet; retry with backoff; the loop never crashes; MAX_TRADE cap; auto-pause below a balance threshold; modest priority fee (priority fees are burned on HyperEVM).
- Scripts: pnpm arena:dev, pnpm arena:start; README section on running it on my laptop with cloudflared (Vercel can't host the loop).

Tests (vitest): direction choice, p* and sqrtPriceLimit conversion for both token orders, profit accounting, stats math, all with fixtures. Commit in steps.
```

**Gate:** shock → bot trades both pools → for the same gap the Aven trade pays a higher fee than the control trade → `/stats` shows `lpKeptMoreUsd > 0` → `/verify/:tx` returns MATCH (A and B).

---

## P7 — Market data for the replay

```
Read docs/spec/ARCHITECTURE.md §3.4 and §7.5, and docs/spec/DATA.md.

scripts/fetch-market-data.ts (scripts/ workspace):
- Hyperliquid MAINNET info API (HL_INFO_API_MAINNET).
- Scenario windows (UTC), configurable in scripts/scenarios.json:
  A "binance-halt": 2026-10-29 18:00 → 2026-10-30 00:00 (theft began 20:05 UTC)
  B "calm": default 2026-10-25 06:00 → 12:00
  C "volatile-2": I'll pick; leave a placeholder
- candleSnapshot for HYPE at 1m, paging by last candle close + 1 ms. If 1m data for the window is unavailable or incomplete, fall back to 5m and record the interval in the output.
- fundingHistory for HYPE over the window (premium series).
- Save raw responses to data/raw/<scenario>/ and normalized.csv per DATA.md: timestamp, markClose, premium (forward-filled), oracleProxy = markClose / (1 + premium), interval.
- Print missing intervals. Write data/raw/README.md: source, endpoints, download time, the oracle-proxy approximation and its limits (§13).

Commit: "data: fetch Hyperliquid market data for replay scenarios".
```

**Gate:** normalized CSVs for scenarios A and B (C if chosen) with no unexplained gaps.

---

## P8 — Proof #3: replay engine

```
Read docs/spec/ARCHITECTURE.md §6.3, §6.4, §7.4 and docs/spec/DATA.md.

contracts/test/replay/Replay.t.sol (offline, MockHyperCorePx), driven by pnpm replay:<scenario>:
- A pre-step converts normalized.csv to JSON for vm.parseJson.
- Deploy a local PoolManager and FOUR pools with identical liquidity, range and starting price (§7.4):
  1. fixed 500   2. fixed 3000
  3. Aven-delayed: a second AvenHook with perpIndex = 1; the mock serves index 1 with prices lagged 60 s
  4. Aven-live: AvenHook with perpIndex = 0, current prices
  (Both hooks need distinct mined addresses with low bits 0x2080; use deployCodeTo.)
- Each step: vm.warp to the candle timestamp and vm.roll +1 so top-of-block and anchor logic behave as on chain; set mock prices (oracle = oracleProxy, mark = markClose; lagged for index 1); then
  a) arb agent per pool, same algorithm as the Arena bot (§7.2): quote the fee (fixed or previewFee), compute p*, swap exact-input toward it; vm.snapshotState/revertToState to discard trades not profitable at oracle
  b) seeded retail agent: the same pseudo-random sequence of small swaps on every pool
- LP accounting (one position per pool): principal via LiquidityAmounts at the current sqrtPrice; fees collected by poking the position (liquidityDelta 0) each step; LP value = principal + cumulative fees at oracle; HODL = initial tokens at oracle; LVR = HODL - LP value (and % of HODL).
- Outputs: data/replay/<scenario>.csv (one row per pool per step, columns per DATA.md) and <scenario>.summary.json; scripts/replay-to-web.ts writes apps/web/public/replay/<scenario>.json (downsampled).
- data/replay/README.md: method, parameters, oracle-proxy limitation, how to rerun.

Sanity tests: zero price movement -> pools differ only by retail fees; check a few steps by hand. Report results honestly; do NOT tune params to force a result. If Aven-live doesn't beat fixed 3000 in scenario A, tell me and show why.
Commit per step.
```

**Gate:** summaries for every fetched scenario; a few steps hand-checked; method documented.

---

## P9 — Verify CLI and proof report

```
Read docs/spec/ARCHITECTURE.md §7.3 and §9.

- packages/core/bin/verify.ts: `pnpm verify <txHash>` prints inputs, every Breakdown field, on-chain fee, recomputed fee, Swap event fee, and MATCH/MISMATCH for checks A and B. `pnpm verify --all` scans FeeComputed logs from deployedAtBlock in chunks and prints totals (count, A matches, B matches, mismatches with tx hashes).
- `pnpm proofs` runs: forge test (with the list of the nine named tests and their status), forge test --gas-report (beforeSwap gas), prove:diff, verify --all on testnet; writes docs/PROOFS.md with results, counts, timestamps, commit hash and reproduce commands.

Commit: "feat(core): verify CLI and proofs report".
```

**Gate:** `verify --all` = 100% MATCH on checks A and B for every live swap.

---

## P10 — Frontend (apps/web)

```
Read docs/spec/FRONTEND.md, docs/spec/API.md and docs/spec/ARCHITECTURE.md §7.6. Build apps/web: Next.js (App Router), TypeScript, Tailwind, wagmi + viem (custom chain 998), TanStack Query (polling), EventSource (SSE), TradingView lightweight-charts (Arena), Recharts (Replay), qrcode.

Implement every MUST item in FRONTEND.md, in this order: layout + theme → Arena read-only (/config, /state, /stats, /trades, /stream) → Arena admin controls → Verify drawer → Replay → Home → empty/error/offline states → mobile pass.

Rules: every number shows its source label (hook event, oracle precompile, replay); a "Live testnet", "Replay" or "Recorded run" badge on every view; no hard-coded demo numbers (offline → public/arena-fallback.json, clearly labelled "Recorded run"); fee chips show base · gap · premium · stress, plus a red "fallback" badge when reason != OK; dark theme; teal = normal, amber = stress; monospaced numbers.

Deploy to Vercel with NEXT_PUBLIC_ARENA_API, NEXT_PUBLIC_RPC, NEXT_PUBLIC_CHAIN_ID=998. Commit per page.
```

**Gate:** works on your phone via the Vercel URL; Arena updates live while the bot runs; the Verify drawer shows MATCH.

---

## P11 — Hardening: invariants, gas, security review

```
Read docs/spec/ARCHITECTURE.md §6.6, §6.7, §9, §10.

1. contracts/test/invariant/AvenInvariant.t.sol with a handler doing random swaps (both pools, both directions, exact-in and exact-out within limits), price moves, precompile failures/burns/empty returns, vm.warp and vm.roll. Assert I1, I2, I4 and I9 (and I3 via Swap.fee != 0 on the Aven pool).
2. Confirm every named test in §9 exists and passes; add any missing.
3. forge snapshot + forge test --gas-report; compare beforeSwap gas to the §6.7 estimate and record it in docs/PROOFS.md.
4. docs/SECURITY.md from §10: trust assumptions, the threat table with the test that covers each row, testnet caveat, known limitations (§13).
5. slither (if available) on contracts/src; record findings and dispositions.

Commit: "test: invariants, gas report and security notes".
```

**Gate:** invariant run green at the default depth; SECURITY.md maps every threat to a test or a stated limitation.

---

## P12 — README (engineering memo), FEEDBACK.md, attribution

```
Read docs/spec/ARCHITECTURE.md §1, §4, §5, §6.3, §9, §10, §13 and docs/PROOFS.md.

Write README.md as an engineering memo for sponsor judges (they only read the submission):
1. One-liner + the 20-second problem (LVR; the Oct 29 Binance halt)
2. What Aven is and is not (§1.3, §1.4)
3. Why it's different: the §4 comparison table (fixed fee, push-oracle fees, Uniswap's own VolatilePairHook, OniBlock, KyberSwap FairFlow), only with claims you can source and link; the zero-trust price path; AvenHook implements Uniswap's IDynamicFeeHook
4. Architecture (mermaid from §5.1 and the §6.5 sequence diagram) and the pricing model with the worked example
5. Integration: a ~10-line snippet of another hook importing AvenFairValue
6. Proofs: the nine named tests, invariants, 10k differential vectors, verify --all results, gas, replay results per scenario with method and limitations (link docs/PROOFS.md)
7. Live: Vercel URL + QR, testnet addresses, explorer links, tx links (pool inits, a taxed bot trade, its verify output)
8. Where the Uniswap integration lives: file paths and line numbers for AvenHook._beforeSwap, getFee, previewFee, AvenFairValue.compute
9. What was hard, what's hacky, what doesn't work yet, what's next (§13)
10. AI attribution (link docs/ai/ATTRIBUTION.md and PROMPTS.md) and the pre-event planning disclosure
Also write FEEDBACK.md for Uniswap (honest: what worked, friction with v4 on HyperEVM such as no testnet PoolManager, BaseHook moving out of v4-periphery, HookMiner path) and remind me to submit https://developers.uniswap.org/hackathon-feedback with the FEEDBACK.md link.

Commit: "docs: README memo, FEEDBACK.md and attribution".
```

---

## P13 — Demo rehearsal support

```
Read docs/spec/ARCHITECTURE.md §12.

1. scripts/demo.ts: POST /reset-stats, wait for the bot to be idle, trigger one shock, let the bot trade both pools, print a one-screen summary (fees, bot profit per pool, lpKeptMoreUsd, a verify result), and save the run to apps/web/public/arena-fallback.json.
2. docs/DEMO.md: my 4-minute live script (Problem 25s, Insight 25s, Arena live 90s, Replay 45s, Integration and IDynamicFeeHook 35s, Close 20s) with exact clicks; the fallback steps if the RPC is slow; and a 2-4 minute video shot list (720p+, my own voice, laptop screen recording, no speed-up, Arena sequence in real time).

Commit: "chore: demo script and fallback recording".
```

---

## Utility prompts

**Stuck / failing test**
```
This is failing: <paste error>. Don't change the spec or weaken tests. Find the root cause, explain it in 3 lines, propose the minimal fix, then apply it and rerun. If the cause is an external API fact, update docs/recon.md.
```

**Spec check (before any commit you're unsure about)**
```
Compare the change against docs/spec/ARCHITECTURE.md (cite §) and the invariants I1-I10. List any deviation. Don't change code.
```

**Scope check (when tempted to add features)**
```
Compare the repo to CLAUDE.md and docs/spec/*. List anything built that's not in spec, anything in spec not yet built, and the riskiest remaining item for the demo. Don't change code.
```

**Explain for the pitch**
```
Explain <file/function> in 5 plain sentences I can say to a judge, plus one likely judge question (e.g. "how is this different from Uniswap's VolatilePairHook?") and its answer.
```

---

# PART B — Spec appendices

## B1 — Architecture

Normative: `docs/spec/ARCHITECTURE.md`. Repo layout:
```
aven/
├─ CLAUDE.md  README.md  FEEDBACK.md  LICENSE  .env.example
├─ contracts/
│  ├─ src/AvenFairValue.sol  src/AvenHook.sol
│  ├─ src/interfaces/IAvenHook.sol  src/interfaces/IDynamicFeeHook.sol
│  ├─ test/{unit,integration,invariant,replay,vectors,recon,mocks,utils}/
│  ├─ script/{DeployCore,DeployTokens,DeployAven,CreatePools,Smoke}.s.sol
│  └─ deployments/998.json
├─ packages/core/      fee.ts state.ts abi.ts precompiles.ts addresses.ts verify.ts bin/verify.ts
├─ services/arena/     bot, shock, stats, HTTP + SSE
├─ apps/web/           Home, Arena, Replay
├─ scripts/            fetch-market-data.ts, replay-to-web.ts, demo.ts, scenarios.json
├─ data/{raw,replay,vectors,arena}/
└─ docs/{spec,planning,ai}/  recon.md PROOFS.md SECURITY.md DEPLOYMENTS.md DEMO.md
```

## B2 — Fee spec

Normative: §6.2–§6.4 (types, defaults, constructor validation, the 8-step pricing model with the top-of-block gap anchor, the time-weighted mark anchor, the worked example).

## B3 — Contract interfaces

Normative: §6.5–§6.6 (permissions 0x2080, `IAvenHook` extends Uniswap's `IDynamicFeeHook`, errors, invariants I1–I10) and §8.1 (event layouts).

## B4 — API (services/arena)

Base URL: `NEXT_PUBLIC_ARENA_API`. JSON. POST routes need header `x-admin-token`.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ok, chainId, block, botEnabled, version}` |
| GET | `/config` | `{chainId, hook, poolManager, pools:{aven, control}, config, params, explorer}` |
| GET | `/state` | `{block, ts, oracle:{raw, price}, mark:{raw, price}, pools:{control: PoolState, aven: PoolState}}` |
| GET | `/stats` | `{since, control: PoolStats, aven: PoolStats, lpKeptMoreUsd, botProfitDiffUsd}` |
| GET | `/trades?limit=50&pool=aven\|control` | `Trade[]`, newest first |
| GET | `/bot/status` | `{enabled, lastRunBlock, lastError, balances}` |
| GET | `/verify/:tx` | `VerifyResult` |
| GET | `/stream` | SSE events: `state`, `trade`, `shock`, `bot` |
| POST | `/shock` `{sizeBase?, direction?}` | `Shock` |
| POST | `/bot/start` · `/bot/stop` | `{enabled}` |
| POST | `/reset-stats` | `{since}` |

```ts
type Reason = "OK" | "READ_FAILED" | "GAP_TOO_LARGE";
type Breakdown = { fee: number; reason: Reason; gapBps: number; premiumBps: number; moveBps: number;
  arb: boolean; withPressure: boolean };
type PoolState = { poolId: string; price: number; gapBps: number; liquidity: string;
  feePreview: { buyBase: Breakdown; sellBase: Breakdown } | { fixedPips: 3000 };
  hookState?: { topBlock: number; sqrtPriceTopX96: string; anchorMark: string; anchorTime: number } };
type PoolStats = { trades: number; botProfitUsd: number; lpFeeIncomeUsd: number; volumeUsd: number };
type Trade = { id: string; ts: number; block: number; pool: "aven" | "control"; kind: "arb" | "retail";
  direction: "buyBase" | "sellBase"; amountIn: string; amountOut: string; feePips: number;
  feeUsd: number; botProfitUsd: number; lpFeeIncomeUsd: number; txHash: string;
  breakdown?: Breakdown; verify?: { checkA: boolean; checkB: boolean } };
type Shock = { id: string; ts: number; sizeBase: string; direction: string; txHashes: string[] };
type VerifyResult = { match: boolean; checkA: boolean; checkB: boolean; onchainFee: number;
  recomputedFee: number; swapEventFee: number; inputs: Record<string, string>; breakdown: Breakdown };
```

## B5 — Data formats

- `contracts/deployments/998.json`: exactly §8.3.
- `data/arena/trades.jsonl`: one `Trade` or `Shock` per line.
- `data/raw/<scenario>/normalized.csv`: `timestamp,markClose,premium,oracleProxy,interval`
- `data/replay/<scenario>.csv`: `step,timestamp,pool,poolPrice,oracle,mark,feePips,reason,lpValueUsd,hodlValueUsd,lvrUsd,lvrPct,feesCumUsd,arbTrades,retailTrades`; `pool ∈ {fixed05, fixed30, avenDelayed, avenLive}`
- `data/replay/<scenario>.summary.json`: final values per pool, parameters, interval, method notes
- `data/vectors/fee-vectors.json`: `[{inputs:{cfg, params, oracleRaw, markRaw, anchorMarkRaw, sqrtPriceX96, sqrtPriceTopX96, zeroForOne, readOk}, expected: Breakdown}]`
- `data/vectors/anchor-vectors.json`: `[{inputs:{anchorMark, anchorTime, markRaw, now, tau}, expected:{mark, time}}]`
- `apps/web/public/replay/<scenario>.json`: downsampled series + summary
- `apps/web/public/arena-fallback.json`: recorded Arena run (trades, stats, timestamps)

## B6 — Frontend features

**MUST**
- **Global:** Aven wordmark; nav (Home, Arena, Replay); network badge "HyperEVM testnet"; service status dot; dark terminal theme; teal = normal, amber = stress; monospaced numbers; a source label on every number; works at phone width.
- **Home:**
  - one-line pitch and the positioning line ("learns from the pool's past vs reads the market's present")
  - 3-sentence explainer (problem → in-block perp price → fee)
  - compact comparison: Fixed fee · Uniswap VolatilePairHook · Aven (signal source, trust, reacts)
  - "Implements Uniswap's IDynamicFeeHook" badge
  - integration snippet with copy button; contract addresses with explorer links; repo link
  - buttons to Arena and Replay
- **Arena:**
  - two pool cards (Plain 0.30% vs Aven): pool price, fair value (oracle), mark, gap bp, next-fee preview for buy and sell with chips (base · gap · premium · stress) and a fallback badge when reason ≠ OK
  - hero metric "LPs kept $X more", plus per-pool bot profit, LP fee income and trade count
  - price chart: control price, Aven price, oracle, mark
  - live trade tape (SSE): pool, direction, size, fee + chips, bot profit, tx link, verify badge
  - Verify drawer: inputs, on-chain vs recomputed vs Swap-event fee, checks A and B, MATCH badge, "verify it yourself" command
  - admin controls (only with `?admin=<token>`): Shock both pools, Start/Stop bot, Reset stats
  - offline fallback: the recorded run, clearly labelled "Recorded run"
- **Replay:** scenario picker (Binance halt Oct 29 / calm / volatile-2); Run → four animated LP-value lines vs HODL; results table per pool (LP value, fees earned, LVR $ and %, arb trades); method + limitations note; share link + QR code.
- **States:** loading skeletons, empty states, RPC/service errors with retry.

**NICE (only if time)**
- "Try it yourself" swap panel with wallet connect and live `previewFee` for both directions
- Shareable result card image for Replay
- Fee timeline mini-chart per pool

## B7 — Tools

| Area | Tool |
|---|---|
| Contracts | Solidity 0.8.26, `evm_version` cancun, Foundry (forge, cast, anvil, fmt, snapshot, fuzz, invariant) |
| Uniswap | `Uniswap/v4-core` (PoolManager, libraries, test routers, Deployers), `Uniswap/v4-periphery` (HookMiner in `test/shared`, LiquidityAmounts), `OpenZeppelin/uniswap-hooks` v1.3.x (BaseHook), local copy of `IDynamicFeeHook` from `Uniswap/v4-hooks-public` |
| HyperEVM | read precompiles 0x806/0x807/0x80a; testnet RPC; big-block toggle; `hyperliquid-dev/hyper-evm-lib` (tests only, optional fork-read pattern) |
| TS | Node 20, pnpm workspaces, TypeScript strict, viem, zod, vitest, tsx |
| Service | Hono, SSE, cloudflared tunnel |
| Web | Next.js (App Router), Tailwind, wagmi, TanStack Query, lightweight-charts, Recharts, qrcode |
| Data | Hyperliquid info API (meta, candleSnapshot, fundingHistory, allMids) |
| Analysis | slither (optional), forge gas report |
| Hosting | Vercel (web); laptop + cloudflared or a small VM (arena) |
