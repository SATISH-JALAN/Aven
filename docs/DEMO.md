# DEMO.md — 4-minute live demo, fallback and video

From ARCHITECTURE §12 and the pre-kickoff demo script. **The live demo runs in live mode** (docs/DEPLOYMENTS.md §A): the unchanged contracts on a local chain, with live Hyperliquid mainnet ETH prices relayed into the precompile addresses. Badge: **"Live prices · local chain"**. Numbers below come from the live-mode recording (`pnpm live:record`, 2026-11-06).

## Before you go on stage

1. Start live mode: `ARENA_ADMIN_TOKEN=<token> ARENA_CORS_ORIGINS=<frontend origin> pnpm live`, and wait for `[live] READY`.
   - Expose it with `cloudflared tunnel --url http://localhost:8787` (Arena) and `cloudflared tunnel --url http://localhost:8546` (read-only RPC). Never expose 8545.
   - Set `NEXT_PUBLIC_ARENA_API`, `NEXT_PUBLIC_RPC` and `NEXT_PUBLIC_CHAIN_ID=31337` on Vercel.
2. Open the Vercel app with `?admin=<ARENA_ADMIN_TOKEN>` on the Arena page.
3. Dry run against that Arena: `ARENA_URL=http://localhost:8787 ARENA_ADMIN_TOKEN=... pnpm demo`. Afterwards run `pnpm live:check`, which must PASS.
   - `pnpm demo` overwrites `frontend/public/arena-fallback.json`. To refresh the fallback, stop live mode and run `pnpm live:record` instead, which labels the price source.
4. Say it plainly once: "The chain is local because we couldn't get testnet HYPE. The prices are Hyperliquid's live oracle and mark, and the contracts are byte-identical to what we'd deploy on HyperEVM."
5. Have three things ready:
   - the Replay page on Oct 29;
   - one verified tx hash;
   - the README integration snippet.

## The script (live: 4 min + 3 min questions)

| Time | What you say | What you click / show |
|---|---|---|
| 0:00 Problem (25 s) | "Oct 29: Binance went dark. When the market moves elsewhere, LPs lose to arbitrageurs. Every dynamic-fee hook trusts someone for its price." | Home page: the one-liner |
| 0:25 Insight (25 s) | "On HyperEVM the perp market is chain state. Our library reads HyperCore's oracle and mark in the same block. No operator, keeper or model. Today's demo chain is local, fed with Hyperliquid's live prices." | Home: the comparison (Fixed · VolatilePairHook · Aven); the "Live prices · local chain" badge |
| 0:50 Arena (90 s) | "Two identical pools. I shock both the same way." Click **Shock both pools**: both jump ~1.6% off fair. "The bot arbitrages both. The plain pool charges 0.30%; ours charges ~0.87% because this trade closes a stale-price gap." Click **Start bot**. "LPs kept $X more." | Arena: pool cards, trade tape (fee chips base · gap · premium · stress), the "LPs kept $X more" hero |
| 2:20 Verify (in Arena) | "Don't trust our UI: every fee is recomputable, and every price it used came from Hyperliquid." Tap the Aven trade. | Verify drawer: on-chain = recomputed = Swap event (8,450 in the recording) → MATCH; terminal: `pnpm live:check` → PASS |
| 2:20 Replay (45 s) | "Same idea on real history: Oct 29, four pools." Run it. "Live Aven +$141 vs holding, fixed 0.30% +$7, fixed 0.05% −$318. The live hook beats the 60-second-delayed one: the edge is read speed." | Replay: four lines, results table, limits note |
| 3:05 Adoption (35 s) | "Any v4 hook imports `AvenFairValue`. And `AvenHook` implements Uniswap's own `IDynamicFeeHook`, so routers already know how to quote it." | README snippet; `getFee` |
| 3:40 Close (20 s) | "Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself. Honest limit: only assets with a HyperCore perp." | QR code |

Reference numbers. The live price moves, so every run differs a little.

Live-mode recording (2026-11-06, ETH ≈ $2,238):
- shock 157 bp;
- Aven arb fee 8,450 vs 3,000;
- **LPs kept $55.14 more**;
- verify MATCH;
- `live:check` PASS.

The earlier fixed-price local run (`demo:local`): shock 164 bp, 8,700 vs 3,000, LPs kept $64.33 more.

## If the RPC or service is slow

1. The Arena page falls back to `frontend/public/arena-fallback.json` (a live-mode recording), clearly labelled **"Recorded run"**. Say so out loud.
2. Show the README's tx links, then run `pnpm verify <tx>` in a terminal: MATCH on checks A and B.
3. The Replay doesn't need the network at all.

## Video (2–4 min)

- At least 720p, your own voice, a laptop screen recording (not a phone filming the screen), no speed-up, no AI voiceover, no music-plus-captions instead of voice.
- Shot list:
  1. Problem + insight over Home (40 s).
  2. **Arena in real time, no cuts:** shock → bot → hero number → Verify drawer (90 s).
  3. Replay Oct 29 + results table (40 s).
  4. Integration snippet + `IDynamicFeeHook` (20 s).
  5. Close + QR (10 s).
- Cuts are fine between sections; keep step 2 uncut.
