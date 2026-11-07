"use client";
/**
 * On-chain record: every swap on both pools, read from HyperEVM logs (src/lib/onchain.ts), joined per block with the
 * HyperCore oracle and perp mark the hook logged (src/lib/ledger.ts), and on mainnet compared with Hyperliquid's own
 * API candles for the same minutes. No Arena, no database: close the Arena and this still fills.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { COLORS, Stat } from "@/components/dashboard/viz";
import { LineChart } from "@/components/LineChart";
import { Card, Empty, Src, TxLink } from "@/components/ui";
import { config, type Deployments } from "@/config";
import { useArena } from "@/lib/arena";
import { int, num, pipsPct, timeUtc, units } from "@/lib/format";
import { fetchCandleRange, type Candle } from "@/lib/hl";
import { ledgerRows, ledgerStats, type LedgerRow } from "@/lib/ledger";
import { LOG_CHUNK, useBlockTimes, useLedger, type ScanState } from "@/lib/onchain";

export function ScanBar({ s, what }: { s: ScanState<{ id: string; block: number }> | null; what: string }) {
  if (!s) return <p className="text-xs text-muted">Waiting for the deployment config…</p>;
  const total = s.head !== null ? s.head - s.start + 1 : null;
  const covered = s.from !== null && s.to !== null ? Math.max(0, s.to - s.from + 1) : 0;
  const pct = total ? Math.min(100, (covered / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className={`h-1.5 w-1.5 rounded-full ${s.busy ? "live-dot bg-aven-glow" : s.error ? "bg-warn" : "bg-aven"}`} />
          {s.busy ? "reading the chain…" : s.done ? "complete and following new blocks" : "backfilling history"}
        </span>
        <span className="num">
          {what}: blocks {s.from !== null && s.from <= (s.to ?? 0) ? `#${int(s.from)}` : "—"} → {s.to !== null ? `#${int(s.to)}` : "—"} of #{int(s.start)} → {s.head !== null ? `#${int(s.head)}` : "—"} ({pct.toFixed(pct < 10 ? 1 : 0)}%)
        </span>
        <span className="num">{int(s.items.length)} records</span>
        <span>eth_getLogs in {int(s.chunk)}-block chunks{s.chunk < LOG_CHUNK ? " (shrunk for a heavy stretch)" : ""} · cached in this browser</span>
        {s.truncated && <span className="text-warn">⚠ cache cap reached: older history not kept</span>}
        {s.error && <span className="text-warn">⚠ {s.error}{s.error.startsWith("RPC busy") ? "" : " (retrying)"}</span>}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-aven transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const sgn = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)}`;
const gapPair = (a: number | null, b: number | null) => (a === null && b === null ? "—" : `${a === null ? "—" : sgn(a)} → ${b === null ? "—" : sgn(b)} bp`);

export function swapLabel(r: LedgerRow, d: Deployments): { inA: string; outA: string } {
  const c = d.config;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  const b = `${units(r.v.baseAmt, baseDec, 4)} ${d.tokens.baseSymbol}`;
  const q = `${units(r.v.quoteAmt, quoteDec, 2)} ${d.tokens.quoteSymbol}`;
  return r.v.dir === "buyBase" ? { inA: q, outA: b } : { inA: b, outA: q };
}

function ProofCell({ r }: { r: LedgerRow }) {
  if (!r.e.verify) return <span className="text-faint">static</span>;
  const ok = r.e.verify.a && r.e.verify.b;
  return (
    <span className={ok ? "text-[#4cd44c]" : "text-[#f08a8a]"} title={`A ${r.e.verify.a ? "✓" : "✕"} · B ${r.e.verify.b ? "✓" : "✕"}`}>
      {ok ? "✓ A+B" : `✕ ${r.e.verify.a ? "" : "A"}${r.e.verify.b ? "" : "B"}`}
    </span>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
}

export function LedgerTable({ rows, d, page = 20 }: { rows: LedgerRow[]; d: Deployments; page?: number }) {
  const [n, setN] = useState(page);
  const shown = rows.slice(0, n);
  const t = useBlockTimes(shown.map((r) => r.e.block));
  if (!rows.length) return <Empty>No swaps in the scanned range yet.</Empty>;
  return (
    <div>
      <div className="overflow-x-auto rounded-[20px] border border-line">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <caption className="sr-only">Every swap on both pools, newest first</caption>
          <thead className="bg-raised/60 text-muted">
            <tr>
              <Th>Block</Th>
              <Th>Time (UTC)</Th>
              <Th>Pool</Th>
              <Th>Side</Th>
              <Th>In → out</Th>
              <Th right>Pool before → after</Th>
              <Th right>Oracle 0x807</Th>
              <Th right>Mark 0x806</Th>
              <Th right>Premium</Th>
              <Th right>Gap before → after</Th>
              <Th right>Oracle Δ</Th>
              <Th right>Fee</Th>
              <Th>Proof</Th>
              <Th>Tx</Th>
            </tr>
          </thead>
          <tbody className="num text-ink-2">
            {shown.map((r) => {
              const io = swapLabel(r, d);
              const ts = t.get(r.e.block);
              return (
                <tr key={r.e.id} className="border-t border-line/60 hover:bg-raised/40">
                  <td className="px-3 py-2 text-ink">#{int(r.e.block)}</td>
                  <td className="px-3 py-2">{ts ? timeUtc(ts) : "…"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-sans">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: r.e.pool === "aven" ? COLORS.aven : COLORS.plain }} />
                    {r.e.pool === "aven" ? "Aven" : "Plain"}
                  </td>
                  <td className="px-3 py-2 font-sans">{r.v.dir === "buyBase" ? "buy" : "sell"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {io.inA} → {io.outA}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.priceBefore !== null ? num(r.priceBefore, 2) : "—"} → {num(r.v.priceAfter, 2)}
                  </td>
                  <td className="px-3 py-2 text-right" title={r.oracleFrom === "own" ? "logged by this swap (FeeComputed)" : r.oracleFrom ? `from the Aven swap in block #${r.oracleBlock}` : "no Aven swap nearby"}>
                    {r.v.oracle !== null ? `${num(r.v.oracle, 2)}${r.oracleFrom === "nearby" ? "≈" : ""}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{r.v.mark !== null ? `${num(r.v.mark, 2)}${r.oracleFrom === "nearby" ? "≈" : ""}` : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.v.premiumBps !== null ? `${sgn(r.v.premiumBps)} bp` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{gapPair(r.gapBefore, r.v.gapAfter)}</td>
                  <td className="px-3 py-2 text-right">{r.oracleMoveBps !== null && Math.abs(r.oracleMoveBps) >= 0.5 ? `${sgn(r.oracleMoveBps)} bp` : "·"}</td>
                  <td className="px-3 py-2 text-right text-ink">{pipsPct(r.e.fee)}</td>
                  <td className="px-3 py-2">
                    <ProofCell r={r} />
                  </td>
                  <td className="px-3 py-2">
                    <TxLink hash={r.e.tx} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-faint">
        <span>
          Showing {int(shown.length)} of {int(rows.length)} swaps. Price before from the swap&apos;s own event (Aven) or the previous swap on that pool. Oracle on a plain swap comes from the Aven swap in the same block, or ≈ within 3 blocks.
          &quot;Oracle Δ&quot; is the move since the previous Aven swap: the price bump that swap answered.
        </span>
        {n < rows.length && (
          <button onClick={() => setN((x) => x + page)} className="btn btn-ghost btn-sm ml-auto">
            Show {Math.min(page, rows.length - n)} more
          </button>
        )}
      </div>
    </div>
  );
}

/** Hyperliquid's 1m candles for the minutes the swaps span (mainnet only: local and testnet prices are not HL's). */
function useHlCompare(rows: LedgerRow[]): { candles: Candle[] | null; t0: number | null; t1: number | null; note: string } {
  const aven = rows.filter((r) => r.e.fc);
  const first = aven[aven.length - 1]?.e.block ?? null;
  const last = aven[0]?.e.block ?? null;
  const times = useBlockTimes(first !== null && last !== null ? [first, last] : []);
  const t0 = first !== null ? (times.get(first) ?? null) : null;
  const t1 = last !== null ? (times.get(last) ?? null) : null;
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const live = config.chainId === 999;
  const key = `${t0}-${Math.floor((t1 ?? 0) / 60_000)}`;
  useEffect(() => {
    if (!live || t0 === null || t1 === null) return;
    const ctl = new AbortController();
    fetchCandleRange(config.hlCoin, "1m", t0 - 60_000, t1 + 60_000, ctl.signal)
      .then(setCandles)
      .catch(() => setCandles(null));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);
  return { candles: live ? candles : null, t0, t1, note: live ? "" : "Hyperliquid API comparison runs on mainnet only: this chain's oracle and mark are mock or testnet values." };
}

export function OnchainRecord() {
  const a = useArena();
  const d = a.math;
  const s = useLedger(d);
  const rows = useMemo(() => (s && d ? ledgerRows(s.items, d) : []), [s, d]);
  const st = useMemo(() => (s ? ledgerStats(s.items, rows) : null), [s, rows]);
  const hl = useHlCompare(rows);

  // Chart: the last 300 Aven swaps in block order, with HL's 1m close at the interpolated time of each block.
  const aven = rows.filter((r) => r.e.fc).slice(0, 300).reverse();
  const timeOf = (b: number) => {
    const f = aven[0]?.e.block;
    const l = aven[aven.length - 1]?.e.block;
    if (hl.t0 === null || hl.t1 === null || f === undefined || l === undefined) return null;
    return l === f ? hl.t0 : hl.t0 + ((b - f) / (l - f)) * (hl.t1 - hl.t0);
  };
  const candleAt = (b: number) => {
    const t = timeOf(b);
    if (t === null || !hl.candles) return null;
    const m = Math.floor(t / 60_000) * 60;
    return hl.candles.find((c) => c.time === m) ?? null;
  };
  const inRange = hl.candles ? aven.filter((r) => {
    const c = candleAt(r.e.block);
    return c && r.v.mark !== null && r.v.mark >= c.low * 0.9995 && r.v.mark <= c.high * 1.0005;
  }).length : null;
  const withCandle = hl.candles ? aven.filter((r) => candleAt(r.e.block)).length : null;

  if (!d) return <Empty>Waiting for the deployment config…</Empty>;
  return (
    <div className="space-y-6">
      <Card data-reveal>
        <ScanBar s={s} what="Pools" />
      </Card>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Swaps on chain · Aven" value={st ? st.swaps.aven : null} format={(v) => int(v)} sub={st ? `${int(st.swaps.control)} on the plain pool · ${int(st.liquidity)} liquidity changes` : undefined} src="PoolManager Swap events" />
        <Stat
          label="Aven swaps verified in this browser"
          value={st && st.avenVerified ? (st.avenOk / st.avenVerified) * 100 : null}
          format={(v) => `${v.toFixed(0)}%`}
          sub={st ? `${int(st.avenOk)} of ${int(st.avenVerified)}: A (formula) and B (charged)` : undefined}
          src="@aven/core verifyLogs on each tx's logs"
        />
        <Stat label="Price bumps answered" value={st ? st.oracleMoves : null} format={(v) => int(v)} sub="Aven swaps that met a new HyperCore oracle and priced it in their own block" src="FeeComputed.oracleRaw, swap to swap" />
        <Stat
          label="Perp mark inside Hyperliquid's 1-min range"
          value={inRange !== null && withCandle ? (inRange / withCandle) * 100 : null}
          format={(v) => `${v.toFixed(0)}%`}
          sub={inRange !== null && withCandle ? `${int(inRange)} of ${int(withCandle)} Aven swaps vs the Hyperliquid API` : hl.note || "loading Hyperliquid candles…"}
          src="FeeComputed.markRaw vs candleSnapshot 1m"
        />
      </div>
      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">What each Aven swap met, block by block</p>
        <p className="mb-4 text-xs text-muted">
          From the chain: the pool price before the swap and the HyperCore oracle and perp mark the hook read in that block.
          {config.chainId === 999 ? " Plus Hyperliquid's own API, the 1-minute close at that block's time (interpolated between the first and last block's timestamps)." : ""}
        </p>
        {aven.length < 2 ? (
          <Empty>Needs two Aven swaps in the scanned range.</Empty>
        ) : (
          <LineChart
            xs={aven.map((r) => r.e.block)}
            series={[
              { id: "pool", label: "Aven pool, before", color: COLORS.aven, values: aven.map((r) => r.priceBefore) },
              { id: "oracle", label: "Oracle 0x807", color: "var(--color-ink-2)", dashed: true, values: aven.map((r) => r.v.oracle) },
              { id: "mark", label: "Perp mark 0x806", color: COLORS.premium, values: aven.map((r) => r.v.mark) },
              ...(hl.candles ? [{ id: "hl", label: "Hyperliquid API 1m", color: COLORS.stress, values: aven.map((r) => candleAt(r.e.block)?.close ?? null) }] : []),
            ]}
            height={300}
            yFormat={(v) => `$${num(v, 2)}`}
            xFormat={(b) => `#${int(b)}`}
            ariaLabel="Pool price, oracle and mark at each on-chain Aven swap"
            yLabel="USD"
          />
        )}
        <div className="mt-3">
          <Src>eth_getLogs (Swap, FeeComputed) · {config.chainId === 999 ? "api.hyperliquid.xyz candleSnapshot" : "no external price on this chain"}</Src>
        </div>
      </Card>
      <LedgerTable rows={rows} d={d} />
      <p className="text-[11px] text-faint">
        Gap = (price − oracle) / oracle. Every swap on both pools, by anyone: the Arena bot, shocks, and wallets swapping on the site.
      </p>
    </div>
  );
}
