<!-- INTERIM STAND-IN for Appendix B2 -->
> **Interim stand-in.** Appendix B2 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§4 The price source and §7 Signals / Fee formula / Invariants). Replace this whole file with Appendix B2 verbatim once the prompts file is added.

## 4. The price source

| Price | Source | Precompile | Role |
|---|---|---|---|
| Pool price | Our v4 pool (`getSlot0`) | — | What LPs are quoting |
| Oracle price | Hyperliquid validators | `0x...0807` | Fair spot value |
| Mark price | Hyperliquid perp market | `0x...0806` | Where perp traders push the price |

- **Oracle:** validators publish every 3 seconds. Each takes a weighted median of spot mid prices from Binance (3), OKX (2), Bybit (2), Kraken, KuCoin, Gate, MEXC, Hyperliquid (1 each). The final price is a stake-weighted median across validators.
- **Mark:** from Hyperliquid's own perp trading; keeps moving even if one exchange goes dark.
- **Scaling:** precompiles return integers. For perps, human price = raw / 10^(6 − szDecimals). Wrong scaling silently misprices; test it first.
- **Gas:** precompile cost is 2000 + 65 × output length. Invalid input burns **all** gas forwarded to the call, so always cap gas.
- **"Slow oracle" in the demo:** not a second integration. It is the same hook in the replay, fed the same prices delayed ~60 seconds, mimicking a push oracle.

---

**Signals**
1. **Fair-value gap:** |pool − oracle| / oracle. With base = token0: pool above oracle and `zeroForOne` (selling base) → moves toward fair → arbitrage. Pool below oracle and buying base → arbitrage.
2. **Perp premium:** (mark − oracle) / oracle. Positive premium + buying base, or negative premium + selling base → "with pressure."
3. **Mark velocity:** |mark − previous mark| / previous mark since the last swap; counts above threshold θ.

**Fee formula**

fee = clamp( f0 + w_g · gap · 1[arb] + w_p · |premium| · 1[with pressure] + w_s · max(0, move − θ), f_min, f_max )

Any failed or implausible read → fallback fee.

| Parameter | Default | Meaning |
|---|---|---|
| f0 base fee | 0.05% (500 pips) | Calm-market fee |
| f_min / f_max | 0.05% / 1.00% | Floor and ceiling |
| Fallback | 0.30% (3,000 pips) | When a read fails |
| w_g | 50 pips per bps of gap | Arbs pay about half the gap |
| w_p | 50 pips per bps of premium | Same-side flow pays the premium |
| θ | 50 bps | Mark move counted as stress |
| w_s | 20 pips per bps above θ | Stress widening |
| Sanity limit | 2,000 bps gap | Larger gap = bad read → fallback |

**Event:** `FeeComputed(poolId, fee, oracleRaw, markRaw, prevMarkRaw, sqrtPriceX96, zeroForOne, fallbackUsed)` — every input needed to recompute.

**Invariants**
1. A price read never reverts a swap.
2. Fee is within floor/ceiling or exactly the fallback.
3. Hook holds no tokens, no delta-returning permissions.
4. No owner, no setters; everything immutable.
5. Every precompile call is gas-capped.
6. Hook, quoter and verifier share the same math.
7. Prices normalised with `szDecimals`; immutable `baseIsToken0` handles token order.
8. Differential test: 10,000 random inputs, Solidity library vs TypeScript port, must match exactly.
