# AGENTS.md — rules for every agent and teammate on Aven

This file is the single rulebook for humans and AI agents (Claude Code, Codex, Cursor, …). `CLAUDE.md` only points here.

## 0. Rules that override everything

1. **Never `git push` until Sayan explicitly says "push"** in the current conversation. Commit locally; pushing is his call every time. Never force-push.
2. **No AI tags in git.** No `Co-Authored-By: Claude …` (or any AI co-author) trailer, and no "Generated with …" lines in commits or PRs. Commits are authored by the repo's configured git identity (`git config user.name` / `user.email`); check it before the first commit of a session.
3. **One branch: `main`.** Don't create branches, tags or worktrees unless asked.
4. **Keep the docs in sync.** Any change that adds, moves or rewires code updates [docs/FLOW.md](docs/FLOW.md) (how code flows) **and** [docs/MEMORY.md](docs/MEMORY.md) (status, decisions, open items) **in the same commit**.
5. **Log every prompt.** Append each user prompt verbatim, with an ISO-8601 UTC timestamp, to [docs/ai/PROMPTS.md](docs/ai/PROMPTS.md), and keep [docs/ai/ATTRIBUTION.md](docs/ai/ATTRIBUTION.md) current (`file | written by | notes`). ETHGlobal requires this disclosure; it is separate from rule 2.
6. **Don't add folders or files that aren't needed.** Create a folder only when code goes into it. The repo root stays: `backend/ contracts/ docs/ frontend/` plus the tool files.

## 1. Read order before any task

1. This file.
2. [docs/MEMORY.md](docs/MEMORY.md): current status, decisions, open questions.
3. [docs/FLOW.md](docs/FLOW.md): entry and exit points of the part you're touching.
4. [docs/spec/ARCHITECTURE.md](docs/spec/ARCHITECTURE.md): **normative**; read the § for your task. It wins over everything except section 0 above.
5. [docs/recon.md](docs/recon.md): verified facts (paths, addresses, scaling, gas, RPC limits).
6. The build prompt you were given (from [docs/planning/aven-claude-code-prompts.md](docs/planning/aven-claude-code-prompts.md)) and its Gate.

## 2. Repo layout (team decision, 2026-11-06)

```
backend/     off-chain TypeScript: core (fee port, ABIs, verifier), arena (bot service), scripts, data
contracts/   Foundry: AvenFairValue, AvenHook, interfaces, tests, scripts, deployments
frontend/    Next.js app (Home, Arena, Replay)
docs/        spec/ (normative), recon.md, PLAN.md, MEMORY.md, FLOW.md, DEPLOYMENTS.md, PROOFS.md, SECURITY.md, ai/ (prompts + attribution), planning/ (pre-kickoff)
```

The spec and the build prompts still use the original paths. **Translate them with this table:**

| Spec / prompt path | Actual path |
|---|---|
| `packages/core/` | `backend/core/` (package name `@aven/core`) |
| `services/arena/` | `backend/arena/` |
| `scripts/` | `backend/scripts/` |
| `data/{raw,replay,vectors,arena}/` | `backend/data/{raw,replay,vectors,arena}/` |
| `apps/web/` (incl. `public/replay`, `public/arena-fallback.json`) | `frontend/` (`frontend/public/…`) |
| root `.env.example` | `contracts/.env.example`, `backend/.env.example`, `frontend/.env.example` (each tool reads its own folder) |
| `docs/spec/TOOLS.md` (B7) | removed; it's in the prompts file, Part B7 |
| `contracts/…` | unchanged |
| Live Arena asset: HYPE, `aHYPE`, `coin == "HYPE"` (P5, §8.3, §11.3) | **testnet ETH: perp index 4, szDecimals 4, `aETH`, `coin == "ETH"`**. The replay still uses HYPE mainnet (index 159). |
| Explorer links (`explorer` in §8.3, B4 `/config`, B6 tx links) | our frontend route `/tx/<hash>`; no HyperEVM testnet explorer exists |

**Ownership for parallel work:** contracts → `contracts/`, backend → `backend/`, frontend → `frontend/`. These cross-team contracts are frozen, and changes to them need both sides to agree:
- `contracts/deployments/<chainId>.json` (ARCHITECTURE §8.3);
- ABIs generated into `backend/core` from `contracts/out`;
- the HTTP + SSE API in [docs/spec/API.md](docs/spec/API.md);
- the file formats in [docs/spec/DATA.md](docs/spec/DATA.md).

Before starting, run `git pull --rebase origin main` so you build on your teammate's latest commits.

## 3. Product in one paragraph

Aven is a Uniswap v4 fee library (`AvenFairValue`) and hook (`AvenHook`) on HyperEVM. It prices every swap from Hyperliquid's in-block perp market: oracle `0x…0807` and mark `0x…0806`. From these it computes three signals:
- a top-of-block-anchored fair-value gap,
- the perp premium,
- mark stress against a time-weighted anchor.

It returns a clamped, direction-specific override fee that goes to LPs, and emits `FeeComputed` with every input. It implements Uniswap's `IDynamicFeeHook`. There is no operator, keeper, owner, upgrade path or custody. Positioning: Uniswap's `VolatilePairHook` learns from the pool's past; Aven reads the market's present.

## 4. Invariants (ARCHITECTURE §6.6, verbatim)

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

## 5. Design rules that must never be broken

- Every `beforeSwap` return sets `OVERRIDE_FEE_FLAG` (`0x400000`), the fallback included. Dynamic pools start at LP fee 0 (§2.3).
- Hook permissions are `beforeInitialize` + `beforeSwap` only (hook address low 14 bits = `0x2080`).
- Precompile reads are non-reverting and gas-capped (§3.2). Each call forwards exactly `Params.precompileGas`. Never use hyper-evm-lib's `PrecompileLib` on the swap path.
- Fee math is integer-only and identical in Solidity and TypeScript (BigInt; no floats).
- The hook has no owner, setters, proxy, `receive` or token handling.

## 6. Scope rules

- No perp hedging; the bot never trades perps.
- No CoreWriter calls.
- No custody, and no admin keys.
- No extra sponsor integrations.
- Never hard-code demo numbers in live views. Every number carries a source label and a "Live testnet" / "Replay" / "Recorded run" badge.
- Never guess external APIs, addresses, signatures or scaling. Verify them and record the evidence in `docs/recon.md`; if you can't, mark it UNVERIFIED with a fallback.
- Never commit secrets. Only `.env.example` files with placeholders are tracked.
- Never copy pre-event code or designs into the repo.

## 7. Workflow

- Small commits after each passing step, with conventional messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `data:`).
- Run tests before committing: `forge test` in `contracts/`, `pnpm test` in `backend/*` and `frontend/`. Don't commit red.
- Never weaken a test to make it pass. Find the root cause, and ask before changing the spec.
- Foundry lives at `~/.foundry/bin` (it may not be on PATH).
- Build the deployable PoolManager with `FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol` (see recon A.5).
