# MEMORY.md — project memory

The running record of status, decisions and open items. It saves you from re-reading the whole history. Update it in the same commit as any change (AGENTS.md rule 4). Newest entries go first in each section.

## Status

| Prompt | State | Commit(s) / notes |
|---|---|---|
| P0 bootstrap | ✅ done | `5934448`, aligned in `f94f3b5` |
| P1 recon | ✅ done; gate passed (precompile = info API after scaling) | `2a56c3b`; details in [recon.md](recon.md) |
| Repo restructure | ✅ done 2026-11-06 | backend/, contracts/, frontend/; AGENTS.md, MEMORY.md, FLOW.md |
| Backend build loop | ▶ running, see [PLAN.md](PLAN.md) | started 2026-11-06 |
| **P2 AvenFairValue** | ⏭ next (PLAN 1.1) | — |
| P3–P13 | not started | — |

GitHub: `origin` = github.com/SATISH-JALAN/Aven (private), branch `main` only. Last push: 2026-11-06 (`40f5174`). **Local commits after that are not pushed** until Sayan says so.

## Decisions (with date and reason)

- **2026-11-06: Replay data interval.** HYPE 1m candles for Oct 29 are no longer served (`candleSnapshot` 1m → 0 candles). 5m is available (73 candles for 18:00–24:00 UTC), as is hourly funding. Scenario A uses 5m, as the spec fallback allows.
- **2026-11-06: Backend first.** Sayan builds the backend (contracts + backend/) via a loop driven by docs/PLAN.md; the teammate does the frontend. Everything is proven on a local anvil chain with mock precompiles before Sayan runs the testnet deploy.
- **2026-11-06: Live Arena asset = testnet ETH** (perp **index 4**, `szDecimals` **4**; `perpAssetInfo` coin `"ETH"`). Decided by Sayan, because testnet HYPE's oracle is ~91× its mark. Mock tokens are `aETH` (18 dec) / `aUSD` (6 dec); the deploy check is `coin == "ETH"`. The **replay stays HYPE on mainnet** (index 159). Testnet ETH premium is currently +37–39 bp, so base-buying swaps on the Aven pool pay ~+1,850 pips. For the clearest demo, shock by **buying** aETH, so the bot's arb is a **sell**, which shows the pure gap fee (recon C.6).
- **2026-11-06: No testnet explorer.** Sayan confirmed purrsec is down, and nothing else covers chain 998. Tx links use our frontend route `/tx/<hash>` (receipt + decoded events via RPC) and `pnpm verify <tx>`.
- **2026-11-06: Layout.** Code lives in `backend/` (core, arena, scripts, data), `contracts/` and `frontend/`, so teammates can work in parallel without confusion. Spec paths map via the table in AGENTS.md §2. Each tool has its own `.env.example`. `docs/spec/TOOLS.md` was removed (duplicate of prompts B7).
- **2026-11-06: Git.** Commits are authored by `Sayan Roy <169074736+mesayanroy@users.noreply.github.com>` (repo-local config). There are no AI co-author tags; history was rewritten once, before the first push. Only `main`. Never push without Sayan's explicit go-ahead.
- **2026-11-06: VS Code.** `.vscode/settings.json` hides the 65 dependency submodule repos from Source Control (`git.detectSubmodules: false`).
- **2026-11-05: Dependencies.**
  - v4-core `d153b048`: source-identical to `main` `bea7f6d`; the `v4.0.0` tag can't compile OZ BaseHook.
  - v4-periphery `main` `c6e4754`: HookMiner is at `test/shared/`.
  - OZ uniswap-hooks `v1.3.0-rc.0`: the only v1.3.x tag; re-pin if 1.3.0 ships.
  - forge-std `v1.17.0`; hyper-evm-lib `v1.1` (tests only).
- **2026-11-05: PoolManager** is deployed by us on 998 (none exists). It's built separately with `[profile.v4core]` (via-IR, 44,444,444 runs, `bytecode_hash=none`), which is byte-identical to Uniswap's HyperEVM mainnet PoolManager. Tests use the fast default profile.
- **2026-11-05: Hook deployer:** CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` (live on 998) + HookMiner, flags `0x2080`.
- **2026-11-05: HYPE perp index:** testnet **135**, mainnet **159**, `szDecimals` 2 on both.
- **2026-11-05: Gas cap** `precompileGas = 30,000`. The measured precompile charge is ≤ 3,112, versus 6,160 for the doc formula, which is an upper bound only.
- **2026-11-05: Polling.** HyperEVM RPC has no websockets; `eth_call` works on latest only; `eth_getLogs` should use ≤ 50-block chunks.
- **2026-11-05:** `docs/spec/ARCHITECTURE.md` (team's `AVEN_ARCHITECTURE.md`) is normative.

## Open questions (need a decision)

1. **Big blocks on testnet: UNVERIFIED** until we send `evmUserModify`. The deployer must be a HyperCore user. The faucet only serves addresses that have deposited on mainnet; otherwise someone must `usdSend` testnet USDC to the deployer.
2. Repo must be made **public** before submission (Sat Nov 7, 09:00 IST).

## Gotchas learned

- `perpAssetInfo` (0x80a) returns **one struct** (`abi.encode(PerpAssetInfo)`), not five flat values.
- Offline, precompile addresses have no code: `staticcall` succeeds with **0 bytes**. Always check the return length.
- An invalid precompile index burns the **entire** forwarded gas.
- Foundry is at `~/.foundry/bin` and may not be on PATH. `forge install` only works from inside `contracts/` on this Windows setup ("prefix not found" from the repo root).
- `forge test` with `compilation_restrictions` on PoolManager makes every importer via-IR (slow builds, a different test bytecode). That's why the separate `v4core` profile exists.
