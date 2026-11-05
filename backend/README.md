# backend/

Off-chain TypeScript: everything except the contracts and the web UI. Code flow is in [../docs/FLOW.md](../docs/FLOW.md).

| Folder (created when its prompt runs) | What | Spec name |
|---|---|---|
| `core/` | `@aven/core`: BigInt fee-math port, ABIs, precompile reads, addresses, verifier (P4, P9) | `packages/core` |
| `arena/` | Arena service: block poller, bot, shock, stats, HTTP + SSE (P6) | `services/arena` |
| `scripts/` | `fetch-market-data.ts`, `replay-to-web.ts`, `demo.ts`, `scenarios.json` (P7, P8, P13) | `scripts/` |
| `data/` | `raw/`, `replay/`, `vectors/`, `arena/` (P4, P6, P7, P8) | `data/` |

Env: copy `.env.example` to `.env`.

## Run the Arena service

```bash
cp backend/.env.example backend/.env          # fill BOT_PK, SHOCK_PK, ARENA_ADMIN_TOKEN (>= 8 chars), ARENA_CORS_ORIGINS
pnpm --filter @aven/arena start               # reads contracts/deployments/$CHAIN_ID.json, serves :8787
cloudflared tunnel --url http://localhost:8787   # public URL for NEXT_PUBLIC_ARENA_API (Vercel can't host the loop)
```

Local, no keys needed: `pnpm --filter @aven/scripts local:up` (anvil + mock precompiles + full deploy), then start the
Arena with `CHAIN_ID=31337 HYPEREVM_RPC=http://127.0.0.1:8545` and anvil accounts #1/#2 as BOT_PK/SHOCK_PK.
Tests: `pnpm --filter @aven/arena test` (unit + API), `pnpm --filter @aven/arena test:e2e` (full local-chain gate, ~3 min).
