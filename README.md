# Aven

**Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself.**

Aven is a Uniswap v4 fee library and hook on HyperEVM. It prices every swap from Hyperliquid's live perp market: the HyperCore oracle and mark price, read in-block through precompiles. That way LPs stop losing value to arbitrageurs. There is no oracle operator, keeper, owner or custody.

Built at ETHGlobal Mumbai 2026 (Uniswap track). Work in progress.

## Run it live

```bash
pnpm install
pnpm live          # local chain + live Hyperliquid mainnet ETH prices + Arena bot; Ctrl+C to stop
pnpm live:check    # every fee = formula, was charged, and used Hyperliquid's own prices
```

**Honest scope:** we couldn't get HyperEVM testnet HYPE for gas, so the live demo runs the **unchanged** contracts on a local EVM chain. HyperCore's oracle and mark prices reach the precompile addresses (`0x807`/`0x806`) through a relay from Hyperliquid's mainnet API, at most ~1–2 s behind; on HyperEVM the hook reads them in the same block. Details and proofs: [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) §A. The replay on real Oct 29 mainnet data doesn't depend on any chain.

| Folder | What |
|---|---|
| `contracts/` | Foundry: `AvenFairValue` library, `AvenHook`, tests, deploy scripts |
| `backend/` | TypeScript: fee-math port + verifier (`core`), Arena bot service (`arena`), data scripts, data |
| `frontend/` | Next.js app: Home, Arena, Replay |
| `docs/` | Spec, recon, [code flow](docs/FLOW.md), [project memory](docs/MEMORY.md), AI attribution, pre-kickoff planning |

Working on the repo? Start with [AGENTS.md](AGENTS.md).

Planning files in `docs/planning/` were written **before kickoff** (ideas and specs only, no code). AI use is disclosed in [docs/ai/](docs/ai/).

License: MIT.
