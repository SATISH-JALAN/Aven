# backend/data/raw/

Replay inputs, fetched by `pnpm --filter @aven/scripts fetch-market-data` (backend/scripts/fetch-market-data.ts).

- **Source:** Hyperliquid MAINNET info API `https://api.hyperliquid.xyz/info`, endpoints `candleSnapshot` (HYPE perp candles) and `fundingHistory` (hourly funding + premium).
- **Downloaded:** 2026-11-05T23:28:36.984Z.
- **Interval:** 1m is tried first. Hyperliquid no longer serves 1m candles for these windows (0 returned), so every scenario fell back to **5m**, as P7 allows. Each `meta.json` records the interval and the reason.
- **Files per scenario:** `candles.json` (raw pages), `funding.json` (raw), `meta.json` (window, counts, missing intervals, price range), `normalized.csv` (`timestamp,markClose,premium,oracleProxy,interval`, DATA.md B5).

## Method and limits (state these on every chart)

- `markClose` is the perp candle close, i.e. the last traded price. It stands in for the mark price; the true mark is a median of oracle+EMA, the book and CEX perps (ARCHITECTURE §3.3).
- `premium` is the latest hourly funding premium at or before the candle (forward-filled).
- `oracleProxy = markClose / (1 + premium)` reconstructs the validator oracle from the premium. **It is an approximation, not the historical oracle** (§13).
- Hourly premium resolution means intra-hour divergence between mark and oracle is not captured.

## Scenarios

| id | interval | candles | funding samples | missing | fallback |
|---|---|---|---|---|---|
| binance-halt | 5m | 72 | 8 | 0 | 1m candles not served for this window |
| calm | 5m | 72 | 8 | 0 | 1m candles not served for this window |
