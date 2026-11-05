# Aven — instructions for Claude Code

## Product

Aven is a Uniswap v4 hook on HyperEVM that prices every swap from Hyperliquid's live perp market, so LPs stop losing value to arbitrageurs (LVR). Before each swap, the hook reads HyperCore's oracle price (precompile `0x…0807`) and perp mark price (`0x…0806`) in the same block. It computes three signals: fair-value gap, perp premium and mark velocity. From them it sets a clamped dynamic fee, which goes to LPs. There is no oracle operator, keeper, relayer, model or admin. The product is `HyperFairValue`, a Solidity library any v4 hook can import. Around it we ship a reference hook (`PerpAwareHook`), a read-only `FeeQuoter`, an Arena demo (a live arbitrage bot against a hooked pool and a plain control pool on HyperEVM testnet), an Oct 29 2026 replay, and a verify script that recomputes every fee from logged inputs. Built for ETHGlobal Mumbai 2026, Uniswap track.

Specs live in `docs/spec/` (ARCHITECTURE, FEE_SPEC, CONTRACTS, API, DATA, FRONTEND, TOOLS). Verified external facts live in `docs/recon.md`. Read both before changing contracts or integrations.

## Invariants (from FEE_SPEC / CONTRACTS)

1. **Never revert a swap on a bad read.** Any failed, short, zero or implausible precompile read (gap > 2,000 bps) → fallback fee (0.30%).
2. **Fee is clamped or exactly fallback.** Every returned fee is within [f_min, f_max] = [0.05%, 1.00%], or exactly the fallback.
3. **No owner, no setters, no custody.** Everything is immutable. The hook holds no tokens and has no delta-returning permissions. Its only permissions are `beforeInitialize` and `beforeSwap`.
4. **Same math in Solidity and TypeScript.** Hook, quoter, verifier, bot and web all use `HyperFairValue` or its exact TS port in `packages/core`. A differential test (10,000 random inputs) must match exactly.
5. **Gas-capped precompile calls.** Every precompile `staticcall` forwards a fixed gas cap (invalid input burns all forwarded gas).
6. Prices are normalised with `szDecimals` (perp: human = raw / 10^(6 − szDecimals)). An immutable `baseIsToken0` handles token order.

## Hard rules

- No perp hedging, vaults or perp trading, by the hook or by the bot.
- No CoreWriter calls, ever.
- No custody: no contract holds user funds.
- No admin keys, owners, pausers or upgradeability.
- No extra sponsor integrations (Uniswap is the only partner track).
- Never hard-code demo numbers in live views. Live views show chain data with its source and a "live testnet" / "replay" badge.
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
