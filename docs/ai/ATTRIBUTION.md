# AI attribution

Which files in this repo were written by AI (Claude Code, model Claude Opus 5.5) or with its help. Prompts are logged verbatim in [PROMPTS.md](PROMPTS.md).

| file | written by | notes |
|---|---|---|
| `AGENTS.md` | AI | Rules for agents and teammates; invariants I1–I10 verbatim from ARCHITECTURE §6.6 |
| `CLAUDE.md` | AI | Pointer to AGENTS.md and docs/MEMORY.md |
| `README.md` | AI | Stub |
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
| `contracts/test/vectors/GenVectors.t.sol` | AI | P4 differential vector generator |
| `backend/core/**` (`src/*` incl. generated `src/abi.ts`, `test/*`, `scripts/*`, `package.json`, `tsconfig.json`), `backend/tsconfig.base.json` | AI | P4 TS port, differential test, scripts |
| `contracts/test/mocks/MockHyperCorePx.sol` | AI | Etchable precompile mock with failure injection |
| `contracts/test/recon/Recon.t.sol` | AI | P1 recon checks; optional FORK_READ live read |
| `contracts/src/interfaces/IDynamicFeeHook.sol` | Uniswap (MIT), copied by AI | Verbatim from Uniswap/v4-hooks-public@c45509f; AI added only the source/licence header |
| `docs/PLAN.md` | AI | Backend build plan, ticked off per step |
| `docs/FLOW.md`, `docs/MEMORY.md` | AI | Code flow and project memory, kept in sync with changes |
| `docs/recon.md` | AI | P1. Facts from installed deps, official docs and live RPC/API output; sources inline |
| `docs/ai/PROMPTS.md`, `docs/ai/ATTRIBUTION.md` | AI | Logs |
| `docs/spec/ARCHITECTURE.md` | Provided by the team | `AVEN_ARCHITECTURE.md`, moved by AI, not edited |
| `docs/spec/API.md`, `DATA.md`, `FRONTEND.md` | Provided by the team (copied by AI) | Appendices B4–B6 copied verbatim from the prompts file |
| `docs/planning/aven-claude-code-prompts.md` | Provided by the team | Moved by AI, not edited |
| `docs/planning/perp-aware-pools-handoff.md` | Human + AI (planning chat, before kickoff) | Pre-kickoff planning; AI added only the first line |
