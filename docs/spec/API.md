<!-- INTERIM STAND-IN for Appendix B4 -->
> **Interim stand-in.** Appendix B4 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§8 Off-chain components (Arena bot, Verify script)). Replace this whole file with Appendix B4 verbatim once the prompts file is added.

## 8. Off-chain components

**Arena bot (the live "wow" moment)**
- Open-source TypeScript (viem) script in the repo; a demo/benchmark tool, not a product.
- Trades **only our two spot pools** on HyperEVM testnet. Never trades perps; Hyperliquid is only where it reads fair price.
- Each block: read oracle via `eth_call` to the precompile → read both pool prices → compute the swap that returns each pool to fair → quote fee (fixed vs `previewFee`) → trade if profit after fee and gas > 0 → log pool, size, fee, bot profit, LP fee income.
- **Shock script:** one identical large swap in both pools to push them off fair (stands in for a market move). Say on stage: the shock is scripted, the bot is real.

**Verify script**
- `verify <tx>`: decode `FeeComputed`, recompute with the TS port, print match/mismatch.
- `verify --all`: every swap in the demo pool.
- Proves the fee is exactly the formula on logged inputs; input-vs-history is checked approximately against candles.

> The handoff defines no HTTP API for `services/arena` (endpoints, auth via `ARENA_ADMIN_TOKEN`, response shapes). Do not invent one; wait for Appendix B4.
