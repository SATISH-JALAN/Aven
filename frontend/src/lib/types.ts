/**
 * Arena API shapes. Type-only re-export of backend/arena/src/types.ts (docs/spec/API.md, B4), so the frontend and the
 * service can never drift apart. Erased at build time; no backend code ends up in the bundle.
 */
export type {
  Breakdown,
  Direction,
  PoolName,
  PoolState,
  PoolStats,
  Reason,
  Shock,
  StateResponse,
  Stats,
  Trade,
  VerifyResult,
} from "../../../backend/arena/src/types.ts";

import type { Deployments } from "@/config";
import type { Shock, StateResponse, Stats, Trade, VerifyResult } from "../../../backend/arena/src/types.ts";

export type Mode = "LIVE" | "RECORDED" | "REPLAY";

export interface ArenaConfigResponse {
  chainId: number;
  hook: string;
  poolManager: string;
  pools: Deployments["pools"];
  config: Deployments["config"];
  params: Deployments["params"];
  explorer?: string;
}

export interface BotStatus {
  enabled: boolean;
  lastRunBlock: number;
  lastError: string | null;
  balances: Record<string, string>;
}

export interface Health {
  ok: boolean;
  chainId: number;
  block: number;
  botEnabled: boolean;
  version: string;
}

/** frontend/public/arena-fallback.json, written by backend/scripts/src/demo.ts. */
export interface RecordedRun {
  badge: "Recorded run";
  recordedAt: string;
  chainId: number;
  arenaVersion: string;
  config: ArenaConfigResponse;
  shock: Shock;
  state: { before: StateResponse; afterShock: StateResponse; after: StateResponse };
  trades: Trade[];
  stats: Stats;
  highlight: { avenArb: Trade; controlArb: Trade; verify: VerifyResult };
  source: string;
}
