/**
 * Ledger rows: each on-chain swap joined with what the chain says around it. Pure (no RPC).
 *
 * - Price before: an Aven swap logs it (FeeComputed.sqrtPriceX96). For any swap, it is also the previous swap's price
 *   after on the same pool: exact, because the ledger holds every swap of the scanned range (liquidity changes don't
 *   move the price). The first swap of the range has none.
 * - Oracle and mark: an Aven swap logs the precompile values it read in its own block. A plain-pool swap logs none;
 *   it takes both from an Aven swap in the same block (exact) or within NEAR blocks (marked approximate), else none.
 *   HyperEVM can't serve past precompile reads (recon B.3), so there is no other source on chain.
 */
import { rawToPrice } from "@aven/core/price";
import type { Deployments } from "@/config";
import { viewSwap, type ChainEvent, type SwapView } from "@/lib/onchain";
import type { PoolName } from "@/lib/types";

export const NEAR = 3;

export interface LedgerRow {
  e: ChainEvent;
  v: SwapView;
  /** Where the oracle came from: this swap's own FeeComputed, an Aven swap in the same block, a nearby one, none. */
  oracleFrom: "own" | "same block" | "nearby" | null;
  oracleBlock: number | null;
  /** Price before from the previous swap on this pool (when the swap itself didn't log it). */
  priceBefore: number | null;
  gapBefore: number | null;
  /** Blocks since the previous swap on the same pool (null for the first in range). */
  sinceSwap: number | null;
  /** Oracle move since the previous Aven swap, bp (Aven swaps only; the "price bump" each swap answered). */
  oracleMoveBps: number | null;
}

/** Rows newest first, from ledger items (any order). Swaps only. */
export function ledgerRows(items: ChainEvent[], d: Deployments): LedgerRow[] {
  const swaps = items.filter((x) => x.kind === "swap").sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const aven = swaps.filter((x) => x.fc);
  const prevAfter: Record<PoolName, { sqrt: string; block: number } | null> = { aven: null, control: null };
  let prevAvenOracle: number | null = null;
  const out: LedgerRow[] = [];
  for (const e of swaps) {
    let oracleFrom: LedgerRow["oracleFrom"] = e.fc ? "own" : null;
    let hint: number | null = null;
    let markHint: number | null = null;
    let oracleBlock: number | null = e.fc ? e.block : null;
    if (!e.fc) {
      // Nearest Aven swap by block (same block first).
      let best: ChainEvent | null = null;
      for (const a of aven) {
        const dist = Math.abs(a.block - e.block);
        if (dist > NEAR) continue;
        if (!best || dist < Math.abs(best.block - e.block)) best = a;
      }
      if (best) {
        hint = rawToPrice(BigInt(best.fc!.oracleRaw), d.config.szDecimals);
        markHint = rawToPrice(BigInt(best.fc!.markRaw), d.config.szDecimals);
        oracleFrom = best.block === e.block ? "same block" : "nearby";
        oracleBlock = best.block;
      }
    }
    const v = viewSwap(e, d, hint, markHint);
    const prev = prevAfter[e.pool];
    const prevPrice = prev ? viewSwap({ ...e, sqrtAfter: prev.sqrt, fc: null }, d, hint).priceAfter : null;
    const priceBefore = v.priceBefore ?? prevPrice;
    const gapBefore = v.gapBefore ?? (priceBefore !== null && v.oracle ? ((priceBefore - v.oracle) / v.oracle) * 10_000 : null);
    out.push({
      e,
      v,
      oracleFrom,
      oracleBlock,
      priceBefore,
      gapBefore,
      sinceSwap: prev ? e.block - prev.block : null,
      oracleMoveBps: e.fc && prevAvenOracle && v.oracle ? ((v.oracle - prevAvenOracle) / prevAvenOracle) * 10_000 : null,
    });
    prevAfter[e.pool] = { sqrt: e.sqrtAfter, block: e.block };
    if (e.fc && v.oracle) prevAvenOracle = v.oracle;
  }
  return out.reverse();
}

export interface LedgerStats {
  swaps: Record<PoolName, number>;
  liquidity: number;
  avenVerified: number;
  avenOk: number;
  /** Aven swaps whose oracle differed from the previous Aven swap's: the price bumps the hook answered. */
  oracleMoves: number;
  firstBlock: number | null;
  lastBlock: number | null;
}

export function ledgerStats(items: ChainEvent[], rows: LedgerRow[]): LedgerStats {
  const s: LedgerStats = { swaps: { aven: 0, control: 0 }, liquidity: 0, avenVerified: 0, avenOk: 0, oracleMoves: 0, firstBlock: null, lastBlock: null };
  for (const x of items) {
    if (x.kind === "liquidity") s.liquidity++;
    else s.swaps[x.pool]++;
    if (x.verify) {
      s.avenVerified++;
      if (x.verify.a && x.verify.b) s.avenOk++;
    }
    s.firstBlock = s.firstBlock === null ? x.block : Math.min(s.firstBlock, x.block);
    s.lastBlock = s.lastBlock === null ? x.block : Math.max(s.lastBlock, x.block);
  }
  s.oracleMoves = rows.filter((r) => r.oracleMoveBps !== null && Math.abs(r.oracleMoveBps) >= 0.5).length;
  return s;
}
