<!-- INTERIM STAND-IN for Appendix B7 -->
> **Interim stand-in.** Appendix B7 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§10 Tech stack). Replace this whole file with Appendix B7 verbatim once the prompts file is added.

## 10. Tech stack

| Layer | Tool |
|---|---|
| Contracts | Solidity 0.8.26, Foundry (forge, anvil, cast) |
| Uniswap | v4-core, v4-periphery (`BaseHook`), HookMiner |
| HyperEVM helpers | `hyper-evm-lib` (MIT) |
| Network | HyperEVM testnet, chain 998 |
| Bot + verifier | TypeScript, viem |
| Frontend | Next.js (App Router), TypeScript, Tailwind |
| Wallet | wagmi, viem, RainbowKit (custom chain 998) |
| Charts | TradingView lightweight-charts (Arena), Recharts (Replay) |
| Data | Hyperliquid info API |
| Hosting | Vercel |
| Workflow | GitHub, Claude Code, Uniswap AI skills |

Cut on purpose: indexer, SDK package, factory, Pools/Liquidity/Build pages.
