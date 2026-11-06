/**
 * Live price relay for the local chain ("live mode", docs/DEPLOYMENTS.md §A).
 *
 * HyperEVM's 0x807 (oracle) and 0x806 (mark) precompiles return Hyperliquid's own oracle and mark prices, which equal
 * the public info API after scaling (recon C.3). This relay polls the info API (`metaAndAssetCtxs`) and writes those
 * exact values into the MockHyperCorePx contracts etched at 0x806/0x807 on the local anvil chain, so the unchanged
 * AvenHook reads the same numbers it would read on HyperEVM.
 *
 * - Only changed values are written, and both together between blocks (LocalChain.writePrices, no transaction).
 * - If the API gives no good answer for `staleMs`, the relay makes both price precompiles revert, so the hook charges
 *   its fallback fee (READ_FAILED) instead of pricing swaps on a stale value. The next good answer restores them.
 * - Every write is logged (`RelayLogEntry`), so `live:check` can prove each price the hook used came from the API.
 */
import { pxToRaw } from "@aven/core";

export const HL_INFO_API_MAINNET = "https://api.hyperliquid.xyz/info";

export interface PerpPrices {
  oracleRaw: bigint;
  markRaw: bigint;
  oraclePx: string;
  markPx: string;
}

export interface PerpSource {
  apiUrl: string;
  perpIndex: number;
  coin: string;
  szDecimals: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** One `metaAndAssetCtxs` read. Throws if the asset at `perpIndex` is not `coin` with `szDecimals` (guards against a
 * re-indexed universe) or a price can't be represented exactly (pxToRaw). */
export async function fetchPerpPrices(s: PerpSource): Promise<PerpPrices> {
  const res = await (s.fetchFn ?? fetch)(s.apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal: AbortSignal.timeout(s.timeoutMs ?? 4_000),
  });
  if (!res.ok) throw new Error(`info API HTTP ${res.status}`);
  const body = (await res.json()) as [{ universe: Array<{ name: string; szDecimals: number }> }, Array<{ oraclePx: string; markPx: string }>];
  const asset = body?.[0]?.universe?.[s.perpIndex];
  const ctx = body?.[1]?.[s.perpIndex];
  if (!asset || !ctx) throw new Error(`perp index ${s.perpIndex} missing from metaAndAssetCtxs`);
  if (asset.name !== s.coin || asset.szDecimals !== s.szDecimals) {
    throw new Error(`perp index ${s.perpIndex} is ${asset.name}/szDecimals ${asset.szDecimals}, expected ${s.coin}/${s.szDecimals}`);
  }
  return { oracleRaw: pxToRaw(ctx.oraclePx, s.szDecimals), markRaw: pxToRaw(ctx.markPx, s.szDecimals), oraclePx: ctx.oraclePx, markPx: ctx.markPx };
}

export interface RelayLogEntry {
  t: string; // ISO time of the write
  block: string; // latest block when written; the values apply from the next block
  event: "price" | "fail-on" | "fail-off";
  oracleRaw?: string;
  markRaw?: string;
  oraclePx?: string;
  markPx?: string;
  reason?: string;
}

export interface RelayOptions {
  source: () => Promise<PerpPrices>;
  write: (oracleRaw: bigint, markRaw: bigint) => Promise<void>;
  setFailure: (on: boolean) => Promise<void>;
  blockNumber: () => Promise<bigint>;
  log?: (e: RelayLogEntry) => void;
  onError?: (e: unknown) => void;
  intervalMs?: number; // default 1000 (HyperEVM small-block time)
  staleMs?: number; // default 15000: the oracle updates about every 3 s (recon C.3)
  now?: () => number;
}

export interface RelayStatus {
  failing: boolean;
  writes: number;
  errors: number;
  lastOkMs: number;
  last?: PerpPrices;
}

export class PriceRelay {
  private readonly o: Required<Omit<RelayOptions, "log" | "onError">> & Pick<RelayOptions, "log" | "onError">;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private st: RelayStatus;

  constructor(opts: RelayOptions) {
    this.o = { intervalMs: 1_000, staleMs: 15_000, now: () => Date.now(), ...opts };
    this.st = { failing: false, writes: 0, errors: 0, lastOkMs: this.o.now() };
  }

  status(): RelayStatus {
    return { ...this.st };
  }

  /** One poll. Never throws. */
  async tick(): Promise<void> {
    let p: PerpPrices;
    try {
      p = await this.o.source();
    } catch (e) {
      this.st.errors++;
      this.o.onError?.(e);
      await this.checkStale(e);
      return;
    }
    try {
      const changed = !this.st.last || p.oracleRaw !== this.st.last.oracleRaw || p.markRaw !== this.st.last.markRaw;
      if (changed || this.st.failing) {
        const block = await this.o.blockNumber();
        await this.o.write(p.oracleRaw, p.markRaw); // fresh prices first, then re-enable reads
        this.st.writes++;
        this.st.last = p;
        this.o.log?.({ t: new Date(this.o.now()).toISOString(), block: block.toString(), event: "price", oracleRaw: p.oracleRaw.toString(), markRaw: p.markRaw.toString(), oraclePx: p.oraclePx, markPx: p.markPx });
        if (this.st.failing) {
          await this.o.setFailure(false);
          this.st.failing = false;
          this.o.log?.({ t: new Date(this.o.now()).toISOString(), block: (await this.o.blockNumber()).toString(), event: "fail-off" });
        }
      }
      this.st.lastOkMs = this.o.now();
    } catch (e) {
      this.st.errors++;
      this.o.onError?.(e);
      await this.checkStale(e);
    }
  }

  private async checkStale(cause: unknown): Promise<void> {
    if (this.st.failing || this.o.now() - this.st.lastOkMs <= this.o.staleMs) return;
    try {
      await this.o.setFailure(true);
      this.st.failing = true;
      this.o.log?.({ t: new Date(this.o.now()).toISOString(), block: (await this.o.blockNumber()).toString(), event: "fail-on", reason: String((cause as Error)?.message ?? cause).slice(0, 200) });
    } catch (e) {
      this.o.onError?.(e);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      const t0 = this.o.now();
      await this.tick();
      if (this.running) this.timer = setTimeout(loop, Math.max(0, this.o.intervalMs - (this.o.now() - t0)));
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
