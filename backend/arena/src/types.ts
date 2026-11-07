/** API data shapes, exactly docs/spec/API.md (B4). The frontend relies on these; change only with both sides. */
export type Reason = "OK" | "READ_FAILED" | "GAP_TOO_LARGE";
export type Breakdown = {
  fee: number;
  reason: Reason;
  gapBps: number;
  premiumBps: number;
  moveBps: number;
  arb: boolean;
  withPressure: boolean;
};
export type PoolState = {
  poolId: string;
  price: number;
  gapBps: number;
  liquidity: string;
  feePreview: { buyBase: Breakdown; sellBase: Breakdown } | { fixedPips: 3000 };
  hookState?: { topBlock: number; sqrtPriceTopX96: string; anchorMark: string; anchorTime: number };
};
export type PoolStats = { trades: number; botProfitUsd: number; lpFeeIncomeUsd: number; volumeUsd: number };
export type PoolName = "aven" | "control";
export type Direction = "buyBase" | "sellBase";
export type Trade = {
  id: string;
  ts: number;
  block: number;
  pool: PoolName;
  kind: "arb" | "retail";
  direction: Direction;
  amountIn: string;
  amountOut: string;
  feePips: number;
  feeUsd: number;
  botProfitUsd: number;
  lpFeeIncomeUsd: number;
  txHash: string;
  breakdown?: Breakdown;
  verify?: { checkA: boolean; checkB: boolean };
};
export type Shock = { id: string; ts: number; sizeBase: string; direction: string; txHashes: string[] };
/** One round of a bulk run: a shock on both pools, then the bot's pass in a later block. */
export type BurstRound = {
  round: number;
  direction: Direction;
  sizeBase: string;
  /** Block of the shock swaps and the oracle the shock was sized at (raw precompile units). */
  shockBlock: number;
  oracleRaw: string;
  shockTxs: string[];
  /** The bot's arbs after the shock (0, 1 or 2: it only trades when the arb pays). */
  arbs: Array<{ pool: PoolName; txHash: string; block: number; feePips: number }>;
};
/** A bulk run (POST /burst): N rounds, one after another, admin only. */
export type Burst = {
  id: string;
  status: "running" | "done" | "stopped" | "error";
  startedAt: number;
  endedAt: number | null;
  rounds: number;
  sizeBase: string;
  error: string | null;
  results: BurstRound[];
};
export type VerifyResult = {
  match: boolean;
  checkA: boolean;
  checkB: boolean;
  onchainFee: number;
  recomputedFee: number;
  swapEventFee: number;
  inputs: Record<string, string>;
  breakdown: Breakdown;
};
export type Stats = {
  since: number;
  control: PoolStats;
  aven: PoolStats;
  lpKeptMoreUsd: number;
  botProfitDiffUsd: number;
};
export type StateResponse = {
  block: number;
  ts: number;
  oracle: { raw: string; price: number };
  mark: { raw: string; price: number };
  pools: { control: PoolState; aven: PoolState };
};
