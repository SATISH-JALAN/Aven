# DEMO.md — 4-minute live demo, fallback and video

From ARCHITECTURE §12 and the pre-kickoff demo script. Numbers below come from the latest local run (`pnpm --filter @aven/arena demo:local`). Re-record on testnet with `pnpm demo` once the testnet deploy exists (docs/DEPLOYMENTS.md).

## Before you go on stage

1. Start the Arena: `pnpm --filter @aven/arena start` (it reads `backend/.env` and `contracts/deployments/998.json`). Then expose it with `cloudflared tunnel --url http://localhost:8787` and set `NEXT_PUBLIC_ARENA_API` on Vercel to the tunnel URL.
2. Open the Vercel app with `?admin=<ARENA_ADMIN_TOKEN>` on the Arena page.
3. Dry run: `ARENA_URL=<tunnel> ARENA_ADMIN_TOKEN=... pnpm demo`. It does the whole flow once and saves `frontend/public/arena-fallback.json`.
4. Have three things ready:
   - the Replay page on Oct 29;
   - one verified tx hash;
   - the README integration snippet.

## The script (live: 4 min + 3 min questions)

| Time | What you say | What you click / show |
|---|---|---|
| 0:00 Problem (25 s) | "Oct 29: Binance went dark. When the market moves elsewhere, LPs lose to arbitrageurs. Every dynamic-fee hook trusts someone for its price." | Home page: the one-liner |
| 0:25 Insight (25 s) | "On HyperEVM the perp market is chain state. Our library reads HyperCore's oracle and mark in the same block. No operator, keeper or model." | Home: the comparison (Fixed · VolatilePairHook · Aven) |
| 0:50 Arena (90 s) | "Two identical pools. I shock both the same way." Click **Shock both pools**: both jump ~1.6% off fair. "The bot arbitrages both. The plain pool charges 0.30%; ours charges ~0.87% because this trade closes a stale-price gap." Click **Start bot**. "LPs kept $X more." | Arena: pool cards, trade tape (fee chips base · gap · premium · stress), the "LPs kept $X more" hero |
| 2:20 Verify (in Arena) | "Don't trust our UI: every fee is recomputable." Tap the Aven trade. | Verify drawer: on-chain 8,700 = recomputed 8,700 = Swap event 8,700 → MATCH |
| 2:20 Replay (45 s) | "Same idea on real history: Oct 29, four pools." Run it. "Live Aven +$141 vs holding, fixed 0.30% +$7, fixed 0.05% −$318. The live hook beats the 60-second-delayed one: the edge is read speed." | Replay: four lines, results table, limits note |
| 3:05 Adoption (35 s) | "Any v4 hook imports `AvenFairValue`. And `AvenHook` implements Uniswap's own `IDynamicFeeHook`, so routers already know how to quote it." | README snippet; `getFee` |
| 3:40 Close (20 s) | "Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself. Honest limit: only assets with a HyperCore perp." | QR code |

Reference numbers (local run; testnet values will differ):
- shock 164 bp;
- Aven arb fee 8,700 vs 3,000;
- LP fee income $161.31 vs $96.98;
- **LPs kept $64.33 more**;
- bot profit $70.41 vs $215.26;
- verify MATCH.

## If the RPC or service is slow

1. The Arena page falls back to `frontend/public/arena-fallback.json`, clearly labelled **"Recorded run"**. Say so out loud.
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
