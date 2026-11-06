# Aven

**Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself.**

Aven is a Uniswap v4 fee library and hook on HyperEVM. It prices every swap from Hyperliquid's live perp market: the HyperCore oracle and mark price, read in-block through precompiles. That way LPs stop losing value to arbitrageurs. There is no oracle operator, keeper, owner or custody.

Built at ETHGlobal Mumbai 2026 (Uniswap track). Work in progress.

**Live on HyperEVM mainnet (chain 999):**
- `AvenHook` [`0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080`](https://hyperevmscan.io/address/0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080), on Uniswap's own v4 PoolManager.
- First swaps read HyperCore's oracle and mark in-block, and every fee is recomputable: `CHAIN_ID=999 HYPEREVM_RPC=https://rpc.hyperliquid.xyz/evm pnpm verify <tx>`.
- Addresses and transactions: [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) §M.5.

| Folder | What |
|---|---|
| `contracts/` | Foundry: `AvenFairValue` library, `AvenHook`, tests, deploy scripts |
| `backend/` | TypeScript: fee-math port + verifier (`core`), Arena bot service (`arena`), data scripts, data |
| `frontend/` | Next.js app: Home, Arena, Replay |
| `docs/` | Spec, recon, [code flow](docs/FLOW.md), [project memory](docs/MEMORY.md), AI attribution, pre-kickoff planning |

Working on the repo? Start with [AGENTS.md](AGENTS.md).

Planning files in `docs/planning/` were written **before kickoff** (ideas and specs only, no code). AI use is disclosed in [docs/ai/](docs/ai/).

License: MIT.
