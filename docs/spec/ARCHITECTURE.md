<!-- INTERIM STAND-IN for Appendix B1 -->
> **Interim stand-in.** Appendix B1 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§6 Architecture). Replace this whole file with Appendix B1 verbatim once the prompts file is added.

## Monorepo layout (from the P0 prompt; Appendix B1 not yet available)

```
contracts/        Foundry project (HyperFairValue, PerpAwareHook, FeeQuoter, mocks, scripts)
packages/core/    TypeScript port of the fee math (shared by bot, verifier, web)
services/arena/   Arena bot, shock script, verify script
apps/web/         Next.js app (Arena + Replay)
data/raw/         Raw market data pulled from the Hyperliquid info API
data/replay/      Replay inputs and results CSVs
docs/spec/        Specs (this folder)
docs/planning/    Pre-kickoff planning files
docs/ai/          AI prompts log and attribution
```

## 6. Architecture

```
            LPs                Swappers / routers            Arena bot (demo)
             │                         │                          │
─────────────┼─────────── HyperEVM (on-chain) ─────────────────────┼──────────
             ▼                         ▼                          ▼
      ┌────────────────────────────────────────────────────────────────┐
      │ Uniswap v4 PoolManager: hooked pool + plain control pool       │
      └───────────────┬────────────────────────────────────────────────┘
                      │ beforeSwap (hooked pool only)
      ┌───────────────▼──────┐   ┌──────────────┐   ┌──────────────────────┐
      │ PerpAwareHook        │──▶│ HyperFairValue│◀──│ FeeQuoter.previewFee │
      │ (reference hook)     │   │ (the product) │   └──────────────────────┘
      └───────────┬──────────┘   └──────┬────────┘
                  │ FeeComputed           │ staticcall (gas-capped)
                  │                       ▼
                  │          HyperCore: oracle 0x807, mark 0x806 (in-block)
──────────────────┼────────────── Off-chain (proof and demo) ─────────────────
                  ▼
   Web app (Arena + Replay) · Verify script · Replay engine · Market data CSV
```

**Trust path:** PoolManager → hook → `HyperFairValue` → HyperCore precompiles. Nothing off-chain can change a fee.

**Swap lifecycle**
1. A router or the bot calls `FeeQuoter.previewFee`.
2. The swap reaches the PoolManager. The control pool charges its fixed fee; the hooked pool calls `beforeSwap`.
3. The hook calls `HyperFairValue`: reads oracle and mark, computes three signals and the fee.
4. The hook stores the new mark snapshot and returns `fee | OVERRIDE_FEE_FLAG`.
5. The swap executes; the fee accrues to LPs as usual.
6. `FeeComputed` is emitted with raw inputs; the app shows it, the verifier recomputes it.

---
