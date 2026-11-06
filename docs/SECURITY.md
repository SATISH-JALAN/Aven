# SECURITY.md — trust model, threats and the test behind each

Source: ARCHITECTURE §10 (trust model and threats), §6.6 (invariants) and §13 (limits). Every threat below maps to a test that covers it, or to a stated limitation. Test files:

- **Unit:** `contracts/test/unit/AvenFairValue.t.sol`
- **Integration:** `contracts/test/integration/AvenHook.t.sol` (runs for base = token0 and base = token1)
- **Invariant:** `contracts/test/invariant/AvenInvariant.t.sol`
- **Arena:** `backend/arena/test/server.test.ts`

Results with numbers: [PROOFS.md](PROOFS.md).

## 1. Trust assumptions (§10.1)

1. HyperCore's oracle and mark prices are produced honestly by the validator set. This is the same assumption as trusting the chain itself.
2. Uniswap v4-core is correct (multiple audits). Our testnet PoolManager is byte-identical to Uniswap's canonical HyperEVM mainnet build (recon A.5). **On mainnet (999) we use Uniswap's canonical PoolManager itself** (recon §E.2), which Uniswap governance owns; see §6.2 C-4.
3. Nothing else. There is no owner, keeper, signer, relayer, model or upgrade path in `AvenHook`/`AvenFairValue`. Our testnet PoolManager is deployed with `initialOwner = address(0)`, so no protocol fee can ever be switched on.

## 2. Threats (§10.2)

| Threat | Vector | Effect | Mitigation | Covered by |
|---|---|---|---|---|
| Oracle manipulation | Move the CEX spot median | Fee mis-set | Needs many venues (stake-weighted median); fee clamped at 1% | `test_clampAtCeiling`; `testFuzz_compute_neverRevertsAndI2` (I2); invariant `invariant_I2_feeClampedOrFallback` |
| Mark manipulation | Push a thin HyperCore book | Inflated premium or stress fee | Mark is a median that includes CEX perps; it can only *raise* fees (LP-favourable), and those are capped | `test_signalAlone_premium`, `test_signalAlone_stress`, `test_clampAtCeiling` |
| Split-arb in one block | Many small swaps | Lower fee per swap | Top-of-block gap anchor (§6.3 Step 4) | `test_splitSwapSameBlock_paysTopOfBlockGap` (+ mutation "top-of-block reset every swap" is caught) |
| Split-arb across blocks | Spread over seconds | Some fee reduction | **Accepted limitation** (§13): competing arbs take the first block. The next block anchors to the then-current price | Documented in `test_splitSwapSameBlock_paysTopOfBlockGap` (next-block fee is lower) |
| Stress griefing | Dust swap to reset the reference | Erase the stress fee | Time-weighted anchor (§6.4): same-second dust changes nothing; dt/tau otherwise | `test_dustSwap_doesNotResetStress`; anchor unit tests; `invariant_I9_anchorOnlyOnGoodReads` |
| Fee griefing of users | Push the pool off fair so retail pays more | Arb-direction users pay more | Whoever pushes pays to move the pool; arb-direction users also get a better-than-fair price; the reverse direction pays base | `test_arbDirectionPaysMoreThanReverse` |
| Sandwich | Front-run, then back-run a victim | MEV | Back leg closes a gap the attacker opened → classified arb → pays the gap fee | `test_sandwichBackLeg_paysGapFee` |
| Precompile failure | Invalid index, outage, revert, empty or oversized return, gas burn | Revert or gas burn | Non-reverting, gas-capped reads (32-byte buffer) → fallback fee | `test_precompileRevert_chargesFallback`, `test_precompileBurnsGas_capped`, `test_readPrices_failureModes`, `test_readPrices_burnIsCapped`; `invariant_I1_noSwapRevertsFromReads` |
| Wrong pool | Attach the hook to another pair | Mispriced pool | `beforeInitialize` currency check (I10) | `test_wrongPair_cannotInitialize` |
| Static-fee pool | Attach the hook to a fixed-fee pool | Override fee ignored | `beforeInitialize` requires `DYNAMIC_FEE_FLAG` (I10) | `test_staticFeePool_cannotInitialize` |
| Zero fee | Forgetting the override flag | Free swaps (a dynamic pool's stored LP fee is 0) | Always set the flag, including on fallback (I3) | `test_overrideFlagAlwaysSet` (+ mutation "no override flag" fails 5 tests); `invariant_I3_overrideFlagEverySwap` |
| Exact-out at 100% fee | Fee ≥ 1e6 | Revert | `maxFee ≤ 100_000` enforced in `validateParams` | `test_validateParams_eachRuleRejects` |
| Bad configuration | Wrong `baseIsToken0`, same or native currency, bad params | Mispricing | Constructor validation through the real mined-CREATE2 path | `test_constructor_rejectsBadConfig` (+ mutation-checked), `test_constructor_minedDeploySucceeds` |
| Overflow on extreme prices/decimals | Token decimals > 18, huge sqrtPrice | A swap revert from math | `validateParams` caps decimals at 18 (spec addition); `FullMath.mulDiv` everywhere | `testFuzz_compute_neverRevertsAndI2` (full uint ranges) |
| Hook holding funds | Any token movement through the hook | Custody risk | No delta-returning permissions; `ZERO_DELTA` (I4) | `test_hookHoldsNoTokens`; `invariant_I4_hookHoldsNoTokens` |
| Admin abuse / upgrade | — | — | None exist: no owner, setters, proxy or `receive` (I5) | Code review; `getHookPermissions` asserted in `test_views` |
| Reentrancy | Hook calls out | — | The only calls out are STATICCALLs to precompiles + `extsload`; `_beforeSwap` is `onlyPoolManager` | `forge lint` (0 warnings in `src/`; the one `reentrancy-events` site is reviewed and annotated) |

### Off-chain (Arena service)

| Threat | Mitigation | Covered by |
|---|---|---|
| Anyone drives the bot or shock | `x-admin-token` on every POST (timing-safe compare), checked **before** the rate limiter; ≥ 24 characters on mainnet | `POSTs need the admin token`; `unauthenticated POSTs are rejected before the limiter` (+ mutations caught) |
| POST flooding | Per-client limit (default 30/min). Client = socket address, or the last `X-Forwarded-For` entry only with `ARENA_TRUST_PROXY=1`; expired counters pruned | `rate-limits POSTs per client`; `rotating X-Forwarded-For does NOT bypass`; `only the LAST X-Forwarded-For entry counts` (+ mutations caught) |
| RPC exhaustion through public GETs | `/verify` cached per tx + 60/min per client; `/bot/status` cached per block | `GET /verify/:tx is rate-limited per client`; `RPC-backed GETs are cached` (+ mutations caught) |
| Socket exhaustion through SSE | Max 500 concurrent stream clients (503 beyond) | `caps concurrent SSE clients` (+ mutation caught) |
| Bot pays real gas for unprofitable trades on mainnet | Config refuses chain 999 with `NATIVE_USD` ≤ 0 | `refuses mainnet (999) with NATIVE_USD = 0` (+ mutation caught) |
| Cross-site use from an untrusted page | CORS allowlist (`ARENA_CORS_ORIGINS`) | `CORS: allowlisted origin echoed, others not` |
| Key leakage | Keys only in `backend/.env` / `contracts/.env` (gitignored); never logged; anvil test keys derived at runtime | `.gitignore`; secret scan before each commit |
| Slow SSE client stalls the service | Per-client queue capped at 200 events (oldest dropped); a broken subscriber can't break the loop | `SSE /stream` test |
| Bot drains its wallet | `MAX_TRADE_*` caps, simulate before send, send only if profitable at oracle, auto-pause below `MIN_NATIVE_BALANCE` | `backend/arena/test/math.test.ts`; load test (PLAN 7.3) |

### Integration requirement: gas estimates need a margin

`beforeSwap` costs more on the **first swap of a block**, because it writes top-of-block and advances the anchor, than on a later swap in the same block. `eth_estimateGas` runs against the latest block. If a swap already happened in that block, the estimate takes the cheap path, and the real tx (usually the first swap of the next block) runs out of gas.

The load test hit this: 12 of 70 bot txs reverted. Fix: estimate × 1.3 + 30k, `withGasMargin` in `backend/arena/src/chain.ts`. **Routers and wallets integrating Aven should add a similar margin.** This only affects the gas limit; it never changes the fee or the swap result.

## 3. Testnet caveat (§10.3)

- Testnet HyperCore prices can be thin or odd. Testnet HYPE's oracle was ~91× its mark (recon C.4), so the live Arena uses **testnet ETH** (perp 4).
- The live demo shows the mechanics. The economic claim rests on the replay over **mainnet** data (backend/data/replay/README.md).
- Demo tokens (`aETH`/`aUSD`) are solmate `MockERC20` with an **open mint**. They're for testnet only and must never hold value.

## 4. Known limitations (§13)

- **Coverage:** only assets with a HyperCore perp. For Hyperliquid-native assets the oracle may exclude external venues.
- **Split arbs:** splitting an arb across blocks lowers the fee somewhat; a multi-block decaying anchor is future work.
- **No LP management:** no liquidity management or hedging; LPs still bear directional risk.
- **Replay inputs:** the replay oracle is a proxy (candle close adjusted by the hourly funding premium), not the historical oracle. Steps are 5m, because 1m isn't served for these dates.
- **Parameters:** calibrated, not optimised.

## 5. Static analysis

- `slither` **won't install** on the build machine: `pip install slither-analyzer` fails building `ckzg` on Python 3.13 (2026-11-06). Run `slither contracts/ --foundry-compile-all` where it installs, and record the findings here.
- `forge lint src`: **0 warnings**. Every suppression has a written justification:
  - 5 `unsafe-typecast`, each bounded by an earlier clamp or by type ranges;
  - 1 `reentrancy-events` block, STATICCALL-only.

## 6. Pre-mainnet audit (2026-11-06)

Requested by Sayan before deploying to HyperEVM mainnet (999). This is an **internal** review: the contracts were re-read line by line, re-tested at higher intensity, and rehearsed on a fork of mainnet. It is not a third-party audit. Facts about mainnet are in [recon.md](recon.md) §E.

### 6.1 Scope and method

- **Contracts:** `AvenFairValue.sol` and `AvenHook.sol`, a line-by-line review. Plus OZ `BaseHook` (access control, address validation) and Uniswap's canonical PoolManager on 999 (bytecode identity).
- **Backend:**
  - Arena HTTP/SSE server, config, chain and bot paths;
  - key handling;
  - RPC usage against the public mainnet limits.
- **Evidence (all green):**
  - `forge test`: 90 passed, 0 failed, 5 skipped;
  - fuzz at **10× runs** (10,000 per test): 90 passed;
  - invariants I1/I2/I3/I4/I9 under **4 extra seeds** (4 × 4,096 calls): 0 reverts, 0 violations;
  - on-chain load: 2,318 swaps / 250 blocks; swap gas p50 174,880, max 214,024; 387 of 387 broken-read swaps fell back;
  - differential: 10,000 fee + 2,000 anchor vectors identical in Solidity and TypeScript;
  - Arena e2e: 8,700 vs 3,000 pips, LPs kept $64.33 more, verify MATCH;
  - load test on the hardened code: 280/280 swaps, 0 reverts, 280/280 verified; API p99 ≤ 63 ms, 0 errors; stress recovery with 0 nonce errors and 341/341 verified.
- **Mainnet fork rehearsal (recon §E.5):** the five deploy scripts ran unchanged against Uniswap's real PoolManager and mainnet state; smoke swaps verify A + B. The full app ran there as chain 999: 8,800 vs 3,000 pips, LPs kept $64.05 more, `verify --all` 4/4.
- **Not done:** Slither, which won't install on the build machine (its `ckzg` dependency fails to build on Python 3.13). Run it where it installs: `slither contracts/ --foundry-compile-all`.

### 6.2 Contract findings

No critical, high or medium issues.

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-1 | Info | `_readPx` stores `perpIndex` in assembly without masking it to 32 bits. Solidity doesn't promise clean high bits for narrow types in assembly. Worst case: the precompile gets a bad index → a failed read → fallback fee (I1 holds). | Accepted. It would only change already-proven bytecode; the value comes from an immutable |
| C-2 | Info | A gap over `maxGapBps` (20%) charges the fallback fee (0.3%) instead of the gap fee (spec §6.3 Step 4: treated as a bad read). | Design, documented (§4) |
| C-3 | Info | Anyone can initialize *another* pool with the same token pair and this hook (a different tick spacing). Its state is separate (per `PoolId`); our pools are unaffected. | Accepted |
| C-4 | Info | On 999 the PoolManager is Uniswap's, owned by Uniswap governance. `protocolFeeController` is `0x0` today. If governance sets one, a protocol share could be taken from LP fees, and verify check B would need to include it. | Monitor; `cast call <PM> "protocolFeeController()"` before demos |
| C-5 | Low (demo integrity) | `aETH`/`aUSD` are solmate `MockERC20`s with an **open mint**. On mainnet anyone can mint them and swap against our pools, even push a pool to the edge of its liquidity range. No real value is at risk (worthless tokens; the bot arbs back), but it can disrupt the demo. | **Decision for Sayan:** keep it open (judges can try swaps themselves) or deploy owner-mint demo tokens (`DeployTokens` change) |

Re-checked and fine:
- **Callers:** only the PoolManager can call the hook (OZ `onlyPoolManager`), and the constructor validates the address bits (`0x2080`).
- **Tokens and fees:** no delta-returning permissions, so the hook never touches tokens (I4). The override flag is set on every return (I3). The fee is ≤ `maxFee` ≤ 100,000, well under the 1,000,000 limit.
- **No admin surface:** no owner, setters, `receive` or proxy (I5).
- **Reentrancy:** the only outbound calls are STATICCALLs to precompiles and `extsload`.
- **Maths:** every product is bounded for any `sqrtPrice` in [MIN, MAX] (512-bit `mulDiv` where needed). Division by zero is unreachable: oracle > 0 when `readOk`, and the anchor is checked first.
- **Anchor arithmetic:** `advanceAnchor` relies on monotonic timestamps; HyperEVM blocks are 1 s apart (E.1).
- **Precompile cost on 999:** ~3,451 gas per read, far below the 30,000 cap.

### 6.3 Backend findings (all fixed, each with a test and a mutation check)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| B-1 | Medium | The POST rate limit keyed clients on the **first** `X-Forwarded-For` entry, which the client controls. Anyone could rotate it to bypass the limit, set it to the admin's address to lock them out, or grow the counter map without bound. Unauthenticated requests also consumed budget. | Admin token is checked **first**. Clients are identified by socket address, or by the **last** XFF entry only with `ARENA_TRUST_PROXY=1` (behind cloudflared). Expired counters are pruned |
| B-2 | Medium | `GET /verify/:tx` and `GET /bot/status` were unauthenticated, uncached and cost RPC calls on every request. A flood could use up the RPC quota and stall the bot. | `/verify` results cached per tx (bounded, failures not cached) + per-client limit `ARENA_VERIFY_LIMIT_PER_MIN` (60). `/bot/status` balances cached per block (single-flight) |
| B-3 | Low | No cap on concurrent SSE clients (socket exhaustion). | `ARENA_MAX_SSE_CLIENTS` (500); beyond it → 503 |
| B-4 | Medium (mainnet only) | `NATIVE_USD` defaults to 0, so on mainnet the bot would value real gas at $0 and send trades that don't cover their gas. | Config refuses chain 999 with `NATIVE_USD` ≤ 0 |
| B-5 | Low (mainnet only) | The admin token minimum was 8 characters. | Chain 999 requires ≥ 24 (use `openssl rand -hex 24`) |

Mutation checks: each fix was broken on purpose (auth after the limiter, trusting the first XFF entry, always trusting XFF, no verify limit, no SSE cap, no NATIVE_USD guard, no verify cache, no balance cache) and **all 8 were caught** by a specific test. The admin-token guard has its own test.

### 6.4 Operational risks on mainnet

| ID | Severity | Risk | Mitigation |
|---|---|---|---|
| O-1 | **High** | The public RPC `rpc.hyperliquid.xyz/evm` allows **100 requests/min per IP** (recon §E.4). The Arena needs more (table below), so on the public endpoint it would be throttled and the bot would stall. | Use a **dedicated HyperEVM RPC endpoint** for the Arena (and the deploy) via `HYPEREVM_RPC`. The public endpoint is fine for one-off reads (`pnpm verify`) |
| O-2 | High | Keys hold real HYPE. | Fresh hot wallets for bot and shock, funded with small amounts. The deployer key goes in `contracts/.env` only for the deploy, then is removed. Never reuse a personal wallet. `.env*` stays gitignored |
| O-3 | Medium | A leaked admin token lets someone spend shock and bot gas. | Long random token (B-5). POSTs are capped at 30/min, so the worst case is ~0.07 HYPE/hour of shocks. Rotate the token by restarting the Arena |
| O-4 | Low | `ARENA_TRUST_PROXY=1` without a proxy would trust client headers. | Set it only behind cloudflared or similar; the default is off |
| O-5 | **High** (found on re-check) | **Gas spikes.** Over 3 h the base fee ranged 0.10–10.8 gwei (recon §E.1). The Arena trades worthless tokens, so its paper profit always beats real gas, and without a cap the bot would keep paying through a spike (200 swaps at 10 gwei ≈ 0.34 HYPE). | **Fixed:** `MAX_GAS_PRICE_GWEI`, required on 999 (suggested 2). Above it the bot skips the whole iteration (no reads, no sends) and shocks are refused before their first swap. Every tx carries `maxFeePerGas` = the cap. The deploy uses forge `--with-gas-price 2gwei --priority-gas-price 0`. Tests: `the bot skips a whole iteration during a gas spike`, `a shock during a gas spike sends NOTHING`, `writeWithMargin puts maxFeePerGas = cap`, `refuses mainnet (999) without a gas price cap` (5 mutations caught) |

**The Arena's RPC request rate** was measured on a local chain through a counting proxy, 60 s per phase, 2026-11-06. Each number is HTTP requests per minute, which is what the per-IP limit counts:

| Arena state | `POLL_MS` 500 (default) | `POLL_MS` 2000 |
|---|---|---|
| Idle (bot off, no viewers) | 118 | 29 |
| Bot on, quiet market | 532 | 240 |
| Bot on + 1 website viewer (SSE) | 1,079 | 510 |
| Bot on + viewer, price moving + a shock | **1,867** (~31/s) | 1,053 |

The public limit is 100/min. **A dedicated endpoint good for ≥ 40 requests/s is required** (O-1). A slower poll only cuts the rate; it doesn't fit 100/min while the bot runs. Once at least one viewer is connected, the Arena computes the state once per block for **all** viewers together (single-flight), about 550/min at the default poll. More viewers don't add RPC calls.

