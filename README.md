# Aven

**Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself.**

Aven is a Uniswap v4 hook on HyperEVM that prices every swap from Hyperliquid's live perp market (HyperCore oracle + mark price, read in-block via precompiles), so LPs stop losing value to arbitrageurs. No oracle operator, keeper, owner or custody.

Built at ETHGlobal Mumbai 2026 (Uniswap track). Work in progress.

| Path | What |
|---|---|
| `contracts/` | Foundry: `HyperFairValue` library, `PerpAwareHook`, `FeeQuoter` |
| `packages/core/` | TypeScript port of the fee math |
| `services/arena/` | Arena bot, shock and verify scripts |
| `apps/web/` | Arena + Replay web app |
| `data/` | Raw market data and replay outputs |
| `docs/spec/` | Specs |
| `docs/planning/` | Planning files written **before kickoff** (ideas and specs only, no code) |
| `docs/ai/` | AI prompt log and attribution |

License: MIT.
