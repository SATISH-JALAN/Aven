## B6 — Frontend features

**MUST**
- **Global:** Aven wordmark; nav (Home, Arena, Replay); network badge "HyperEVM testnet"; service status dot; dark terminal theme; teal = normal, amber = stress; monospaced numbers; a source label on every number; works at phone width.
- **Home:**
  - one-line pitch and the positioning line ("learns from the pool's past vs reads the market's present")
  - 3-sentence explainer (problem → in-block perp price → fee)
  - compact comparison: Fixed fee · Uniswap VolatilePairHook · Aven (signal source, trust, reacts)
  - "Implements Uniswap's IDynamicFeeHook" badge
  - integration snippet with copy button; contract addresses with explorer links; repo link
  - buttons to Arena and Replay
- **Arena:**
  - two pool cards (Plain 0.30% vs Aven): pool price, fair value (oracle), mark, gap bp, next-fee preview for buy and sell with chips (base · gap · premium · stress) and a fallback badge when reason ≠ OK
  - hero metric "LPs kept $X more", plus per-pool bot profit, LP fee income and trade count
  - price chart: control price, Aven price, oracle, mark
  - live trade tape (SSE): pool, direction, size, fee + chips, bot profit, tx link, verify badge
  - Verify drawer: inputs, on-chain vs recomputed vs Swap-event fee, checks A and B, MATCH badge, "verify it yourself" command
  - admin controls (only with `?admin=<token>`): Shock both pools, Start/Stop bot, Reset stats
  - offline fallback: the recorded run, clearly labelled "Recorded run"
- **Replay:** scenario picker (Binance halt Oct 29 / calm / volatile-2); Run → four animated LP-value lines vs HODL; results table per pool (LP value, fees earned, LVR $ and %, arb trades); method + limitations note; share link + QR code.
- **States:** loading skeletons, empty states, RPC/service errors with retry.

**NICE (only if time)**
- "Try it yourself" swap panel with wallet connect and live `previewFee` for both directions
- Shareable result card image for Replay
- Fee timeline mini-chart per pool
