## B5 — Data formats

- `contracts/deployments/998.json`: exactly §8.3.
- `data/arena/trades.jsonl`: one `Trade` or `Shock` per line.
- `data/raw/<scenario>/normalized.csv`: `timestamp,markClose,premium,oracleProxy,interval`
- `data/replay/<scenario>.csv`: `step,timestamp,pool,poolPrice,oracle,mark,feePips,reason,lpValueUsd,hodlValueUsd,lvrUsd,lvrPct,feesCumUsd,arbTrades,retailTrades`; `pool ∈ {fixed05, fixed30, avenDelayed, avenLive}`
- `data/replay/<scenario>.summary.json`: final values per pool, parameters, interval, method notes
- `data/vectors/fee-vectors.json`: `[{inputs:{cfg, params, oracleRaw, markRaw, anchorMarkRaw, sqrtPriceX96, sqrtPriceTopX96, zeroForOne, readOk}, expected: Breakdown}]`
- `data/vectors/anchor-vectors.json`: `[{inputs:{anchorMark, anchorTime, markRaw, now, tau}, expected:{mark, time}}]`
- `apps/web/public/replay/<scenario>.json`: downsampled series + summary
- `apps/web/public/arena-fallback.json`: recorded Arena run (trades, stats, timestamps)
