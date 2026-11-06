# AI attribution

Which files in this repo were written by AI (Claude Code, model Claude Opus 5.5) or with its help. Prompts are logged verbatim in [PROMPTS.md](PROMPTS.md).

| file | written by | notes |
|---|---|---|
| `AGENTS.md` | AI | Rules for agents and teammates; invariants I1–I10 verbatim from ARCHITECTURE §6.6 |
| `CLAUDE.md` | AI | Pointer to AGENTS.md and docs/MEMORY.md |
| `README.md` | AI | Full README (O1–O8): sections, tables, Mermaid diagrams, mainnet facts after the merge; Team, Roadmap and logo edits on request |
| `docs/diagrams/render.py`, `docs/diagrams/*.svg` | AI | Stdlib-Python SVG generator for the README diagrams and the logo (light + dark); logo shapes taken from `frontend/src/app/icon.svg` and `brand.tsx` |
| `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.vscode/settings.json` | AI | Boilerplate / config |
| `contracts/.env.example`, `backend/.env.example`, `frontend/.env.example` | AI | Placeholders only |
| `backend/README.md`, `frontend/README.md` | AI | Folder guides |
| `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/foundry.lock`, `.gitmodules` | AI | Toolchain config and dependency pins (P1) |
| `contracts/src/AvenFairValue.sol` | AI | P2 library per ARCHITECTURE §6.2–§6.4 |
| `contracts/test/unit/AvenFairValue.t.sol` | AI | P2 unit + fuzz tests |
| `contracts/src/AvenHook.sol`, `contracts/src/interfaces/IAvenHook.sol` | AI | P3 hook per ARCHITECTURE §6.4–§6.5, §8.1 |
| `contracts/test/integration/AvenHook.t.sol`, `contracts/test/utils/AvenTestBase.sol`, `contracts/test/utils/PriceMath.sol` | AI | P3 integration tests (both token orders) and helpers |
| `contracts/script/*.s.sol`, `contracts/script/base/AvenScript.sol` | AI | P5 deploy scripts (DeployCore, DeployTokens, DeployAven, CreatePools, Smoke) |
| `contracts/test/unit/PriceMath.t.sol` | AI | P5 initial-price 1 bp test |
| `backend/arena/**` (`src/*`, `test/*`, `scripts/e2e.ts`, `package.json`, `tsconfig.json`), `backend/README.md` (run section), `backend/.env.example` (optional knobs) | AI | P6 Arena service |
| `backend/scripts/fetch-market-data.ts`, `backend/scripts/src/marketData.ts`, `backend/scripts/scenarios.json`, `backend/scripts/test/marketData.test.ts`, `backend/data/raw/README.md` | AI | P7 market data pipeline (the data itself comes from the Hyperliquid API) |
| `contracts/test/replay/Replay.t.sol`, `backend/scripts/replay.ts`, `backend/scripts/replay-to-web.ts`, `backend/scripts/src/replayPrep.ts`, `backend/scripts/test/replayPrep.test.ts`, `backend/data/replay/README.md` | AI | P8 replay engine, runner, web export and method notes (results are generated) |
| `backend/scripts/**` (`local-chain.ts`, `src/localChain.ts`, `package.json`, `tsconfig.json`), `contracts/deployments/README.md` | AI | P5 local chain harness |
| `contracts/test/vectors/GenVectors.t.sol` | AI | P4 differential vector generator |
| `backend/core/**` (`src/*` incl. generated `src/abi.ts`, `test/*`, `scripts/*`, `package.json`, `tsconfig.json`), `backend/tsconfig.base.json` | AI | P4 TS port, differential test, scripts |
| `contracts/test/mocks/MockHyperCorePx.sol` | AI | Etchable precompile mock with failure injection |
| `contracts/test/recon/Recon.t.sol` | AI | P1 recon checks; optional FORK_READ live read |
| `contracts/src/interfaces/IDynamicFeeHook.sol` | Uniswap (MIT), copied by AI | Verbatim from Uniswap/v4-hooks-public@c45509f; AI added only the source/licence header |
| `docs/DEPLOYMENTS.md` | AI | Testnet runbook (P5) |
| `backend/core/bin/verify.ts`, `backend/scripts/proofs.ts`, `docs/PROOFS.md` (generated) | AI | P9 verify CLI and proofs report |
| `contracts/test/invariant/AvenInvariant.t.sol`, `contracts/.gas-snapshot` (generated), `docs/SECURITY.md` | AI | P11 invariant suite, gas baseline, security notes |
| `backend/arena/scripts/check-frontend.ts` | AI | Frontend integration check on a local chain (prompt F25) |
| `backend/scripts/demo.ts`, `backend/scripts/src/demo.ts`, `backend/arena/scripts/demo-local.ts`, `docs/DEMO.md`, `frontend/public/arena-fallback.json` (generated) | AI | P13 demo run, fallback recording, demo script |
| Pre-mainnet audit (2026-11-06): `_precompileCall`/`_readOracleMark` in `contracts/script/base/AvenScript.sol`, `POOL_MANAGER` reuse in `DeployCore.s.sol`, hardening in `backend/arena/src/{server,config,arena,main}.ts` + tests, SECURITY.md §6, recon §E, DEPLOYMENTS.md §M | AI | Audit, fork rehearsal, fixes; all reviewed through tests and mutation checks |
| Gas cap (2026-11-06 re-check): `GasPriceTooHigh`/`checkGasCap`/`gweiToWei` + `maxFeePerGas` in `backend/arena/src/chain.ts`, the bot/shock checks in `arena.ts`, `MAX_GAS_PRICE_GWEI` in `config.ts` + tests; recon §E.6; DEPLOYMENTS.md §M.2–M.4 rewritten | AI | Mutation-checked |
| `ownTxBlock` in `backend/arena/src/arena.ts` + its test in `backend/arena/test/state.test.ts` | AI | 2026-11-06: no stale `/state` right after our own tx (kept through the live-mode revert) |
| `contracts/test/load/OnchainLoad.t.sol`, `backend/arena/scripts/loadtest.ts`, `backend/arena/scripts/loadtest-report.ts`, `backend/arena/test/{chain,state}.test.ts`, `backend/arena/scripts/repro-reverts.ts`, `docs/LOADTEST.md` (generated), `backend/data/load/*.json` (generated) | AI | Phase 7 load testing, regression tests, report |
| `frontend/src/**`, `frontend/test/**`, `frontend/scripts/sync-deployments.mjs`, `frontend/{package.json,next.config.ts,tsconfig.json,postcss.config.mjs,vitest.config.ts,next-env.d.ts,.env.example,README.md}`, `frontend/src/app/icon.svg` | AI | P10 frontend (Next.js + GSAP + three.js), built from the team's content checklist, then redesigned and polished from the user's reference sites (prompts F17–F19; landing in `frontend/src/components/landing/`), then restructured into Trade / Swap / Pool / Docs (prompts F22–F25; `src/components/{trade,docs}/`, `src/lib/{hl,trade-math,swap,liquidity}.ts`). The Trade chart uses TradingView `lightweight-charts` (npm, Apache-2.0). The SVG emblem and wordmark in `src/components/brand.tsx` are AI vector redraws of the team's logo PNGs |
| `frontend/public/Minimalist AVEN Logo on White.png`, `frontend/public/Minimalist Black Hourglass Emblem.png`, `frontend/public/Opposing Lobes Geometric Emblem.png` | Added by the team | Logo art (how it was made is not recorded here) |
| `backend/core/package.json` (subpath exports), `pnpm-workspace.yaml` (`allowBuilds` denials) | AI | Additive changes for the frontend bundle and the pnpm 12 install |
| `contracts/deployments/999.json` | Generated by `CreatePools.s.sol` | Mainnet deployment record (2026-11-06), run by AI on Sayan's instruction with his account |
| `frontend/public/arena-fallback.json` | Generated by `pnpm demo` | HyperEVM mainnet recording (2026-11-07), run by AI on Sayan's request |
| `docs/PLAN.md` | AI | Backend build plan, ticked off per step |
| `docs/FLOW.md`, `docs/MEMORY.md` | AI | Code flow and project memory, kept in sync with changes |
| `docs/recon.md` | AI | P1. Facts from installed deps, official docs and live RPC/API output; sources inline |
| `docs/ai/PROMPTS.md`, `docs/ai/ATTRIBUTION.md` | AI | Logs |
| `docs/spec/ARCHITECTURE.md` | Provided by the team | `AVEN_ARCHITECTURE.md`, moved by AI, not edited |
| `docs/spec/API.md`, `DATA.md`, `FRONTEND.md` | Provided by the team (copied by AI) | Appendices B4–B6 copied verbatim from the prompts file |
| `docs/planning/aven-claude-code-prompts.md` | Provided by the team | Moved by AI, not edited |
| `docs/planning/perp-aware-pools-handoff.md` | Human + AI (planning chat, before kickoff) | Pre-kickoff planning; AI added only the first line |
| `backend/scripts/health.ts`, `backend/scripts/src/health.ts`, `backend/scripts/test/health.test.ts`, `health` scripts in `package.json` and `backend/scripts/package.json` | AI | O9 read-only mainnet health check, incl. Uniswap V4Quoter + Universal Router simulation |
| `frontend/src/lib/pressure.ts`, `frontend/test/pressure.test.ts`; push status in `frontend/src/app/pool/page.tsx` and `frontend/src/components/trade/MarketBar.tsx`; mainnet default in `frontend/src/config.ts` and `frontend/.env.example`; `frontend/src/config/deployments.json` (synced) | AI | O9 pool push status and mainnet default; O10 "Connect wallet" wording and wallet-only Privy (`components/wallet.tsx`, `app/swap/page.tsx`, `app/pool/page.tsx`, `trade/OrderPanel.tsx`, `lib/swap.ts`, `docs/pages.tsx`) |
