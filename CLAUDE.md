# Aven — instructions for Claude Code

## Product

Aven is a Uniswap v4 fee library and hook on HyperEVM that prices every swap from Hyperliquid's in-block perp market, so LPs stop losing money to arbitrageurs (LVR). Before each swap, `AvenHook` reads HyperCore's oracle price (`0x…0807`) and perp mark price (`0x…0806`) in the same block. These reads go through `AvenFairValue`, an internal-function library any v4 hook can import. The hook combines three signals:

- a fair-value gap, anchored at the pool price at the top of the block;
- the perp premium (mark − oracle);
- mark stress against a time-weighted anchor.

From them it returns a clamped, direction-specific override fee, which goes to LPs. It emits `FeeComputed` with every input, so the fee can be recomputed off-chain. `AvenHook` implements Uniswap's `IDynamicFeeHook`, so anything that quotes Uniswap's dynamic-fee hooks can quote Aven. There is no oracle operator, keeper, model, owner, upgrade path or custody. Proofs: the Arena (a live bot vs a fixed-0.30% control pool on HyperEVM testnet), a Solidity↔TypeScript differential test, a mainnet-data replay (Oct 29 2026 Binance halt), and a verifier.

**Positioning (§4):** Uniswap's own `VolatilePairHook` learns from the pool's past; Aven reads the market's present.

## Sources of truth

- **`docs/spec/ARCHITECTURE.md` is normative; read the relevant section before every task.** It wins over everything else.
- `docs/spec/API.md` (B4), `DATA.md` (B5), `FRONTEND.md` (B6), `TOOLS.md` (B7): verbatim from `docs/planning/aven-claude-code-prompts.md` Part B.
- `docs/recon.md`: facts verified in installed deps and on the live chain, plus decisions.
- `docs/planning/aven-claude-code-prompts.md`: the build prompts (P0–P13) and their gates.

## Invariants (ARCHITECTURE §6.6, verbatim)

| # | Invariant | Proven by |
|---|---|---|
| I1 | A swap never reverts because of a precompile read | unit + invariant (failure injection) |
| I2 | `fee ∈ [minFee, maxFee]`, or `fee == fallbackFee` with `reason ≠ OK` | fuzz + invariant |
| I3 | The override flag is set on every `beforeSwap` return | integration (Swap event `fee` ≠ 0) |
| I4 | The hook never holds tokens and returns `ZERO_DELTA` | invariant (balances 0) |
| I5 | No state-changing external function except `beforeInitialize` / `beforeSwap` (onlyPoolManager) | code review + slither |
| I6 | `previewFee(key, d).fee == fee charged` for the same pre-state | integration |
| I7 | Solidity `compute` == TypeScript `compute` on every vector | differential (10k vectors) |
| I8 | `FeeComputed` inputs are enough to recompute `fee` exactly | live verifier |
| I9 | Anchor changes only when both reads succeed; top-of-block changes only on the first swap of a block | unit + invariant |
| I10 | A pool with other currencies or a static fee can't initialize with the hook | unit |

## Design rules that must never be broken

- Every `beforeSwap` return sets `OVERRIDE_FEE_FLAG` (`0x400000`), the fallback included. Dynamic pools start at LP fee 0 (§2.3).
- Hook permissions are `beforeInitialize` + `beforeSwap` only (hook address low 14 bits = `0x2080`).
- Precompile reads are non-reverting and gas-capped (§3.2). Each call forwards exactly `Params.precompileGas`. Never call hyper-evm-lib's `PrecompileLib` on the swap path; it reverts and forwards all gas.
- Fee math is integer-only and identical in Solidity and TypeScript (BigInt; no floats in fee math).
- The hook has no owner, setters, proxy, `receive` or token handling.

## Hard scope rules

- No perp hedging; the bot never trades perps.
- No CoreWriter calls, ever.
- No custody, and no admin keys.
- No extra sponsor integrations (Uniswap is the only partner track).
- Never hard-code demo numbers in live views. Every number carries a source label and a "Live testnet" / "Replay" / "Recorded run" badge.
- Never guess external APIs, addresses, signatures or scaling. Verify them from installed deps, official docs or RPC output, and record the finding with its source in `docs/recon.md`. If you can't verify it, mark it UNVERIFIED with a fallback.
- Never commit secrets: `.env*` is ignored; only `.env.example` (placeholders) is committed.
- Never copy pre-event code or designs into the repo.

## Workflow

- Small commits after each passing step, with conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `data:`).
- Run tests before committing (`forge test` in `contracts/`, `pnpm test` in TS packages). Don't commit red.
- **Never weaken a test to make it pass.** Find the root cause, and don't change the spec without asking.
- Foundry may not be on PATH on this machine; it lives at `~/.foundry/bin`.

## AI attribution (required by ETHGlobal)

- Append every user prompt **verbatim** to `docs/ai/PROMPTS.md` as a new numbered entry with a timestamp (ISO 8601, UTC).
- Keep `docs/ai/ATTRIBUTION.md` up to date: one row per file AI wrote or helped with (`file | written by | notes`).
