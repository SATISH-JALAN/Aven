<div align="center">

# Aven

### Every dynamic-fee hook trusts someone for its price. Aven reads the perp market itself.

**A Uniswap v4 fee library and hook on HyperEVM that prices every swap from Hyperliquid's in-block perp market, so LPs keep more of the value arbitrageurs would take.**

[![Uniswap v4](https://img.shields.io/badge/Uniswap-v4%20hook-ff007a)](https://github.com/Uniswap/v4-core)
[![HyperEVM](https://img.shields.io/badge/HyperEVM-testnet%20998-97fce4)](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.26-363636)](contracts/foundry.toml)
[![Foundry](https://img.shields.io/badge/tests-Foundry%20%2B%20vitest-orange)](docs/PROOFS.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Built at **ETHGlobal Mumbai 2026** for the Uniswap Foundation track.

[How it works](#how-it-works) · [Proofs](#every-proof-and-what-it-catches) · [Run it](#getting-started) · [Integrate it](#integrate-aven-into-your-own-hook) · [Limits](#what-aven-does-not-claim)

</div>

---

> **Status (2026-11-06):** the contracts, TypeScript port, verifier, Arena bot service, replay engine and every proof are done. All of it has been run end to end on a local chain, using mock precompiles placed at the real addresses. **The HyperEVM testnet deployment is pending** (it needs a funded deployer; runbook in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)). **The web app is in progress.** Every number below says where it came from.

## What a judge should check

| Claim | Where to check it |
|---|---|
| The fee comes from HyperCore's oracle and mark price, read **inside `beforeSwap`**, in the same block. No relay, keeper or signer. | [`AvenFairValue.readPrices`](contracts/src/AvenFairValue.sol#L122) · [`AvenHook._beforeSwap`](contracts/src/AvenHook.sol#L119-L146) |
| A broken price read **never reverts a swap**; it charges a fallback fee instead. | `test_precompileRevert_chargesFallback`, `test_precompileBurnsGas_capped`, `invariant_I1_noSwapRevertsFromReads` |
| A swap that closes a stale-price gap pays the gap fee; the same swap in the reverse direction doesn't. | `test_arbDirectionPaysMoreThanReverse`, `test_sandwichBackLeg_paysGapFee` |
| Every fee can be recomputed off-chain from the event alone, and the PoolManager charged exactly that fee. | [`pnpm verify <tx>`](backend/core/bin/verify.ts): check A (formula) + check B (`Swap.fee`) |
| Solidity and TypeScript give identical results. | `pnpm prove:diff`: **10,000 / 10,000** fee vectors, **2,000 / 2,000** anchor vectors, exact |
| On real Hyperliquid history (Oct 29 2026, Binance halt), Aven LPs beat fixed-fee LPs. | [Replay results](#replay-real-mainnet-history-four-pools) · [backend/data/replay/README.md](backend/data/replay/README.md) |
| No owner, setters, proxy, `receive` or custody. | [`AvenHook.sol`](contracts/src/AvenHook.sol): every config value is `immutable` |
| Anything that quotes Uniswap's dynamic-fee hooks can quote Aven. | `AvenHook` implements Uniswap's [`IDynamicFeeHook.getFee`](contracts/src/interfaces/IDynamicFeeHook.sol) |

---

## The whole story in three moves

1. **The leak.** An AMM's price only moves when someone trades against it. When the market moves somewhere else, the pool is stale, and the first arbitrageur to correct it profits at the LPs' expense. This is **loss-versus-rebalancing (LVR)**. A fixed fee taxes every trade the same and can't tell arbitrage from ordinary flow. Dynamic-fee hooks can, but they need a fresh, trustworthy outside price. On most chains that price arrives late (push oracles), costs a relayer per update (pull oracles), or comes from a model or operator you have to trust.

2. **The insight.** On HyperEVM, a contract can read HyperCore's perp **oracle price** and **mark price** through read precompiles (`0x…0807`, `0x…0806`). Hyperliquid's docs say these values *"match the latest HyperCore state at the time the EVM block is constructed."* HyperCore and HyperEVM share one consensus (HyperBFT), so the read has no relay, no signer and no cross-chain staleness. The fair price is already chain state.

3. **The fee.** Before every swap, Aven asks three questions. Is this trade closing a stale-price gap? Is it trading with perp-market pressure? Is the perp market moving violently? Each "yes" adds to the fee, which is clamped and paid to LPs. If the answer to all three is "no", the swap pays the 0.05% base fee. Every input is emitted in an event, so anyone can recompute the fee.

> Uniswap's own `VolatilePairHook` **learns from the pool's past**. Aven **reads the market's present**.

### Why it's different

| Design | Where the signal comes from | Trust | Admin / upgrade | Reacts |
|---|---|---|---|---|
| Fixed-fee pool | none | none | n/a | never |
| Push-oracle dynamic fee | oracle network | oracle operators | varies | after the update lands |
| Uniswap [`VolatilePairHook`](https://github.com/Uniswap/v4-hooks-public) | the pool's own top-of-block move (ask/bid skew + backrun fee) | pool path only | UUPS proxy with admin, pool-initializer and config-manager roles | after the pool itself moves |
| **Aven** | **HyperCore oracle + mark, read in-block** | **the chain only** | **none** | **same block, before the pool moves** |

Aven borrows four ideas from `VolatilePairHook`: top-of-block anchoring, direction-specific fees, implementing `IDynamicFeeHook.getFee`, and computing state in memory for views while only `beforeSwap` writes it. The two designs complement each other. Combining them is on the [roadmap](#roadmap).

---

## How it works

### Architecture

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.svg">
    <img src="docs/diagrams/architecture-light.svg" width="100%" alt="Aven system architecture: users swap through the Uniswap v4 PoolManager, which calls AvenHook; AvenHook uses the AvenFairValue library, which reads HyperCore's oracle (0x807) and mark (0x806) precompiles in the same block with a gas cap and returns fee | 0x400000. The off-chain Arena service, @aven/core verifier, replay engine and web app only trade, quote and verify.">
  </picture>
</p>

**Trust boundary.** Only one path sets a fee: **PoolManager → AvenHook → AvenFairValue → HyperCore precompiles**. Everything off-chain is just a client. It can trade, quote, read and verify, but has no privileged entry point.

### A swap through the Aven pool

```mermaid
sequenceDiagram
  participant R as Router / Bot
  participant PM as PoolManager
  participant H as AvenHook
  participant L as AvenFairValue
  participant C as HyperCore precompiles
  R->>PM: unlock → swap(key, params, hookData)
  PM->>H: beforeSwap(sender, key, params, hookData)
  H->>PM: extsload slot0 (getSlot0)
  H->>L: readPrices(perpIndex, gasCap)
  L->>C: staticcall 0x807 oraclePx (gas-capped)
  L->>C: staticcall 0x806 markPx (gas-capped)
  C-->>L: uint64, uint64 (or failure → readOk = false)
  H->>L: compute(cfg, params, inputs)
  L-->>H: Breakdown {fee, reason, signals}
  H->>H: persist top-of-block price + mark anchor, emit FeeComputed
  H-->>PM: (selector, ZERO_DELTA, fee | 0x400000)
  PM->>PM: Pool.swap with the override fee; fee accrues to LPs
  PM-->>R: BalanceDelta + Swap event (fee)
```

### The pricing model

All of the math is integer-only (no floats) and identical in Solidity and TypeScript. Fees are in pips (1,000,000 = 100%), and gaps are in basis points.

| Signal | What it measures | Charged when |
|---|---|---|
| **Fair-value gap** | how far the pool price is from the HyperCore oracle, anchored to the **top of the block** | the swap moves the pool *toward* fair, i.e. it's arbitrage |
| **Perp premium** | `(mark − oracle) / oracle`: buying or selling pressure in the perp market | the swap trades *with* that pressure |
| **Mark stress** | how far the mark moved against a **time-weighted anchor** (τ = 60 s) | the move exceeds 50 bp |

```text
fee = clamp( baseFee
           + (arb          ? gapBps      × gapWeight     : 0)
           + (withPressure ? |premiumBps| × premiumWeight : 0)
           + (moveBps > threshold ? (moveBps − threshold) × stressWeight : 0),
           minFee, maxFee )

bad read (revert, empty, zero, > uint64, gas burn)  →  fee = fallbackFee, reason = READ_FAILED
gapBps > maxGapBps                                   →  fee = fallbackFee, reason = GAP_TOO_LARGE
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/fee-pipeline-dark.svg">
    <img src="docs/diagrams/fee-pipeline-light.svg" width="100%" alt="Inside beforeSwap: read the pool price and top-of-block price, read oracle and mark with exactly 30,000 gas each; a bad read falls back to 3,000 pips (READ_FAILED). Otherwise compute the fair-value gap (over 2,000 bp falls back with GAP_TOO_LARGE), direction, perp premium and mark stress, then clamp 500 plus the terms to 500..10,000 pips. Finally persist two storage slots, emit FeeComputed and return fee | 0x400000.">
  </picture>
</p>

**Default parameters** ([`AvenFairValue.defaultParams`](contracts/src/AvenFairValue.sol#L84)), used everywhere. Nothing was tuned on the replay data.

| baseFee | minFee | maxFee | fallbackFee | gapWeight | premiumWeight | stressThreshold | stressWeight | τ | maxGap | precompileGas |
|---|---|---|---|---|---|---|---|---|---|---|
| 500 (0.05%) | 500 | 10,000 (1%) | 3,000 (0.30%) | 50 pips/bp | 50 pips/bp | 50 bp | 20 pips/bp | 60 s | 2,000 bp | 30,000 |

**Worked example** (from the spec). The pool is 1.50% above the oracle, the mark is 0.20% below the oracle, and the mark moved 0.30% against its anchor.
- **Seller (arbitrage):** 500 base + 150 bp × 50 gap + 20 bp × 50 premium + 0 stress = **9,000 pips (0.90%)**.
- **Buyer (same block, same state):** not arbitrage, and trading against the premium, so **500 pips (0.05%)**.

**Measured example** (Arena end-to-end test, local chain). A shock left both pools 164 bp above fair. The bot's arbitrage paid **500 + 164 × 50 = 8,700 pips on Aven** vs 3,000 on the control pool. The verifier recomputed 8,700 from the event.

### Two anti-gaming rules

- **Top-of-block gap anchor.** Without it, an arbitrageur could split one trade into many swaps in one block and pay a shrinking fee on each. With it, every arb-direction swap in the block pays at least the gap measured at the block's first swap. Tested by `test_splitSwapSameBlock_paysTopOfBlockGap`.
- **Time-weighted mark anchor.** A "previous swap" reference can be griefed: a dust swap just before the arb resets it and erases the stress fee. Aven's anchor moves by `dt / τ` no matter how many swaps happen, so a dust swap in the same second changes nothing. Tested by `test_dustSwap_doesNotResetStress`.

### Design rules that are never broken

- Every `beforeSwap` return sets `OVERRIDE_FEE_FLAG` (`0x400000`), the fallback included. A v4 dynamic-fee pool starts with a stored LP fee of 0, so a missing flag would mean free swaps.
- Hook permissions are `beforeInitialize` + `beforeSwap` only, so the hook address's low 14 bits are `0x2080`, mined with HookMiner.
- Precompile reads are hand-written, non-reverting `staticcall`s that forward exactly `precompileGas` and copy at most 32 bytes. hyper-evm-lib's `PrecompileLib` reverts on failure, so it is never used on the swap path. An invalid precompile call burns all the gas it's given, which is why the cap exists.
- `beforeInitialize` only accepts dynamic-fee pools of exactly the configured `{base, quote}` pair, so the hook can't be attached to a pair it would misprice.

---

## Every proof, and what it catches

A check that has never been seen failing doesn't prove much. The core checks were **mutation-tested**: we broke the code on purpose and confirmed the matching test went red.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/proofs-dark.svg">
    <img src="docs/diagrams/proofs-light.svg" width="100%" alt="Three proof lanes. Same math, two languages: GenVectors.t.sol produces 10,000 fee and 2,000 anchor vectors from the Solidity library and fee.ts matches all of them exactly (I7). Every live fee, re-derived: pnpm verify rebuilds inputs from FeeComputed, recomputes the fee and checks it against the event (check A) and the PoolManager Swap fee (check B) (I8). Contract test suite: unit and fuzz, v4 integration in both token orders, nine named tests, invariants and an opt-in load test; 90 passed, 0 failed.">
  </picture>
</p>

| Run it | What it proves | Result | Seen failing on purpose? |
|---|---|---|---|
| `forge test` (in `contracts/`) | unit, fuzz (1,000 runs, fixed seed), v4 integration with **both token orders**, invariants | **90 passed, 0 failed, 5 skipped** (the skips are opt-in runs) | yes: no override flag → 5 tests fail; top-of-block reset every swap → 2 fail; anchor advancing on a failed read → 1 fails |
| the nine named tests (ARCHITECTURE §9) | split swaps, dust swaps, precompile revert, gas burn, wrong pair, static-fee pool, preview == charged, override flag, sandwich back leg | all pass, base as token0 **and** as token1 | — |
| `invariant_*` in [`AvenInvariant.t.sol`](contracts/test/invariant/AvenInvariant.t.sol) | I1, I2, I3, I4, I9 over random swaps, price moves, read failures, block changes | 64 runs × 64 calls, 0 reverts | yes: 3 mutations, each caught by the matching invariant |
| `pnpm prove:diff` | **I7**: Solidity `compute` ≡ TypeScript `compute` on every field | **10,000 / 10,000** fee + **2,000 / 2,000** anchor vectors | yes: 2 mutations caught |
| `pnpm verify <tx>` / `--all` | **I8**: fee recomputed from `FeeComputed` == event fee (check A) and == PoolManager `Swap.fee` (check B) | local chain: 2/2 smoke swaps; load test: **280/280** burst swaps and **348/348** under RPC faults | — |
| `pnpm --filter @aven/arena test:e2e` | live gate: shock → bot arbs both pools → Aven fee > control fee → LPs kept more → verify MATCH → trades reload after restart | PASS: Aven arb fee **8,700** vs **3,000**; **LPs kept $64.33 more** | — |
| `LOAD=1 forge test --match-path test/load/OnchainLoad.t.sol -vv` | 2,318 swaps over 250 blocks, ~15% of blocks with broken reads | **0 reverts**, 0 fee violations, 0 zero-fee swaps; all 387 fallback fees happened on broken reads | — |
| `pnpm --filter @aven/arena loadtest` | API under load with 200 SSE clients; bot under shocks with a flaky RPC | p99 ≤ 71 ms at ~1.5–2.5k req/s, 0 errors, no SSE leak; 0 nonce errors | found **4 bugs**, each fixed with a regression test ([LOADTEST.md](docs/LOADTEST.md)) |
| `pnpm proofs --e2e` | runs forge, the differential proof, local verify, the replay summary and the Arena e2e, then writes [docs/PROOFS.md](docs/PROOFS.md) | — | — |

### Invariants

| # | Invariant | Proven by |
|---|---|---|
| I1 | A swap never reverts because of a precompile read | unit + invariant (failure injection) |
| I2 | `fee ∈ [minFee, maxFee]`, or `fee == fallbackFee` with `reason ≠ OK` | fuzz + invariant |
| I3 | The override flag is set on every `beforeSwap` return | integration + invariant |
| I4 | The hook never holds tokens and returns `ZERO_DELTA` | invariant (balances 0) |
| I5 | No state-changing external function except `beforeInitialize` / `beforeSwap` (onlyPoolManager) | code review; `forge lint` (0 warnings in `src/`) |
| I6 | `previewFee(key, d).fee` == the fee charged, for the same pre-state | integration |
| I7 | Solidity `compute` == TypeScript `compute` on every vector | differential (10k vectors) |
| I8 | `FeeComputed` inputs are enough to recompute `fee` exactly | live verifier |
| I9 | The anchor changes only when both reads succeed; top-of-block changes only on the first swap of a block | unit + invariant |
| I10 | A pool with other currencies or a static fee can't initialize with the hook | unit |

### Gas

- **Hook overhead inside a real swap: 46,877 gas** (Aven swap 170,496 minus an identical control swap 123,619). That's with the mock precompile, which costs more than the real one (≤ 3,112 gas per read, measured on testnet).
- `AvenHook` runtime size: **9,337 bytes** (limit 24,576).
- About 16 Aven swaps fit in one 3M-gas HyperEVM small block.

### Replay: real mainnet history, four pools

The same HYPE price path (Hyperliquid mainnet data, 5-minute steps) runs through four otherwise identical pools in one local PoolManager. Each step, an arbitrage agent trades whenever it profits at the true oracle price, and a seeded retail agent makes the **same** trades on every pool.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/replay-dark.svg">
    <img src="docs/diagrams/replay-light.svg" width="100%" alt="Replay pipeline: Hyperliquid mainnet candles and funding, normalized by fetch-market-data.ts, replayed by Replay.t.sol through four pools, exported as CSV, summary and web JSON. Results, LP value minus HODL: Binance halt fixed 0.05% −$318.18, fixed 0.30% +$6.77, Aven 60 s lag +$114.47, Aven live +$141.25; calm day +$64.52, +$317.49, +$323.39, +$323.14.">
  </picture>
</p>

| Scenario | fixed 0.05% | fixed 0.30% | Aven, 60 s-delayed price | **Aven, live price** |
|---|---|---|---|---|
| **Oct 29 2026, 18:00–24:00 UTC (Binance halt)**: LP value − HODL | −$318.18 | +$6.77 | +$114.47 | **+$141.25** |
| Oct 25 2026, 06:00–12:00 UTC (calm): LP value − HODL | +$64.52 | +$317.49 | +$323.39 | +$323.14 |

- **In the Binance halt**, live Aven ends $141 above holding, while fixed 0.05% ends $318 below. The live hook beats the delayed one, so the edge comes from reading the market in-block.
- **On the calm day**, Aven roughly matches fixed 0.30% while charging ordinary flow only the 0.05% base fee. Live and delayed are about equal, because a 60 s lag doesn't matter when nothing moves.
- **Limits:** the historical oracle is approximated as candle close / (1 + hourly funding premium). The steps are 5 minutes because 1-minute candles are no longer served for these dates. With one arb attempt per step, absolute LVR is understated for every pool alike. Method, sanity tests and hand checks: [backend/data/replay/README.md](backend/data/replay/README.md).

---

## The Arena: a live arbitrage bot against two pools

The Arena is the live demo. A Node service runs an arbitrage bot against two pools with identical liquidity: a plain **0.30% control pool** and the **Aven pool**. An admin "shock" pushes both off fair value with the same swap. Then you watch what each pool charges the bot.

```mermaid
sequenceDiagram
  participant W as Web / curl
  participant A as Arena service
  participant RPC as HyperEVM RPC
  participant PM as PoolManager + AvenHook
  W->>A: POST /shock (x-admin-token)
  A->>RPC: identical swap on both pools (shock wallet)
  loop every new block (polled every ~500 ms, no websockets on HyperEVM)
    A->>RPC: eth_call oraclePx, slot0 ×2, previewFee
    A->>RPC: simulate the arb swaps (eth_call)
    A->>RPC: send the profitable ones (bot wallet)
    RPC->>PM: swap → beforeSwap → FeeComputed
    A->>RPC: receipt + logs → verify
    A-->>W: SSE: trade / state / stats
  end
  W->>A: GET /verify/:tx
  A-->>W: {match, onchainFee, recomputedFee, swapEventFee, inputs}
```

How the bot trades, per pool and per block:
1. Read the oracle and the pool price. Skip if the gap is under 1 bp.
2. Quote the fee: 3,000 on the control pool, `previewFee` on Aven.
3. Trade toward the break-even price `p* = oracle / (1 − f)` when selling base, or `oracle · (1 − f)` when buying.
4. Simulate first; send only if the trade is profitable at the oracle price.

It has a nonce manager per wallet, retries with backoff, trade-size caps, auto-pause on low gas balance, an admin token and rate limit on POST routes, and a CORS allowlist.

### Arena HTTP + SSE API

Full types: [docs/spec/API.md](docs/spec/API.md). POST routes need the `x-admin-token` header.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ok, chainId, block, botEnabled, version}` |
| GET | `/config` | `{chainId, hook, poolManager, pools, config, params, explorer}` |
| GET | `/state` | oracle, mark, and per-pool price, gap and next-fee preview |
| GET | `/stats` | per-pool trades, bot profit, LP fee income, volume; `lpKeptMoreUsd` |
| GET | `/trades?limit=50&pool=aven\|control` | `Trade[]`, newest first |
| GET | `/bot/status` | `{enabled, lastRunBlock, lastError, balances}` |
| GET | `/verify/:tx` | `VerifyResult` (checks A and B, every input) |
| GET | `/stream` | SSE events: `state`, `trade`, `shock`, `bot` |
| POST | `/shock` `{sizeBase?, direction?}` | `Shock` |
| POST | `/bot/start` · `/bot/stop` | `{enabled}` |
| POST | `/reset-stats` | `{since}` |

---

## Integrate Aven into your own hook

`AvenFairValue` is a library of `internal` functions, so it is inlined into whatever hook imports it. The minimal hook below compiles against this repo. It reads both prices without ever reverting, computes the fee and returns it with the override flag:

```solidity
import {AvenFairValue as FV} from "src/AvenFairValue.sol";

function _beforeSwap(address, PoolKey calldata key, SwapParams calldata sp, bytes calldata)
    internal override returns (bytes4, BeforeSwapDelta, uint24)
{
    (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
    (bool ok, uint64 oracleRaw, uint64 markRaw) = FV.readPrices(cfg.perpIndex, params.precompileGas); // never reverts
    FV.Inputs memory inp = FV.Inputs({oracleRaw: oracleRaw, markRaw: markRaw, anchorMarkRaw: 0,
        sqrtPriceX96: sqrtP, sqrtPriceTopX96: sqrtP, zeroForOne: sp.zeroForOne, readOk: ok});
    uint24 fee = FV.compute(cfg, params, inp).fee;
    return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
}
```

This sketch leaves out the two anti-gaming anchors (`anchorMarkRaw: 0` turns off the stress signal, and `sqrtPriceTopX96: sqrtP` turns off the top-of-block gap). For the full version, copy [`AvenHook._load`](contracts/src/AvenHook.sol#L187), which keeps both in two storage slots per pool. Validate your config with `FV.validateParams(cfg, params)` in the constructor.

**Quoting from a router or wallet.** `AvenHook` implements Uniswap's `IDynamicFeeHook`, so `getFee(key)` returns `(feeZeroForOne, feeOneForZero)` for the current block. `previewFee(key, zeroForOne)` returns the full `Breakdown` (gap, premium, stress, reason), and it equals what `beforeSwap` will charge in the same state (I6).

> **Integration note: add a gas margin.** The first swap of a block costs more, because it writes the top-of-block price and advances the anchor. `eth_estimateGas` may simulate the cheaper later-swap path, and the real transaction then runs out of gas. The load test hit this (12 of 70 bot txs reverted). The Arena uses estimate × 1.3 + 30k ([`withGasMargin`](backend/arena/src/chain.ts)), and routers should add a similar margin. This affects only the gas limit, never the fee.

### Where the Uniswap integration lives

| What | Where |
|---|---|
| `beforeSwap`: read, compute, persist, emit, return `fee \| OVERRIDE_FEE_FLAG` | [`contracts/src/AvenHook.sol#L119-L146`](contracts/src/AvenHook.sol#L119-L146) |
| `beforeInitialize`: dynamic fee + exact currency pair only | [`contracts/src/AvenHook.sol#L105`](contracts/src/AvenHook.sol#L105) |
| `previewFee` / `getFee` (`IDynamicFeeHook`) | [`#L151`](contracts/src/AvenHook.sol#L151) / [`#L160`](contracts/src/AvenHook.sol#L160) |
| `_load`: top-of-block, reads, anchor (in memory) | [`contracts/src/AvenHook.sol#L187`](contracts/src/AvenHook.sol#L187) |
| Gas-capped, non-reverting precompile reads | [`contracts/src/AvenFairValue.sol#L122`](contracts/src/AvenFairValue.sol#L122) |
| `compute`: the whole pricing model | [`contracts/src/AvenFairValue.sol#L178`](contracts/src/AvenFairValue.sol#L178) |
| `FeeComputed` event (every input) | [`contracts/src/interfaces/IAvenHook.sol#L23`](contracts/src/interfaces/IAvenHook.sol#L23) |
| BigInt port of `compute` / verifier | [`backend/core/src/fee.ts`](backend/core/src/fee.ts) / [`backend/core/src/verify.ts`](backend/core/src/verify.ts) |

---

## Tech stack

| Layer | Tools |
|---|---|
| Contracts | Solidity 0.8.26 (Cancun), Foundry, Uniswap **v4-core** (`d153b04`), **v4-periphery** (`c6e4754`, HookMiner), OpenZeppelin **uniswap-hooks** `BaseHook` (`v1.3.0-rc.0`), forge-std `v1.17.0`, hyper-evm-lib `v1.1` (tests only) |
| Chain | HyperEVM testnet (998) for the live Arena, Hyperliquid mainnet data for the replay; HyperCore read precompiles `0x806` (mark), `0x807` (oracle), `0x80a` (perpAssetInfo) |
| Off-chain | Node ≥ 20, TypeScript (strict, ESM), pnpm workspaces, viem, zod, Hono + `@hono/node-server` (HTTP + SSE), vitest, tsx, autocannon (load tests) |
| Data | Hyperliquid info API (`candleSnapshot`, `fundingHistory`, `meta`) |
| Frontend | Next.js (App Router), **in progress** |

## Project structure

```text
Aven/
├── contracts/                      Foundry
│   ├── src/
│   │   ├── AvenFairValue.sol       the library: reads, scaling, signals, fee, anchor
│   │   ├── AvenHook.sol            reference v4 hook (beforeInitialize + beforeSwap)
│   │   └── interfaces/             IAvenHook (FeeComputed, views), IDynamicFeeHook (Uniswap, MIT)
│   ├── script/                     DeployCore, DeployTokens, DeployAven, CreatePools, Smoke
│   ├── test/
│   │   ├── unit/ integration/ invariant/ load/ replay/ vectors/ recon/
│   │   ├── mocks/MockHyperCorePx.sol   etchable precompile mock with failure injection
│   │   └── utils/                  AvenTestBase, PriceMath
│   ├── deployments/                <chainId>.json, the single source of addresses
│   └── foundry.toml                default profile + v4core profile (canonical PoolManager build)
├── backend/
│   ├── core/       @aven/core: BigInt fee port, generated ABIs, pool + precompile reads, verifier, verify CLI
│   ├── arena/      @aven/arena: poller, arb bot, shock, stats, HTTP + SSE API, e2e + load tests
│   ├── scripts/    @aven/scripts: local chain, market data, replay, proofs report, demo
│   └── data/       raw/ (market data), replay/ (results), load/ (load-test output)
├── frontend/       Next.js app (in progress); public/replay/*.json and arena-fallback.json are generated
└── docs/
    ├── spec/       ARCHITECTURE.md (normative), API.md, DATA.md, FRONTEND.md
    ├── PROOFS.md   SECURITY.md  LOADTEST.md  DEPLOYMENTS.md  DEMO.md  recon.md
    ├── FLOW.md     MEMORY.md    PLAN.md
    ├── diagrams/   README diagrams: render.py (stdlib Python) -> *-light.svg / *-dark.svg
    ├── ai/         PROMPTS.md, ATTRIBUTION.md
    └── planning/   pre-kickoff planning (ideas and specs only, no code)
```

How code flows from entry point to exit point, part by part: [docs/FLOW.md](docs/FLOW.md). The diagrams in this README are hand-built SVGs, in a light and a dark version; to change one, edit [docs/diagrams/render.py](docs/diagrams/render.py) and run `python docs/diagrams/render.py`.

---

## Getting started

### Prerequisites

- **Node ≥ 20** and **pnpm 12** (`packageManager: pnpm@12.9.1`)
- **Foundry** (`forge`, `anvil`, `cast`). Scripts also look in `~/.foundry/bin` if it isn't on `PATH`.
- `git` with submodules (contract dependencies are pinned submodules in `contracts/lib/`)

### Install

```bash
git clone --recurse-submodules https://github.com/SATISH-JALAN/Aven.git
cd Aven
# already cloned without submodules?  git submodule update --init --recursive
pnpm install
```

### Test everything

```bash
cd contracts && forge test && cd ..        # Solidity: unit, fuzz, integration, invariants
pnpm test                                  # TypeScript: core, arena, scripts
pnpm prove:diff                            # Solidity ≡ TypeScript on 10k + 2k vectors (~45 s)
pnpm --filter @aven/arena test:e2e         # full live gate on a local chain (~2.5 min)
pnpm proofs --e2e                          # forge + diff + local verify + replay + e2e -> docs/PROOFS.md
```

> **Check out the submodules before the first `forge test`.** If `contracts/lib/` is empty, forge tries to install the dependencies itself, can stop halfway, and then fails with `Source "lib/v4-core/..." not found`.

### Run the whole system locally (no keys, no testnet)

```bash
pnpm --filter @aven/scripts local:once     # anvil + mock precompiles + all 5 deploy scripts + smoke swaps verified
pnpm --filter @aven/arena demo:local       # local chain + in-process Arena: shock -> bot -> stats -> verify;
                                           # also rewrites frontend/public/arena-fallback.json ("Recorded run")
```

To keep a local chain running and point the Arena at it:

```bash
pnpm --filter @aven/scripts local:up       # stays up; writes contracts/deployments/31337.json
# then, with CHAIN_ID=31337, HYPEREVM_RPC=http://127.0.0.1:8545 and anvil accounts #1/#2 as BOT_PK/SHOCK_PK:
pnpm --filter @aven/arena start            # serves http://localhost:8787
```

### Replay and verify

```bash
pnpm --filter @aven/scripts fetch-market-data   # Hyperliquid mainnet candles + funding -> backend/data/raw/
pnpm replay:binance-halt                        # four-pool replay -> backend/data/replay/*.csv, *.summary.json
pnpm replay:calm
pnpm --filter @aven/scripts replay-to-web       # -> frontend/public/replay/*.json

pnpm verify <txHash>                            # recompute the fee of every FeeComputed in a tx (exit 1 on mismatch)
CHAIN_ID=998 pnpm verify --all                  # every FeeComputed since deployment, in <= 50-block chunks
```

### Environment variables

Each tool reads its own folder's `.env`. Only the `.env.example` files are committed, and they hold placeholders.

| File | Variable | Purpose |
|---|---|---|
| `contracts/.env` | `DEPLOYER_PK` | deployer key for `forge script` |
| | `BOT_ADDRESS`, `SHOCK_ADDRESS` | wallets that receive test tokens |
| | `HYPEREVM_RPC` | default `https://rpc.hyperliquid-testnet.xyz/evm` |
| `backend/.env` | `BOT_PK`, `SHOCK_PK` | Arena bot and shock wallet keys |
| | `ARENA_ADMIN_TOKEN` | required on POST routes (≥ 8 chars) |
| | `ARENA_CORS_ORIGINS` | allowlist, default `http://localhost:3000` |
| | `HYPEREVM_RPC`, `HL_INFO_API_TESTNET`, `HL_INFO_API_MAINNET` | chain RPC and Hyperliquid info API |
| | optional: `CHAIN_ID` (998), `ARENA_PORT` (8787), `MAX_TRADE_BASE` (5), `MAX_TRADE_QUOTE` (10,000), `SHOCK_QUOTE` (40,000), `SHOCK_BASE` (15), `MIN_NATIVE_BALANCE` (0.01), `NATIVE_USD` (0), `POLL_MS` (500), `POST_RATE_LIMIT_PER_MIN` (30) | Arena tuning |
| `frontend/.env.local` | `NEXT_PUBLIC_ARENA_API`, `NEXT_PUBLIC_RPC`, `NEXT_PUBLIC_CHAIN_ID` | public values only, never keys |

---

## Deployment (HyperEVM testnet)

Uniswap lists no v4 deployment on HyperEVM testnet, so Aven deploys its own PoolManager. It is built with v4-core's own compiler profile, **byte-identical to Uniswap's HyperEVM mainnet PoolManager**, and deployed with `owner = address(0)`, so nobody can ever switch on a protocol fee. The full runbook is [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md).

```mermaid
flowchart TD
  A["Deployer funded and made a HyperCore user"] --> B["Big blocks ON (evmUserModify)"]
  B --> C["DeployCore: PoolManager (v4core profile) + test routers"]
  C --> D["Big blocks OFF"]
  D --> E["DeployTokens: aETH (18 dec) / aUSD (6 dec)"]
  E --> F["DeployAven: check perpAssetInfo(4).coin == ETH, mine 0x2080 salt, CREATE2"]
  F --> G["CreatePools: Aven pool (dynamic fee) + control pool (0.30%) at the live oracle price"]
  G --> H["Smoke: one swap each way on both pools"]
  H --> I["pnpm verify: MATCH, commit deployments/998.json"]
```

- **Live asset: testnet ETH** (perp index 4, `szDecimals` 4). Testnet HYPE's oracle was ~91× its mark, so it isn't usable. The replay still uses **mainnet HYPE**.
- **Mock tokens, real price.** The pools trade mock `aETH` / `aUSD` (open mint, testnet only, never worth anything), while the hook reads the **real** HyperCore ETH perp price. That works because the hook only needs the base asset's price, and the pool is initialized at that price.
- There's no HyperEVM testnet block explorer, so transaction links go to the web app's `/tx/<hash>` page and to `pnpm verify <tx>`.

| Deployed (chain 998) | Address / tx |
|---|---|
| PoolManager · AvenHook · aETH / aUSD · pool ids · smoke swaps | **TODO: pending the testnet deploy** |
| Web app | **TODO: URL once deployed** |

---

## What Aven does not claim

- **Nothing is on testnet yet.** Every on-chain number in this README comes from a local anvil chain running the real deploy scripts, with `MockHyperCorePx` at the precompile addresses. The real precompiles were checked separately: live testnet reads match the info API after scaling ([docs/recon.md](docs/recon.md) §C).
- **The verifier proves the arithmetic, not the history.** It shows that the fee equals the formula applied to the logged inputs, and that the PoolManager charged exactly that fee. It does not prove that the logged oracle and mark equal HyperCore's history.
- **The replay is a simulation.** It uses a proxy for the oracle, 5-minute steps and one LP position per pool. It compares pools fairly against each other; it doesn't predict absolute returns.
- **Only assets with a HyperCore perp.** For Hyperliquid-native assets, the oracle may exclude external venues.
- **Splitting an arb across blocks lowers the fee somewhat.** The top-of-block anchor only covers one block. This is an accepted limitation; competing arbitrageurs take the first block.
- **No hedging and no LP management.** LPs still bear directional risk.
- **Parameters are calibrated, not optimized.** It is not audited, and `slither` hasn't been run yet (`forge lint`: 0 warnings in `src/`).

Threat model, each threat mapped to its test: [docs/SECURITY.md](docs/SECURITY.md).

## What was hard

- **No v4 on HyperEVM testnet.** We had to build and deploy a PoolManager ourselves. It is ~24 KB, too big for a 3M-gas small block, so it needs HyperEVM's big blocks, and only a HyperCore user can switch to those.
- **v4 tooling has moved.** `BaseHook` left v4-periphery (we use OpenZeppelin's), HookMiner moved to `test/shared/`, and v4-core's only tag (`v4.0.0`) predates `PoolOperation.sol`, so we pinned the commit OpenZeppelin pins.
- **The dynamic-fee zero trap.** A dynamic pool's stored LP fee is 0, so one missing override flag means free swaps. That's why I3 has a dedicated test, an invariant and a mutation check.
- **Precompile failure modes.** Reads can revert, return 0 bytes (local chains have no code there), return words wider than `uint64`, or burn all forwarded gas. Each mode has a test.
- **A 1-second-block chain exposes defaults.** The load tests found viem's ~4 s block-number cache, viem's 4 s receipt polling, a stampeding per-block cache, and gas estimates that miss the first-swap-of-block path. All four are fixed with regression tests.

## Roadmap

- [ ] Testnet deployment and live verified transactions (runbook ready)
- [ ] Web app: Home, Arena (pool cards, trade tape, Verify drawer), Replay ([docs/spec/FRONTEND.md](docs/spec/FRONTEND.md))
- [ ] A third replay scenario (`volatile-2`; the window is still to be picked)
- [ ] `slither` pass, with the findings recorded in SECURITY.md
- [ ] A multi-block decaying gap anchor, to close the cross-block split-arb gap
- [ ] Combine Aven's external fair value with `VolatilePairHook`-style skew
- [ ] HIP-3 markets (equities, commodities) and a spread signal from the `bbo` precompile (`0x80e`)
- [ ] A governance-free parameter search over replay data

---

## Team

| Name | Role |
|---|---|
| Sayan Roy ([@mesayanroy](https://github.com/mesayanroy)) | contracts, backend, proofs |
| _TODO_ | frontend |

## Disclosure

- **Pre-event planning.** The files in [docs/planning/](docs/planning/) were written **before kickoff**. They contain ideas and specs only, no code. The code was written during the event; the history starts with the bootstrap commit `5934448` on 2026-11-05.
- **AI use.** The AI coding assistant's prompts are logged verbatim in [docs/ai/PROMPTS.md](docs/ai/PROMPTS.md), and [docs/ai/ATTRIBUTION.md](docs/ai/ATTRIBUTION.md) lists every file it wrote or helped write.
- `contracts/src/interfaces/IDynamicFeeHook.sol` is a verbatim MIT copy of Uniswap's interface from `Uniswap/v4-hooks-public@c45509f`.

## License

[MIT](LICENSE)
