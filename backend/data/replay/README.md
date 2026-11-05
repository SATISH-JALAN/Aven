# backend/data/replay/

Outputs of the offline replay (`contracts/test/replay/Replay.t.sol`, ARCHITECTURE §7.4).

To rerun:
1. `pnpm replay:binance-halt` / `pnpm replay:calm` (root);
2. `pnpm --filter @aven/scripts replay-to-web` to regenerate `frontend/public/replay/*.json`.

Files:
- `<id>.csv`: one row per pool per 5m step (`step,timestamp,pool,poolPrice,oracle,mark,feePips,reason,lpValueUsd,hodlValueUsd,lvrUsd,lvrPct,feesCumUsd,arbTrades,retailTrades`, DATA.md B5). `feePips`/`reason` belong to that step's arb trade: `0,-` means no arb, and `FIXED` marks a fixed-fee pool.
- `<id>.summary.json`: final values per pool, parameters, interval, method and limits.
- `<id>.input.json`: the generated pre-step input (gitignored).

## Method

- **Pools:** four pools in one local v4 PoolManager, with identical liquidity (1,000 aHYPE on the base side, range about −50%/+50%) and the same start price (the first oracle value):
  - `fixed05`: 0.05%;
  - `fixed30`: 0.30%;
  - `avenDelayed`: AvenHook on perp index 1. The mock serves it prices about **60 s earlier**, linearly interpolated between 5m candles (1m data isn't served for these dates);
  - `avenLive`: AvenHook on perp index 0, current prices.

  Both hooks use the spec default `Params`; nothing is tuned.
- **Each step:**
  1. `vm.warp` to the candle and `vm.roll` +1, so top-of-block and the anchor behave as on chain.
  2. Set the mock oracle to `oracleProxy` and the mark to the candle close.
  3. For each pool:
     - the arb agent runs the Arena bot's algorithm: quote the fee (fixed, or `previewFee` for Aven), trade toward p*, measure profit at the **true** oracle, and revert unprofitable trades;
     - then a seeded retail swap of $100 to $3,000 in a random direction, **identical on every pool**;
     - then the LP position is poked (liquidity 0) to collect fees.
- **Accounting:**
  - LP value = position principal at the current pool price + collected fees, at the oracle;
  - HODL = the initial tokens at the oracle;
  - LVR = HODL − LP value (negative = LPs beat holding).
- **Sanity tests** (always run in `forge test`):
  - flat market, no retail: zero trades and zero LVR;
  - flat market with retail: identical flow, and fixed30 earns about 6× fixed05's fees.
- **Hand check** (binance-halt, avenLive):
  - step 1: pre-trade gap 65 bp (arb) and premium −2 bp (with pressure) give 500 + 65·50 + 2·50 = **3,850**, which matches the CSV;
  - step 2: 500 + 68·50 + 2·50 = **4,000**, which matches.

## Limits (state these with the results)

- `oracleProxy` = candle close / (1 + hourly funding premium) approximates the historical validator oracle; the candle close approximates the mark.
- 5m steps with one arb attempt per pool per step. Real arbitrageurs react within seconds, so absolute LVR is understated, for every pool alike.
- One LP position per pool. Retail size relative to pool depth is a simulation choice: each $3k retail swap moves the price about 1%.
- Two scenarios so far; `volatile-2` is waiting for a window choice.

## Results (generated, no tuning)

| Scenario | Pool | LP value $ | HODL $ | LVR $ | LVR % | Fees $ | Arbs | Retail |
|---|---|---|---|---|---|---|---|---|
| Oct 29 18:00-24:00 (Binance halt) | fixed05 | 238191.3360 | 238509.5160 | 318.1799 | 0.133403 | 84.3690 | 67 | 44 |
| Oct 29 18:00-24:00 (Binance halt) | fixed30 | 238516.2839 | 238509.5160 | -6.7679 | -0.002837 | 404.6869 | 46 | 44 |
| Oct 29 18:00-24:00 (Binance halt) | avenDelayed | 238623.9860 | 238509.5160 | -114.4699 | -0.047993 | 501.6608 | 63 | 44 |
| Oct 29 18:00-24:00 (Binance halt) | avenLive | 238650.7709 | 238509.5160 | -141.2549 | -0.059224 | 525.6512 | 64 | 44 |
| Oct 25 06:00-12:00 (calm) | fixed05 | 196762.0301 | 196697.5119 | -64.5181 | -0.032800 | 61.2527 | 61 | 44 |
| Oct 25 06:00-12:00 (calm) | fixed30 | 197015.0031 | 196697.5119 | -317.4912 | -0.161410 | 309.7869 | 47 | 44 |
| Oct 25 06:00-12:00 (calm) | avenDelayed | 197020.9030 | 196697.5119 | -323.3910 | -0.164410 | 316.0567 | 66 | 44 |
| Oct 25 06:00-12:00 (calm) | avenLive | 197020.6570 | 196697.5119 | -323.1450 | -0.164285 | 316.1094 | 67 | 44 |

**Reading it:**

- **Binance halt:**
  - The live Aven hook ends **$141 above HODL** and the delayed hook $114 above.
  - Fixed 0.30% ends roughly flat (+$7); fixed 0.05% ends **$318 below HODL**.
  - The live hook beats the delayed one: the edge comes from reading the perp market in-block.
- **Calm day:**
  - Aven roughly matches fixed 0.30% (+$323 vs +$317) while charging retail only the 0.05% base fee.
  - Live and delayed are about the same, because a 60 s lag doesn't matter when nothing moves.
