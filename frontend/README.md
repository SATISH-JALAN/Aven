# frontend/

The Next.js (App Router) web app: Home, Arena, Replay (P10). Spec name: `apps/web`. Features: [../docs/spec/FRONTEND.md](../docs/spec/FRONTEND.md); backend API it calls: [../docs/spec/API.md](../docs/spec/API.md); code flow: [../docs/FLOW.md](../docs/FLOW.md).

Env: copy `.env.example` to `.env.local`.

## Live mode (the demo backend, 2026-11-06)

There's no testnet deploy: nobody could get testnet HYPE. The backend runs in **live mode**: the unchanged contracts on a local chain (31337) with live Hyperliquid mainnet prices (docs/DEPLOYMENTS.md §A). Start it with `pnpm live`.

- `NEXT_PUBLIC_ARENA_API=http://localhost:8787` (or its tunnel URL).
- `NEXT_PUBLIC_RPC=http://localhost:8546`: the **read-only** RPC proxy. Reads only, so the `/tx/<hash>` page works; sends are refused. Never point it at 8545.
- `NEXT_PUBLIC_CHAIN_ID=31337`.
- **Badge:** "Live prices · local chain" on live views. Never "Live testnet" (AGENTS.md §6).
- `/config` is unchanged (API.md). `chainId` is 31337, and `explorer` is empty: use our `/tx/<hash>` route.
- `public/arena-fallback.json` is a live-mode recording. Its `source` field states that; show it with the "Recorded run" badge.
