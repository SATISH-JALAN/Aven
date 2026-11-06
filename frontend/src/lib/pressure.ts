/**
 * Is a pool being pushed off the market price right now, and by what? Pure display logic over the Arena state and
 * trades (no fee math). A pool is "pushed" when its price sits at least PUSH_BPS away from the HyperCore oracle; the
 * same threshold colours the gap on the Pool page and the Trade page.
 */
import type { PoolName, Trade } from "@/lib/types";

export const PUSH_BPS = 30;

export type PushDir = "above" | "below" | null;

export interface PushState {
  pushed: boolean;
  dir: PushDir;
  /** "Pushed +188 bp above the oracle" / "At the oracle (−4 bp)" */
  label: string;
}

const signedBp = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x))} bp`;

export function pushState(gapBps: number, threshold = PUSH_BPS): PushState {
  const pushed = Math.abs(gapBps) >= threshold;
  const dir: PushDir = !pushed ? null : gapBps > 0 ? "above" : "below";
  return { pushed, dir, label: pushed ? `Pushed ${signedBp(gapBps)} ${dir} the oracle` : `At the oracle (${signedBp(gapBps)})` };
}

export interface PoolActivity {
  /** Latest swap on this pool that wasn't the Arena bot: a shock or a wallet trade. These move the pool off fair. */
  lastPush: Trade | null;
  /** Latest Arena bot arbitrage on this pool: the trade that pulls it back toward the oracle. */
  lastArb: Trade | null;
}

export function poolActivity(pool: PoolName, trades: readonly Trade[]): PoolActivity {
  let lastPush: Trade | null = null;
  let lastArb: Trade | null = null;
  for (const t of trades) {
    if (t.pool !== pool) continue;
    if (t.kind === "arb") {
      if (!lastArb || t.ts > lastArb.ts) lastArb = t;
    } else if (!lastPush || t.ts > lastPush.ts) {
      lastPush = t;
    }
  }
  return { lastPush, lastArb };
}
