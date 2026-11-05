# Aven — instructions for Claude Code

## Product

Aven is a perp-aware dynamic-fee library and reference hook for Uniswap v4 on HyperEVM. It stops LPs losing value to arbitrageurs (LVR). Before each swap, the hook reads HyperCore's oracle price (precompile `0x…0807`) and perp mark price (`0x…0806`) in the same block. It computes three signals:

- **Fair-value gap**, anchored at the pool price at the top of the block
- **Perp premium**, mark vs oracle
- **Mark stress**, against a time-weighted mark anchor

From them it returns a clamped, direction-specific override fee, and the fee goes to LPs. There is no owner, keeper, signer, relayer, model, upgrade path or custody.

The product is `AvenFairValue`, an internal-function library any v4 hook can import. Around it we ship:

- `AvenHook`, the reference hook. It implements Uniswap's `IDynamicFeeHook.getFee` plus `previewFee`, and emits `FeeComputed` with every input.
- The Arena: a live arbitrage bot against an Aven pool and a fixed-0.30% control pool on HyperEVM testnet.
- A Foundry replay of Oct 29 2026 and other windows on mainnet data.
- A verifier that recomputes every fee from logged inputs.

Built for ETHGlobal Mumbai 2026, Uniswap track.

## Sources of truth (in priority order)

1. `docs/description/AVEN_ARCHITECTURE.md`: **normative**; wins over everything below.
2. `docs/recon.md`: facts verified on the live chain and from installed deps, plus decisions.
3. `docs/spec/*.md`: interim stand-ins copied from the pre-kickoff handoff. Appendix B of `docs/planning/aven-claude-code-prompts.md` is **not in the repo yet**. Where the architecture doc says "as in prompts file B1/B4/B5/B6", ask instead of guessing.

Names (from the architecture doc): `AvenFairValue`, `AvenHook`, `IAvenHook`, `IDynamicFeeHook` (local MIT copy), `MockHyperCorePx`. There is **no separate FeeQuoter contract**; quoting is `getFee` / `previewFee` on the hook. Older planning names (`HyperFairValue`, `PerpAwareHook`, `FeeQuoter`) are obsolete.

## Invariants (architecture §6.6)

1. **Never revert a swap on a bad read.** Reads are non-reverting `staticcall`s. `readOk` requires both calls to succeed, return ≥ 32 bytes, and decode to a value > 0. Otherwise use `fallbackFee` (`reason = READ_FAILED`). If gap > `maxGapBps`, use `fallbackFee` (`reason = GAP_TOO_LARGE`).
2. **Fee is clamped or exactly fallback.** `fee ∈ [minFee, maxFee]`, or `fee == fallbackFee` with `reason ≠ OK`.
3. **Always set `OVERRIDE_FEE_FLAG`** on every `beforeSwap` return, the fallback included. A dynamic pool's stored LP fee is 0.
4. **No owner, no setters, no custody.** Everything is immutable. The hook holds no tokens, returns `ZERO_DELTA`, and has only `beforeInitialize` + `beforeSwap` permissions (address low bits `0x2080`). No `receive`, no proxy.
5. **Same math in Solidity and TypeScript.** `packages/core/fee.ts` is a line-for-line BigInt port (no floats in fee math). A differential test (10k vectors) must match exactly. `previewFee` must equal what `beforeSwap` charges for the same pre-state.
6. **Gas-capped precompile calls.** Every precompile call forwards exactly `Params.precompileGas` (default 30,000; constructor requires ≥ 10,000). Invalid input burns all forwarded gas.
7. **The hook never calls hyper-evm-lib's `PrecompileLib` on the swap path** (it reverts and forwards all gas).
8. Prices are normalised with `szDecimals` (perp: human = raw / 10^(6 − szDecimals)). An immutable `baseIsToken0` handles token order.

## Hard rules

- No perp hedging, vaults or perp trading, by the hook or by the bot.
- No CoreWriter calls, ever.
- No custody: no contract holds user funds.
- No admin keys, owners, pausers or upgradeability.
- No extra sponsor integrations (Uniswap is the only partner track).
- Never hard-code demo numbers in live views. Every number carries a source label and a "Live testnet" / "Replay" / "Recorded run" badge.
- Never guess external APIs, addresses, signatures or scaling. Verify them from installed deps, official docs or RPC output, and record the finding with its source in `docs/recon.md`. If you can't verify something, mark it UNVERIFIED and use a fallback.
- Never commit secrets. `.env*` is ignored; only `.env.example` with placeholders is committed.
- Never copy pre-event code or designs into the repo.

## Workflow

- Work in small steps. Commit after each passing step.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
- Run the relevant tests before committing (`forge test` in `contracts/`, `pnpm test` in TS packages). Don't commit red.
- Foundry may not be on PATH on this machine; it lives at `~/.foundry/bin`.

## AI attribution (required by ETHGlobal)

- Append every user prompt **verbatim** to `docs/ai/PROMPTS.md` as a new numbered entry with a timestamp (ISO 8601, UTC).
- Keep `docs/ai/ATTRIBUTION.md` up to date: one row per file that AI wrote or helped with (`file | written by | notes`).
