# AI attribution

Which files in this repo were written by AI (Claude Code, model Claude Opus 5.5) or with its help. Prompts are logged verbatim in [PROMPTS.md](PROMPTS.md).

| file | written by | notes |
|---|---|---|
| `CLAUDE.md` | AI | P0 (rewritten to the current P0; I1–I10 verbatim from ARCHITECTURE §6.6) |
| `README.md` | AI | P0 stub |
| `.gitignore`, `.env.example`, `LICENSE`, `package.json`, `pnpm-workspace.yaml` | AI | P0 boilerplate |
| `contracts/foundry.toml` | AI | P0/P1 config: default profile, v4core PoolManager profile, rpc endpoints, fs_permissions |
| `docs/spec/ARCHITECTURE.md` | Provided by the team | `AVEN_ARCHITECTURE.md`, moved by AI, not edited |
| `docs/spec/API.md`, `DATA.md`, `FRONTEND.md`, `TOOLS.md` | Provided by the team (copied by AI) | Appendices B4–B7 copied verbatim from the prompts file |
| `docs/planning/aven-claude-code-prompts.md` | Provided by the team | Moved by AI, not edited |
| `docs/planning/perp-aware-pools-handoff.md` | Human + AI (planning chat, before kickoff) | Pre-kickoff planning; AI added only the first line |
| `docs/ai/PROMPTS.md`, `docs/ai/ATTRIBUTION.md` | AI | Log files |
| `docs/recon.md` (template) | AI | P0 |
| `docs/recon.md` (filled) | AI | P1. Facts from installed deps, official docs and live RPC/API output; sources inline |
| `contracts/test/recon/Recon.t.sol` | AI | P1: offline mock-plan + constant/path checks, optional FORK_READ live read |
| `contracts/src/interfaces/IDynamicFeeHook.sol` | Uniswap (MIT), copied by AI | Verbatim from Uniswap/v4-hooks-public@c45509f; AI added only the source/licence header |
| `contracts/remappings.txt`, `contracts/foundry.lock`, `.gitmodules` | AI | P1 dependency pins |
