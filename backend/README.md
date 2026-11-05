# backend/

Off-chain TypeScript: everything except the contracts and the web UI. Code flow is in [../docs/FLOW.md](../docs/FLOW.md).

| Folder (created when its prompt runs) | What | Spec name |
|---|---|---|
| `core/` | `@aven/core`: BigInt fee-math port, ABIs, precompile reads, addresses, verifier (P4, P9) | `packages/core` |
| `arena/` | Arena service: block poller, bot, shock, stats, HTTP + SSE (P6) | `services/arena` |
| `scripts/` | `fetch-market-data.ts`, `replay-to-web.ts`, `demo.ts`, `scenarios.json` (P7, P8, P13) | `scripts/` |
| `data/` | `raw/`, `replay/`, `vectors/`, `arena/` (P4, P6, P7, P8) | `data/` |

Env: copy `.env.example` to `.env`.
