# FLOW.md — how code flows through Aven

How every part runs: where it **starts** (entry point), what it calls, and where it **ends** (exit point: output, event, file or response). Update this file in the same commit as any change that adds, moves or rewires code (AGENTS.md rule 4).

**Status:** ✅ exists in the repo · 🔜 planned (the build prompt that creates it). Section numbers (§) refer to [spec/ARCHITECTURE.md](spec/ARCHITECTURE.md).

_Last updated: 2026-11-06. Live Arena asset is testnet ETH (perp 4); tx links go to our own `/tx/<hash>` page (no testnet explorer). Only recon code exists so far._

---

## 0. The big picture

```mermaid
flowchart LR
  subgraph contracts["contracts/ (Solidity, Foundry)"]
    FV["AvenFairValue (library) 🔜P2"]
    HK["AvenHook 🔜P3"]
    SC["script/*.s.sol 🔜P5"]
    DEP["deployments/998.json 🔜P5"]
    REP["test/replay/Replay.t.sol 🔜P8"]
    VEC["test/vectors/GenVectors.t.sol 🔜P4"]
  end
  subgraph chain["HyperEVM (chain 998)"]
    PM["Uniswap v4 PoolManager (ours, canonical build)"]
    PC["HyperCore precompiles 0x806 mark / 0x807 oracle"]
  end
  subgraph backend["backend/ (TypeScript)"]
    CORE["core: fee.ts, verify.ts, abi.ts 🔜P4"]
    ARENA["arena: poller, bot, shock, API+SSE 🔜P6"]
    SCR["scripts: fetch-market-data, replay-to-web 🔜P7/P8"]
    DATA["data/: raw, replay, vectors, arena"]
  end
  subgraph frontend["frontend/ (Next.js) 🔜P10"]
    WEB["Home · Arena · Replay"]
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

## 1. A swap through the Aven pool (the product, on-chain) 🔜P2/P3

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

## 2. Pool creation 🔜P3/P5

- **Entry:** `PoolManager.initialize(key, sqrtPriceX96)`.
- **Path:** `Hooks.beforeInitialize` → `AvenHook._beforeInitialize`. It requires `key.fee == DYNAMIC_FEE_FLAG` (else `MustUseDynamicFee`) and `{currency0, currency1} == sorted(base, quote)` (else `WrongCurrencies`), then marks the pool initialized.
- **Exit:** the pool exists, with LP fee 0 (§2.3), or the call reverts (I10).

## 3. Quoting (read-only) 🔜P3

- **Entry:** `AvenHook.getFee(key)` (`IDynamicFeeHook`) or `AvenHook.previewFee(key, zeroForOne)`. Called by routers, the Arena bot (`eth_call`) and the frontend.
- **Path:** `_load(poolId)` only; no storage writes. Unknown pool → `PoolNotInitialized`.
- **Exit:** `(feeZeroForOne, feeOneForZero)` or the full `Breakdown`. It equals what `beforeSwap` would charge in the same state (I6).

## 4. Deployment to testnet 🔜P5

- **Entry:** `forge script` in `contracts/script/`. Keys come from `contracts/.env`.
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

## 5. Arena service (live demo bot) 🔜P6

- **Entry:** `pnpm arena:start` (or `arena:dev`) → `backend/arena` main. It loads `backend/.env` and `contracts/deployments/998.json`, and reloads `backend/data/arena/trades.jsonl`.
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
- **Admin entry:** `POST /shock` sends one identical swap on both pools from the **shock wallet**. Also `POST /bot/start`, `/bot/stop` and `/reset-stats`; all of these need `x-admin-token`.
- **Exit:**
  - REST JSON and the SSE stream to the frontend ([spec/API.md](spec/API.md));
  - swaps on chain;
  - `backend/data/arena/trades.jsonl`.

## 6. Verifier 🔜P4 (library) / P9 (CLI)

- **Entry:** `pnpm verify <txHash>`, `pnpm verify --all` (`backend/core/bin/verify.ts`), or `GET /verify/:tx` on the Arena service.
- **Path:**
  1. fetch the receipt; decode each `FeeComputed` and its matching PoolManager `Swap` log;
  2. rebuild `Inputs`;
  3. recompute with `backend/core/src/fee.ts`;
  4. check A (recomputed == event fee) and check B (`Swap.fee` == expected).

  `--all` scans logs in ≤ 50-block chunks (recon B.3).
- **Exit:** MATCH or MISMATCH plus every intermediate value. The CLI prints them; the API returns them as JSON.

## 7. Differential proof (Solidity ≡ TypeScript) 🔜P4

- **Entry:** `pnpm prove:diff`.
- **Path:** `contracts/test/vectors/GenVectors.t.sol` (`vm.writeJson`, fixed seed) → `backend/data/vectors/fee-vectors.json` + `anchor-vectors.json` → `backend/core/test/differential.test.ts` (vitest) recomputes each vector in TS.
- **Exit:** 10,000/10,000 fee vectors and 2,000/2,000 anchor vectors match, or the test fails (I7).

## 8. Replay (mainnet history, offline) 🔜P7/P8

- **Entry:** `pnpm replay:<scenario>`.
- **Path:**
  1. `backend/scripts/fetch-market-data.ts` calls the Hyperliquid **mainnet** info API (`candleSnapshot` 1m, `fundingHistory`) and writes `backend/data/raw/<scenario>/` + `normalized.csv`;
  2. `contracts/test/replay/Replay.t.sol` runs a local PoolManager with 4 pools (fixed 0.05%, fixed 0.30%, Aven-delayed, Aven-live), `MockHyperCorePx` etched at 0x806/0x807, and per step `vm.warp`/`vm.roll`, an arb agent and a seeded retail agent;
  3. it writes `backend/data/replay/<scenario>.csv` + `.summary.json`;
  4. `backend/scripts/replay-to-web.ts` writes `frontend/public/replay/<scenario>.json`.
- **Exit:** CSV and summary files, plus the downsampled JSON that the Replay page loads.

## 9. Frontend 🔜P10

- **Entry:** a browser opens the Vercel URL. Next.js App Router pages: `/` (Home), `/arena`, `/replay`, and `/tx/[hash]`. That last one is our explorer stand-in: it shows the receipt and decoded `FeeComputed`/`Swap` from `NEXT_PUBLIC_RPC`, plus the verify result.
- **Path:**
  - Arena reads `NEXT_PUBLIC_ARENA_API` (`/config`, `/state`, `/stats`, `/trades`, `/stream` SSE, `/verify/:tx`);
  - direct chain reads go through `NEXT_PUBLIC_RPC` (wagmi/viem, chain 998);
  - Replay loads `frontend/public/replay/*.json`;
  - when the service is offline, the page shows `frontend/public/arena-fallback.json`, labelled "Recorded run";
  - admin buttons (`?admin=<token>`) POST to the backend.
- **Exit:** the rendered UI. Every number carries a source label and a badge.

## 10. Tests and checks

| Command (run in) | Entry file | What it proves | Status |
|---|---|---|---|
| `forge test --match-path "test/recon/*"` (`contracts/`) | `contracts/test/recon/Recon.t.sol` | v4 paths and constants, mock-etch plan, gas-cap containment | ✅ 7 pass, 1 skipped |
| `FORK_READ=1 forge test --match-test test_forkRead` (`contracts/`) | same | live testnet `perpAssetInfo` / mark / oracle reads | ✅ passes |
| `FOUNDRY_PROFILE=v4core forge build --sizes lib/v4-core/src/PoolManager.sol` (`contracts/`) | v4-core `PoolManager.sol` | canonical PoolManager, 24,009 B | ✅ |
| unit, fuzz, integration, invariant, replay | `contracts/test/{unit,integration,invariant,replay}/` | §9 | 🔜 P2, P3, P8, P11 |
| `pnpm test` | `backend/*`, `frontend/` | TS port, bot math, UI | 🔜 P4, P6, P10 |

## 11. What exists today ✅

- `contracts/src/interfaces/IDynamicFeeHook.sol`: Uniswap's quoting interface (verbatim MIT copy).
- `contracts/test/recon/Recon.t.sol`: recon checks (above).
- `contracts/foundry.toml`: `default` profile (our code + tests) and `v4core` profile (deployable PoolManager); RPC aliases `hyperevm_testnet` / `hyperevm_mainnet`.
- `contracts/lib/*`: pinned dependencies (recon A.1).
- `backend/`, `frontend/`: README + `.env.example` only.
