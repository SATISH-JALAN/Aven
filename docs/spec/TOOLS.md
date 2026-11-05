## B7 — Tools

| Area | Tool |
|---|---|
| Contracts | Solidity 0.8.26, `evm_version` cancun, Foundry (forge, cast, anvil, fmt, snapshot, fuzz, invariant) |
| Uniswap | `Uniswap/v4-core` (PoolManager, libraries, test routers, Deployers), `Uniswap/v4-periphery` (HookMiner in `test/shared`, LiquidityAmounts), `OpenZeppelin/uniswap-hooks` v1.3.x (BaseHook), local copy of `IDynamicFeeHook` from `Uniswap/v4-hooks-public` |
| HyperEVM | read precompiles 0x806/0x807/0x80a; testnet RPC; big-block toggle; `hyperliquid-dev/hyper-evm-lib` (tests only, optional fork-read pattern) |
| TS | Node 20, pnpm workspaces, TypeScript strict, viem, zod, vitest, tsx |
| Service | Hono, SSE, cloudflared tunnel |
| Web | Next.js (App Router), Tailwind, wagmi, TanStack Query, lightweight-charts, Recharts, qrcode |
| Data | Hyperliquid info API (meta, candleSnapshot, fundingHistory, allMids) |
| Analysis | slither (optional), forge gas report |
| Hosting | Vercel (web); laptop + cloudflared or a small VM (arena) |
