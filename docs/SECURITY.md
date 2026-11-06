# SECURITY.md — trust model, threats and the test behind each

Source: ARCHITECTURE §10 (trust model and threats), §6.6 (invariants) and §13 (limits). Every threat below maps to a test that covers it, or to a stated limitation. Test files:

- **Unit:** `contracts/test/unit/AvenFairValue.t.sol`
- **Integration:** `contracts/test/integration/AvenHook.t.sol` (runs for base = token0 and base = token1)
- **Invariant:** `contracts/test/invariant/AvenInvariant.t.sol`
- **Arena:** `backend/arena/test/server.test.ts`

Results with numbers: [PROOFS.md](PROOFS.md).

## 1. Trust assumptions (§10.1)

1. HyperCore's oracle and mark prices are produced honestly by the validator set. This is the same assumption as trusting the chain itself.
2. Uniswap v4-core is correct (multiple audits). Our PoolManager is byte-identical to Uniswap's canonical HyperEVM mainnet build (recon A.5).
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
| Anyone drives the bot or shock | `x-admin-token` on every POST (timing-safe compare) | `POSTs need the admin token` (+ mutation caught) |
| POST flooding | Per-client limit (default 30/min) | `rate-limits POSTs per client` (+ mutation caught) |
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

### Live mode (local chain + live Hyperliquid prices, DEPLOYMENTS.md §A)

- **Extra trust:** the demo adds one trusted off-chain part that HyperEVM doesn't have, the **price relay**. It copies Hyperliquid's API prices into the precompile addresses. `pnpm live:check` makes this checkable: every price the hook used must equal a relayed API value in effect at that block. On HyperEVM the relay doesn't exist; the precompiles are the chain's own state.
- **Stale or failed API:** after 15 s without a good answer, both reads revert, so the hook charges the fallback fee (I1; E2E test `liveRelay.e2e.test.ts`). It never prices on a stale value.
- **Exposure:** anvil (8545) stays on 127.0.0.1. Its `anvil_*` methods and the public anvil test keys would let anyone rewrite prices or trade as our wallets. The public side is the read-only RPC (8546: `eth_*` reads only, every send and cheat method refused, 256 KB body cap) and the Arena API (admin token, CORS allowlist, rate limit, as above).
- **Port guard:** `pnpm live` refuses to start while its ports are busy, so it never deploys onto a stale chain left over from an earlier run.

## 4. Known limitations (§13)

- **Coverage:** only assets with a HyperCore perp. For Hyperliquid-native assets the oracle may exclude external venues.
- **Split arbs:** splitting an arb across blocks lowers the fee somewhat; a multi-block decaying anchor is future work.
- **No LP management:** no liquidity management or hedging; LPs still bear directional risk.
- **Replay inputs:** the replay oracle is a proxy (candle close adjusted by the hourly funding premium), not the historical oracle. Steps are 5m, because 1m isn't served for these dates.
- **Parameters:** calibrated, not optimised.

## 5. Static analysis

- `slither` is **not installed** on the build machine. Run `slither contracts/src` where it's available and record the findings here.
- `forge lint src`: **0 warnings**. Every suppression has a written justification:
  - 5 `unsafe-typecast`, each bounded by an earlier clamp or by type ranges;
  - 1 `reentrancy-events` block, STATICCALL-only.
