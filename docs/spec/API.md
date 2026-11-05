## B4 — API (services/arena)

Base URL: `NEXT_PUBLIC_ARENA_API`. JSON. POST routes need header `x-admin-token`.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ok, chainId, block, botEnabled, version}` |
| GET | `/config` | `{chainId, hook, poolManager, pools:{aven, control}, config, params, explorer}` |
| GET | `/state` | `{block, ts, oracle:{raw, price}, mark:{raw, price}, pools:{control: PoolState, aven: PoolState}}` |
| GET | `/stats` | `{since, control: PoolStats, aven: PoolStats, lpKeptMoreUsd, botProfitDiffUsd}` |
| GET | `/trades?limit=50&pool=aven\|control` | `Trade[]`, newest first |
| GET | `/bot/status` | `{enabled, lastRunBlock, lastError, balances}` |
| GET | `/verify/:tx` | `VerifyResult` |
| GET | `/stream` | SSE events: `state`, `trade`, `shock`, `bot` |
| POST | `/shock` `{sizeBase?, direction?}` | `Shock` |
| POST | `/bot/start` · `/bot/stop` | `{enabled}` |
| POST | `/reset-stats` | `{since}` |

```ts
type Reason = "OK" | "READ_FAILED" | "GAP_TOO_LARGE";
type Breakdown = { fee: number; reason: Reason; gapBps: number; premiumBps: number; moveBps: number;
  arb: boolean; withPressure: boolean };
type PoolState = { poolId: string; price: number; gapBps: number; liquidity: string;
  feePreview: { buyBase: Breakdown; sellBase: Breakdown } | { fixedPips: 3000 };
  hookState?: { topBlock: number; sqrtPriceTopX96: string; anchorMark: string; anchorTime: number } };
type PoolStats = { trades: number; botProfitUsd: number; lpFeeIncomeUsd: number; volumeUsd: number };
type Trade = { id: string; ts: number; block: number; pool: "aven" | "control"; kind: "arb" | "retail";
  direction: "buyBase" | "sellBase"; amountIn: string; amountOut: string; feePips: number;
  feeUsd: number; botProfitUsd: number; lpFeeIncomeUsd: number; txHash: string;
  breakdown?: Breakdown; verify?: { checkA: boolean; checkB: boolean } };
type Shock = { id: string; ts: number; sizeBase: string; direction: string; txHashes: string[] };
type VerifyResult = { match: boolean; checkA: boolean; checkB: boolean; onchainFee: number;
  recomputedFee: number; swapEventFee: number; inputs: Record<string, string>; breakdown: Breakdown };
```
