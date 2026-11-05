> Written before kickoff; ideas and specs only, no code.

# Perp-Aware Pools — Project Handoff (ETHGlobal Mumbai 2026)

> Condensed record of the full planning conversation: every decision, the reasons behind it, the final architecture and the build plan.
> Written **before kickoff**. It contains ideas and specs only, no project code. Under ETHGlobal's Classic track, all code, designs and assets must be built during the event. Put this file in the repo under `docs/planning/` and mention in the README that it was written before kickoff (AI attribution rules ask for spec and planning files to be in the repo).

---

## 0. TL;DR

- **Event:** ETHGlobal Mumbai, Nov 5–7 2026, Jio World Convention Centre. **Submissions close Saturday Nov 7, 09:00 IST.**
- **Track:** Uniswap Foundation "Build with Uniswap" ($10k: $4k / $3k / $2k / $1k) as the **only** partner prize, plus ETHGlobal **finalist** judging.
- **Product (one line):** A Uniswap v4 hook on HyperEVM that prices every swap from Hyperliquid's live perp market, so LPs stop losing money to arbitrageurs.
- **Pitch line:** *Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself.*
- **The core:** `HyperFairValue`, a Solidity library any v4 hook can import, plus a reference hook, an Arena demo (a live arbitrage bot against two pools), an Oct 29 replay, and a verify script.

---

## 1. How we got here (decision log)

| Option considered | Verdict | Why |
|---|---|---|
| "Warden": on-chain firewall vault for AI trading agents on Hyperliquid | Dropped | Wallet security is a separate product; the "delegation layer breach" framing was inaccurate (Binance = compromised engineer laptop → hot-wallet signing; Polymarket = compromised frontend dependency) |
| EF "speed limit" wallet (EIP-8141 alt mempool) | Fallback only | Niche, small prize, Safe spending limits invite comparison |
| Hedera x402 AI gateway with no API keys | Dropped | Crowded agent-payments category |
| World IDKit operator-bound withdrawals | Dropped | Small prize |
| PayZoll-style stablecoin payroll on Arc or Whitechain | Dropped | Whitechain says payroll alone "won't place"; the real value (INR off-ramp, bank partner, TDS/ITR) can't be built in 36h; already submitted to many hackathons |
| Perp hedge vault (LP + short on HyperCore) | Dropped | Already exists (Harmonix, Liminal, Cathena, HyperVault); CoreWriter orders are delayed a few seconds, so a hook can't hedge atomically |
| 0G / Arkiv as a second or third track | Dropped | The user chose one track only; 0G wants consumer AI apps |
| **Perp-aware dynamic-fee hook (Uniswap)** | **Chosen** | Real, long-standing gap (LVR); Hyperliquid fits naturally; largest open prize pool; measurable proof |

**News context (Oct 29, 2026), for the pitch:**
- About $6.36B moved out of Binance wallets across 10 chains, mostly within ~20 minutes from 20:05 UTC. Attributed to North Korea's TraderTraitor; initial cause was a compromised engineer laptop. Binance suspended deposits, withdrawals and trading.
- The same day, Elon Musk replied "Interesting" to Stan Druckenmiller's post about TradeXYZ × ICE bringing Hyperliquid perps to US traders; HYPE rose about 16–20%. **Not related to the hack; don't link them in the pitch.**
- Hook for us: the main reference venue went dark while Hyperliquid kept trading.

---

## 2. The gap

- LPs lose value whenever the market moves elsewhere and arbitrageurs trade against the pool's stale price. Research calls this **LVR (loss-versus-rebalancing)**.
- Fixed fees can't tell arbitrage from normal flow.
- Dynamic-fee hooks need a fast, trustworthy outside price. On most chains that price arrives late (push oracles), costs a relayer (pull oracles), or comes from a model you must trust (AI-tuned fees).
- **Our finding:** on HyperEVM, a contract can read HyperCore's oracle and perp mark price through precompiles **in the same block**, with no oracle operator, keeper or relayer. That makes a zero-trust fix possible.

---

## 3. The product

**What it is:** spot Uniswap v4 pools (e.g. HYPE/USDC) with our hook attached. The perp market is used only as an **information source**. Nobody trades perps with us.

**Who uses it**

| User | What they do | What they get |
|---|---|---|
| LP (main user) | Deposit into a normal v4 position, same as Uniswap | Lose less to arbitrage; earn more when markets are volatile |
| Swapper / router | Nothing different; routers quote with `previewFee` | Near-floor fees (0.05%) in calm markets |
| Arbitrageur | Still trades | Still profits, but shares about half the gap with LPs |
| Hook builder | Imports `HyperFairValue` | Perp-aware pricing in a few lines |

**Why arbitrageurs still trade:** the fee is about half the gap and capped at 1%, always below the available profit. Example: a 1.5% gap → plain 0.30% pool: arb keeps 1.2%, LPs get 0.30%; our pool charges ~0.75%: arb keeps ~0.75%, LPs get ~0.75%. The opportunity exists only in our pool (it's our price that's stale), so it's 0.75% here or nothing. If the fee makes a trade unprofitable, nobody trades for a moment, which simply means LPs aren't losing money.

**Competitors:** other places LPs can put liquidity on HyperEVM: plain Uniswap pools, other DEX pools, other dynamic-fee designs. **Binance is not a competitor**; it is one of the price sources arbitrageurs use.

**What we are not:** not a vault, not a perp hedge, not a perp exchange, not a custodian, not an aggregator across perp DEXes. CoreWriter is never called.

**Honest limit:** only assets with a HyperCore perp market have a price to read. That covers the majors and a growing set of builder-deployed (HIP-3) markets.

---

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

## 5. Differentiation (README comparison table)

| Approach | Price or signal source | What you must trust | When it reacts |
|---|---|---|---|
| Fixed-fee pool | None | Nothing | Never |
| Push-oracle dynamic fee | Oracle network | Operators and update rule | After the update lands |
| OniBlock (Uniswap 3rd, ETHGlobal Tokyo 2026) | AI sets fee sensitivity each block; Brier score on-chain | The model and its settler | Each block, via model output |
| Tide (ENS 3rd, Tokyo 2026) | Curve shape; parameters in ENS | Chosen parameters | Structural, not price-aware |
| KyberSwap FairFlow | Hook on v4 and similar; redistributes arbitrage value to LPs | Kyber's design | Check their docs before comparing |
| **Perp-Aware Pools** | HyperCore oracle + mark, in-block | Nothing beyond the chain | Same block |

Other related winners: TARE (ETHOnline finalist + Uniswap; hook fee measurement), ALMA (Cannes finalist; LP range management).

**Moat:** adoptable library; re-derivable fees; open-source Arena bot as a benchmark; calibrated on a dated real event with all scenarios published; zero-key trust surface.

---

## 6. Architecture

```
            LPs                Swappers / routers            Arena bot (demo)
             │                         │                          │
─────────────┼─────────── HyperEVM (on-chain) ─────────────────────┼──────────
             ▼                         ▼                          ▼
      ┌────────────────────────────────────────────────────────────────┐
      │ Uniswap v4 PoolManager: hooked pool + plain control pool       │
      └───────────────┬────────────────────────────────────────────────┘
                      │ beforeSwap (hooked pool only)
      ┌───────────────▼──────┐   ┌──────────────┐   ┌──────────────────────┐
      │ PerpAwareHook        │──▶│ HyperFairValue│◀──│ FeeQuoter.previewFee │
      │ (reference hook)     │   │ (the product) │   └──────────────────────┘
      └───────────┬──────────┘   └──────┬────────┘
                  │ FeeComputed           │ staticcall (gas-capped)
                  │                       ▼
                  │          HyperCore: oracle 0x807, mark 0x806 (in-block)
──────────────────┼────────────── Off-chain (proof and demo) ─────────────────
                  ▼
   Web app (Arena + Replay) · Verify script · Replay engine · Market data CSV
```

**Trust path:** PoolManager → hook → `HyperFairValue` → HyperCore precompiles. Nothing off-chain can change a fee.

**Swap lifecycle**
1. A router or the bot calls `FeeQuoter.previewFee`.
2. The swap reaches the PoolManager. The control pool charges its fixed fee; the hooked pool calls `beforeSwap`.
3. The hook calls `HyperFairValue`: reads oracle and mark, computes three signals and the fee.
4. The hook stores the new mark snapshot and returns `fee | OVERRIDE_FEE_FLAG`.
5. The swap executes; the fee accrues to LPs as usual.
6. `FeeComputed` is emitted with raw inputs; the app shows it, the verifier recomputes it.

---

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

---

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

**Replay engine**
- Headline: **Oct 29, 2026** around the Binance halt (from 20:05 UTC). Plus a calm day and one more volatile day.
- Four pools from the same state: fixed 0.05%, fixed 0.30%, hook on 60s-delayed price, hook on live price.
- Each minute: set `MockHyperCore` prices; arb agent trades to fair when profitable; seeded retail agent does small random swaps (reproducible).
- Output: CSV of LP value vs holding per pool per step.
- Oracle approximation: mark adjusted by recorded premium/funding. State the method on the slide.

**Market data:** Hyperliquid info API `candleSnapshot` (1m) + funding history, paged (max ~5,000 candles per response). Save the Oct 29 window as raw CSV early; third-party historical providers are the fallback.

---

## 9. Frontend (two pages, phone-ready)

**Arena (demo page)**
- Two pool cards side by side (stacked on phone): Plain vs Perp-Aware. Each: pool price, fair value (oracle), gap.
- Live counters per pool: bot profit, LP fee income, trade count. Big number between them: "LPs kept $X more."
- Buttons: "Shock both pools", "Start bot" (demo wallet on testnet).
- Trade tape: each bot trade with pool, size, fee breakdown, tx link; tap → verify result.
- Small "try it yourself" swap panel with live fee preview for both directions.

**Replay**
- Scenario picker (Oct 29 Binance halt, calm day, second volatile day) → Run → four LP-value lines animate.
- Results table; shareable link + QR code so judges rerun on their phones.

**Visual direction:** dark terminal ground, sans text, monospaced numbers; teal = normal, amber = stress; every number labelled with its source; "live testnet" or "replay" badge on every view.

---

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

---

## 11. Two-day roadmap (gate before moving on)

**Phase 1 — Core library and hook** (Day 1, first half) · Gate: hook tests pass with mocks
- [ ] Repo at kickoff; `forge init`; add v4-core, v4-periphery, `hyper-evm-lib`
- [ ] `HyperFairValue`: gas-capped reads, scaling test vs a known price, three signals, clamp
- [ ] `PerpAwareHook` on the library; `FeeComputed` with raw inputs
- [ ] Mock tests: arb pays more, retail pays base, failed read and insane gap → fallback
- [ ] `FeeQuoter` on the same library

**Phase 2 — Testnet and Arena bot** (Day 1, second half) · Gate: bot visibly taxed on hooked pool
- [ ] PoolManager on chain 998? If none, deploy via big blocks
- [ ] Deploy hook with mined salt; create hooked + control pools with identical liquidity
- [ ] Swap both pools both directions; save tx links
- [ ] Arena bot + shock script

**Phase 3 — Replay and verify** (Day 2, morning) · Gate: fees re-derive, replay shows gap
- [ ] Load Oct 29 CSV + two other days
- [ ] Foundry replay: four pools, arb agent, seeded retail agent → results CSV; hand-check a few steps
- [ ] Verify script + 10,000-input differential test

**Phase 4 — Web app** (Day 2, afternoon) · Gate: live demo URL works end to end
- [ ] Next.js scaffold, wagmi chain 998
- [ ] Arena page (pools, bot logs, `FeeComputed`)
- [ ] Replay page with share link + QR
- [ ] Deploy to Vercel; test on a phone

**Phase 5 — Ship** (Day 2 night → Nov 7 09:00 IST) · Gate: submitted
- [ ] README as an engineering memo: what was hard, what's hacky, what was measured, what doesn't work yet; comparison table; integration snippet; addresses; file-and-line pointers to the library
- [ ] AI attribution note + specs/prompts/planning files in repo
- [ ] `FEEDBACK.md` + Uniswap Developer Feedback Form (https://developers.uniswap.org/hackathon-feedback)
- [ ] 2–4 min video; rehearse the 4-minute live demo twice
- [ ] Submit with finalist judging + Uniswap prize selected

Two people: one on contracts + replay, one on web app + bot. Solo: same order, use the cut list.

---

## 12. Do / Don't

**Do**
- Lead with the zero-trust difference; name OniBlock in the README comparison.
- Get both pools swapping on testnet before any frontend.
- Get the bot taxed on the hooked pool before polishing anything.
- Keep all fee math in `HyperFairValue`.
- Commit small and often; keep specs and prompts in the repo.
- Label every number with its source and a "live testnet" / "replay" badge.
- Add `FEEDBACK.md`; point the README to the library's exact lines.

**Don't**
- Add a perp hedge, vault, CoreWriter orders or custody.
- Let the bot trade perps.
- Build indexer, SDK package or factory before Arena works.
- Add other sponsor integrations.
- Hard-code demo values in live views.
- Let a price read revert a swap.
- Tune parameters to one replay; publish every scenario.
- Copy pre-event code or designs into the repo.

---

## 13. Demo script (live: 4 min + 3 min questions)

1. **0:00 Problem (25s):** Oct 29, Binance went dark. LPs lose to arbitrageurs; every dynamic-fee hook trusts someone for its price.
2. **0:25 Insight (25s):** on HyperEVM the perp market is chain state; `HyperFairValue` turns it into a fee. No operator, keeper or model.
3. **0:50 Arena live (90s):** shock both pools, start the bot. It profits on the plain pool, gets taxed on ours; "LPs kept more" climbs. Tap a trade → verify match.
4. **2:20 Replay (45s):** run Oct 29; four lines diverge. Delayed-price hook vs live hook shows the edge is read speed.
5. **3:05 Adoption (35s):** integration snippet; routers quote with `previewFee`.
6. **3:40 Close (20s):** pitch line, honest limit, QR code.

Keep a recorded Arena run as backup. **Video rules:** 2–4 minutes, ≥720p, your own voice, laptop screen recording (no phone recording), no speed-up, no AI voiceover, no music-and-captions instead of voice. Cuts are fine; keep the Arena sequence in real time.

---

## 14. Submission checklist

- [ ] Public repo, open-source licence, steady commit history
- [ ] README engineering memo (diagram, comparison, addresses, file-and-line pointers)
- [ ] AI attribution note + planning files (incl. this one, marked as written before kickoff)
- [ ] `FEEDBACK.md` + Uniswap feedback form with its link
- [ ] Live demo link, QR code, 2–4 min video
- [ ] Testnet tx links: both pools, a taxed bot trade
- [ ] Finalist judging + Uniswap prize, **before Sat Nov 7, 09:00 IST**

---

## 15. Risks and fallbacks

| Risk | Fallback |
|---|---|
| No v4 PoolManager on HyperEVM testnet | Deploy v4-core yourself via big blocks |
| Unexpected precompile scaling | Unit-test scaling first; keep fallback fee |
| Bot finds no profit after shock | Rehearse shock sizes; use a bigger shock |
| Testnet RPC slow during live demo | Play recorded Arena run; tx links in README |
| Oct 29 1m data unavailable | Saved CSV or a historical data provider |
| Running out of time | Cut: swap panel → Replay share card → third replay day. Never cut Arena or verify |

---

## 16. Ready answers for judges

**"How are you different?"**
"Every AMM leaks value to arbitrageurs who trade on fresher prices. Fixed fees can't tell arbitrage from normal flow, and oracle-based fees react too late. On HyperEVM a contract can read Hyperliquid's oracle and perp mark in the same block. Before every swap our hook asks: is this closing a stale-price gap, is it on the side of perp pressure, is the market moving violently? If yes, it pays more, and that goes to LPs. If no, it pays the base fee. Our replay runs the same real crash through four pools; the live in-block version keeps LPs the most, and beating the delayed-price version shows the edge is read speed. And nothing to trust: no owner, keeper, signer or custody."

**"Why would arbitrageurs still come?"** The fee is about half the gap and capped at 1%, so profit remains. The gap only exists in our pool; it's take ~half or nothing.

**"Isn't Binance faster?"** Binance is a price source, not a competitor. Our oracle already aggregates eight venues including Binance; the mark comes from Hyperliquid's own book.

**"Why only Hyperliquid?"** In-block, free, trustless reads exist only from HyperEVM. Other perp DEXes would need a relay, bringing back the delay we remove.

**"Why can't others copy it?"** The code is open; the calibrated parameters, replay harness, re-derivable fees, benchmark bot and router quoting are what get adopted, and we ship them first.

**"How is this different from OniBlock?"** OniBlock's fee comes from an AI model with on-chain accountability; ours is a pure function of chain state anyone can recompute. No model to trust.

---

## 17. Sources

- ETHGlobal Mumbai prizes: https://ethglobal.com/events/mumbai/prizes
- ETHGlobal rules: https://ethglobal.com/rules
- Hyperliquid oracle: https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle
- HyperCore precompiles & CoreWriter: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/evm/system-contract
- Dual-block architecture: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture.md
- Uniswap Universal Router 2.1.2 (HyperEVM deployment): https://github.com/Uniswap/universal-router/releases/tag/2.1.2
- Almanak SDK, Hyperliquid notes (precompile 0x0807 oracle, 0x0806 mark): https://sdk.docs.almanak.co/hyperliquid.html
- Chainstack CoreWriter & precompiles: https://docs.chainstack.com/docs/hyperliquid-corewriter
- KyberSwap FairFlow: https://docs.kyberswap.com/user-guide/kyberswap-fairflow.md
- TRM Labs on the Binance hack: https://www.trmlabs.com/resources/blog/north-korea-steals-usd-6-36-billion-from-binance-in-the-largest-hack-in-history
- Axios on Binance halt: https://www.axios.com/2026/10/29/binance-cyberattack-crypto-heist
- Benzinga on Musk / TradeXYZ: https://www.benzinga.com/crypto/cryptocurrency/26/10/62707863/elon-musk-notes-interesting-hyperliquid-deal-after-druckenmiller-endorsement
- Live plan doc (editable): https://claude.ai/artifact/DN6gFepGmsbBJGeaE6tUco
