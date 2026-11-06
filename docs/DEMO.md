# DEMO.md — 4-minute live demo, fallback and video

From ARCHITECTURE §12 and the pre-kickoff demo script. **Aven is live on HyperEVM mainnet** (docs/DEPLOYMENTS.md §M.5). The numbers below come from the mainnet recording (`pnpm demo`, 2026-11-07), now saved as `frontend/public/arena-fallback.json`.

## Before you go on stage

1. Start the Arena: `pnpm --filter @aven/arena start`. It reads `backend/.env` (chain 999, dedicated RPC) and `contracts/deployments/999.json`. Then:
   - check it with `curl.exe http://localhost:8787/health` (`chainId` 999);
   - expose it with `cloudflared tunnel --url http://localhost:8787`;
   - set `NEXT_PUBLIC_ARENA_API` (the tunnel URL) and `NEXT_PUBLIC_CHAIN_ID=999` on Vercel;
   - add the Vercel origin to `ARENA_CORS_ORIGINS` in `backend/.env`, then restart the Arena.
2. Open the Vercel app with `?admin=<ARENA_ADMIN_TOKEN>` on the Arena page.
3. Dry run (costs < 1¢ of HYPE): `ARENA_URL=http://localhost:8787 ARENA_ADMIN_TOKEN=<from backend/.env> pnpm demo`. It runs the whole flow once on mainnet and saves `frontend/public/arena-fallback.json`, labelled with the chain.
4. Have three things ready:
   - the Replay page on Oct 29;
   - one verified tx hash;
   - the README integration snippet.

## The script (live: 4 min + 3 min questions)

| Time | What you say | What you click / show |
|---|---|---|
| 0:00 Problem (25 s) | "Oct 29: Binance went dark. When the market moves elsewhere, LPs lose to arbitrageurs. Every dynamic-fee hook trusts someone for its price." | Home page: the one-liner |
| 0:25 Insight (25 s) | "On HyperEVM the perp market is chain state. Our library reads HyperCore's oracle and mark in the same block. No operator, keeper or model." | Home: the comparison (Fixed · VolatilePairHook · Aven) |
| 0:50 Arena (90 s) | "This is live on HyperEVM mainnet: two identical Uniswap v4 pools, one with our hook. I shock both the same way." Click **Shock both pools**: both jump ~1.9% off fair. "The bot arbitrages both. The plain pool charges 0.30%; ours charges 1.00% (its ceiling) because this trade closes a stale-price gap." Click **Start bot**. "LPs kept $X more." | Arena: pool cards, trade tape (fee chips base · gap · premium · stress), the "LPs kept $X more" hero |
| 2:20 Verify (in Arena) | "Don't trust our UI: every fee is recomputable from the event." Tap the Aven trade. | Verify drawer: on-chain 10,000 = recomputed 10,000 = Swap event 10,000 → MATCH. Or a terminal: `pnpm verify <tx>` |
| 2:20 Replay (45 s) | "Same idea on real history: Oct 29, four pools." Run it. "Live Aven +$141 vs holding, fixed 0.30% +$7, fixed 0.05% −$318. The live hook beats the 60-second-delayed one: the edge is read speed." | Replay: four lines, results table, limits note |
| 3:05 Adoption (35 s) | "Any v4 hook imports `AvenFairValue`. And `AvenHook` implements Uniswap's own `IDynamicFeeHook`, so routers already know how to quote it." | README snippet; `getFee` |
| 3:40 Close (20 s) | "Every dynamic-fee hook trusts someone for its price. Ours reads the perp market itself. Honest limit: only assets with a HyperCore perp." | QR code |

Reference numbers. They come from **HyperEVM mainnet**, recorded 2026-11-07; the oracle moves, so every run differs a little.

- shock 194 bp;
- Aven arb fee **10,000 pips (1.00% ceiling)** vs 3,000. The fee formula gives 500 + 196 bp × 50 + 2 bp × 50 = 10,400, clamped to 10,000;
- LP fee income $222.14 vs $97.23;
- **LPs kept $124.91 more**;
- bot profit $102.29 vs $218.99;
- verify MATCH on A and B.

Txs:
- Aven arb [`0xe4d7…`](https://hyperevmscan.io/tx/0xe4d72efe449441096d64a56c11c40c103e1983f25496556dc884f450638fab19);
- control arb [`0x142b…`](https://hyperevmscan.io/tx/0x142bf02fb751bc4e73108f62bbd72e5c39ba6b4a51e4094ef9fe8b826dc899dd).

The first live test the same night: 188 bp shock, Aven 9,950 vs 3,000 pips, LPs kept $97.25 more.

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

## Video in one take, no frontend needed (2026-11-07)

Sayan records this; ETHGlobal wants your own screen and voice. Use OBS Studio or Windows **Win+Alt+R** (Xbox Game Bar), at 1080p. Three windows ready:
1. **Terminal 1**, with the Arena running and showing its `[arena] chain 999 …` line.
2. **Terminal 2**, in the repo.
3. **Browser tabs:**
   - the hook on hyperevmscan: https://hyperevmscan.io/address/0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080;
   - `docs/DEPLOYMENTS.md` §M.5 on GitHub;
   - the Replay page or `backend/data/replay/README.md`.

| Time | Say | Show / type |
|---|---|---|
| 0:00–0:25 | Problem: when the market moves elsewhere, LPs lose to arbitrageurs; every dynamic-fee hook trusts someone for its price. | README one-liner |
| 0:25–0:50 | Insight: on HyperEVM the perp market is chain state. AvenHook reads HyperCore's oracle and mark **in the same block**; no operator, keeper or owner. | Hook on hyperevmscan |
| 0:50–2:10 | Live on mainnet: Terminal 2: `curl.exe http://localhost:8787/state`, then the demo: `pnpm demo` (with `ARENA_ADMIN_TOKEN` from `backend/.env`). Explain: shock both pools the same → the bot arbs both → Aven charges up to 1.00% vs 0.30% → LPs kept $X more. | The summary the demo prints |
| 2:10–2:40 | Don't trust us, recompute it: `pnpm verify <the Aven arb tx>` with `CHAIN_ID=999 HYPEREVM_RPC=https://rpc.hyperliquid.xyz/evm`. | MATCH on checks A and B; then the tx on hyperevmscan |
| 2:40–3:20 | Real history: the Oct 29 replay. Live Aven +$141 vs holding, fixed 0.30% +$7, fixed 0.05% −$318; the live hook beats the 60 s-delayed one. | Replay page or replay README table |
| 3:20–3:50 | Adoption: any v4 hook can import `AvenFairValue`; `AvenHook` implements Uniswap's `IDynamicFeeHook`. Proofs: 10k Solidity = TypeScript vectors, invariants, audit. | README / PROOFS.md |
| 3:50–4:00 | Close: "Ours reads the perp market itself." Honest limit: only assets with a HyperCore perp. | — |

Each `pnpm demo` costs < 1¢ of HYPE and stops the bot itself afterwards. Do one practice run first.

