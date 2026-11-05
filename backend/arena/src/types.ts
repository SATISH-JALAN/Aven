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
