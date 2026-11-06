/**
 * Live-mode source check (`pnpm live:check`): every price AvenHook used must be a pair the relay copied from
 * Hyperliquid's info API, in effect at that block. Pure logic here; the CLI is backend/scripts/live-check.ts.
 *
 * A relay entry logged with block L (latest block when written) takes effect at L+1, or at L+2 if a block was mined
 * between reading L and the write. So at block b the hook may see the last entry with L <= b-1, or, when that entry has
 * L == b-1, the entry before it.
 */
import type { RelayLogEntry } from "./priceRelay.ts";

export interface FeeEvent {
  block: bigint;
  tx: string;
  reason: number; // 0 OK, 1 READ_FAILED, 2 GAP_TOO_LARGE
  oracleRaw: bigint;
  markRaw: bigint;
}

export interface SourceCheck {
  checked: number;
  fromApi: number; // OK / GAP_TOO_LARGE events whose prices match a relay write in effect
  fallbackWhileStale: number; // READ_FAILED while the relay had switched reads off
  mismatches: Array<{ event: FeeEvent; why: string }>;
}

export function checkSources(events: FeeEvent[], log: RelayLogEntry[]): SourceCheck {
  const prices = log.filter((e) => e.event === "price").map((e) => ({ L: BigInt(e.block), o: BigInt(e.oracleRaw!), m: BigInt(e.markRaw!) }));
  const failEdges = log.filter((e) => e.event !== "price").map((e) => ({ L: BigInt(e.block), on: e.event === "fail-on" }));
  const out: SourceCheck = { checked: 0, fromApi: 0, fallbackWhileStale: 0, mismatches: [] };
  for (const ev of events) {
    out.checked++;
    if (ev.reason === 1) {
      // Reads were failing at b if the last fail edge with L <= b-1 is "on" (or the one before it, same timing rule).
      const edges = failEdges.filter((f) => f.L <= ev.block - 1n);
      const last = edges[edges.length - 1];
      const prev = edges[edges.length - 2];
      if (last?.on || (last && last.L === ev.block - 1n && prev?.on)) out.fallbackWhileStale++;
      else out.mismatches.push({ event: ev, why: "READ_FAILED while the relay had not switched reads off" });
      continue;
    }
    const before = prices.filter((p) => p.L <= ev.block - 1n);
    const last = before[before.length - 1];
    const prev = before[before.length - 2];
    const ok = (p?: { o: bigint; m: bigint }) => !!p && p.o === ev.oracleRaw && p.m === ev.markRaw;
    if (ok(last) || (last && last.L === ev.block - 1n && ok(prev))) out.fromApi++;
    else out.mismatches.push({ event: ev, why: `oracle ${ev.oracleRaw} / mark ${ev.markRaw} is not the relayed pair in effect (expected ${last?.o}/${last?.m})` });
  }
  return out;
}
