<!-- INTERIM STAND-IN for Appendix B3 -->
> **Interim stand-in.** Appendix B3 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§7 Smart contracts). Replace this whole file with Appendix B3 verbatim once the prompts file is added.

## 7. Smart contracts

| Contract | Role | Key functions |
|---|---|---|
| `HyperFairValue` (library) | The product: gas-capped reads, scaling, signals, clamped fee | `read(perpIndex)`, `signals(...)`, `fee(...)` |
| `PerpAwareHook` | Reference hook; holds nothing | `beforeInitialize` (requires dynamic fee), `beforeSwap`, emits `FeeComputed` |
| `FeeQuoter` | Read-only quotes | `previewFee(poolKey, zeroForOne)` |
| `MockHyperCore` (tests) | Recorded prices at precompile addresses via `vm.etch` | `setPrices(oracle, mark)` |

Two pools in the same PoolManager (hooked + plain control, identical tokens, liquidity and range), deployed by script. No factory.

**Hook permissions:** `beforeInitialize`, `beforeSwap` only. Pool created with `LPFeeLibrary.DYNAMIC_FEE_FLAG`. Hook address must encode the flags → mine a CREATE2 salt (HookMiner).

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

**HyperEVM deployment notes**
- Testnet chain 998, RPC `https://rpc.hyperliquid-testnet.xyz/evm`.
- Small blocks: every 1s, 3M gas. Big blocks: every 1 min, 30M gas. Deploy large contracts via big blocks: send `{"type":"evmUserModify","usingBigBlocks":true}`; the deployer must first be a HyperCore user (receive USDC on Core).
- Check whether a v4 PoolManager exists on testnet; if not, deploy v4-core yourself. (Universal Router is deployed on HyperEVM mainnet.)
- Forks can't execute precompiles → all tests use `MockHyperCore`.
