"use client";
/**
 * Live dashboard sections. Every number comes from the Arena stream (/state per block, trades, shocks, /stats), from
 * a transaction receipt, or from the replay files, and says which. Blocks are the exact unit; ms are Arena server time.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LineChart, type Marker } from "@/components/LineChart";
import { useReveal } from "@/components/motion";
import { Card, Empty, MatchBadge, Notice, SectionHead, Src, TermChip, TxLink } from "@/components/ui";
import type { Deployments } from "@/config";
import { useArena, type HistoryPoint } from "@/lib/arena";
import { publicClient } from "@/lib/chain";
import {
  FEE_BINS,
  PLAIN_FEE,
  arbDir,
  auditFees,
  blockIntervalMs,
  cumulative,
  expectedFee,
  feeHistogram,
  feeParts,
  flows,
  otherDir,
  quoteOf,
  volumeBuckets,
  type Episode,
} from "@/lib/dashboard";
import { bps, int, num, pipsPct, timeUtc, units, usd } from "@/lib/format";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { termsFired } from "@/lib/steps";
import type { Trade, VerifyResult } from "@/lib/types";
import { COLORS, Columns, Donut, Scatter, Stat } from "./viz";

// ------------------------------------------------------------------------------------------------ layout

export function Block({ id, eyebrow, title, lede, children }: { id?: string; eyebrow: string; title: string; lede?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref); // once; data-reveal only on wrappers that render from the first paint (see globals.css .js-motion)
  return (
    <section id={id} ref={ref} className="mx-auto max-w-7xl scroll-mt-28 px-6 py-14 md:py-20">
      <SectionHead eyebrow={eyebrow} title={title} lede={lede} />
      {children}
    </section>
  );
}

const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`);
const blocks = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} block${v === 1 ? "" : "s"}`);
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(0)}%` : "—");

/** Status chip: icon + label, never colour alone. */
function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const tone = ok === null ? "border-line text-muted" : ok ? "border-good/50 text-[#4cd44c]" : "border-crit/60 text-[#f08a8a]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      <span aria-hidden>{ok === null ? "…" : ok ? "✓" : "✕"}</span>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ live strip

export function LiveStrip({ history }: { history: HistoryPoint[] }) {
  const a = useArena();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const last = history[history.length - 1];
  const bi = blockIntervalMs(history.slice(-120));
  const lastTrade = a.trades[0];
  const flash = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      if (!flash.current) return;
      gsap.fromTo(flash.current, { opacity: 1, scale: 1.6 }, { opacity: 0, scale: 1, duration: 0.9, ease: "power2.out" });
    },
    { dependencies: [a.lastBlock] },
  );
  const items: Array<[string, ReactNode]> = [
    [
      "Block",
      <span key="b" className="relative inline-flex items-center gap-2">
        <span className="relative h-2 w-2">
          <span ref={flash} className="absolute inset-0 rounded-full bg-aven-glow" />
          <span className="absolute inset-0 rounded-full bg-aven" />
        </span>
        <span className="num">{a.lastBlock ? `#${int(a.lastBlock)}` : "—"}</span>
      </span>,
    ],
    ["Block time", <span key="t" className="num">{bi ? `${num(bi / 1000, 2)} s` : "—"}</span>],
    ["Arena saw it", <span key="s" className="num">{a.state ? `${ms(Math.max(0, now - a.state.ts))} ago` : "—"}</span>],
    ["Feed", <span key="f">{a.mode === "RECORDED" ? "recording" : a.streaming ? "SSE stream" : "polling"}</span>],
    ["Bot", <span key="o">{a.bot ? (a.bot.enabled ? "running" : "idle") : "—"}</span>],
    ["Last trade", <span key="l" className="num">{lastTrade ? `${lastTrade.pool === "aven" ? "Aven" : "Plain"} · ${pipsPct(lastTrade.feePips)} · ${timeUtc(lastTrade.ts)}` : "—"}</span>],
    ["Oracle", <span key="o2" className="num">{last ? `$${num(last.oracle, 2)}` : "—"}</span>],
  ];
  return (
    <div data-reveal className="panel flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-faint">{k}</p>
          <div className="mt-1 text-sm text-ink">{v}</div>
        </div>
      ))}
      {a.note && <p className="w-full text-[11px] text-warn">⚠ {a.note}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ headline

export function Headline() {
  const a = useArena();
  const p = a.math?.params;
  const audit = useMemo(() => (p ? auditFees(a.trades, p) : null), [a.trades, p]);
  const s = a.stats;
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="md:col-span-2 md:row-span-2">
        <Stat
          big
          className="h-full"
          label="LPs kept more on Aven than on the plain 0.30% pool"
          value={s ? s.lpKeptMoreUsd : null}
          format={(v) => usd(v)}
          sub={s ? <>Same shocks, same bot, since {timeUtc(s.since)} UTC. Bot profit {usd(s.aven.botProfitUsd)} on Aven vs {usd(s.control.botProfitUsd)} on plain.</> : "Waiting for Arena stats."}
          src="Arena /stats · arb (bot) trades · $ at the HyperCore oracle"
        />
      </div>
      <Stat label="LP fee income · Aven" value={s?.aven.lpFeeIncomeUsd ?? null} format={(v) => usd(v)} sub={s ? `${s.aven.trades} arb trades` : undefined} src="Arena /stats" />
      <Stat label="LP fee income · plain 0.30%" value={s?.control.lpFeeIncomeUsd ?? null} format={(v) => usd(v)} sub={s ? `${s.control.trades} arb trades` : undefined} src="Arena /stats" />
      <Stat
        label="Aven fees that match §6.3 exactly"
        value={audit && audit.avenTrades ? (audit.formulaMatch / audit.avenTrades) * 100 : null}
        format={(v) => `${v.toFixed(0)}%`}
        sub={audit ? `${int(audit.formulaMatch)} of ${int(audit.avenTrades)} Aven swaps` : undefined}
        src="recomputed here from each trade's inputs"
      />
      <Stat
        label="Verified on chain (A + B)"
        value={audit && audit.verified ? (audit.verifiedOk / audit.verified) * 100 : null}
        format={(v) => `${v.toFixed(0)}%`}
        sub={audit ? `${int(audit.verifiedOk)} of ${int(audit.verified)} checked by the Arena` : undefined}
        src="FeeComputed vs formula · PoolManager Swap event"
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ latency

function lanesRange(e: Episode): [number, number] {
  const tail = Math.max(6, e.aven.lastBlocks ?? 0, e.control.lastBlocks ?? 0, e.retailBase?.blocks ?? 0);
  return [e.block - 2, e.block + Math.min(22, tail + 1)];
}

/** Block-by-block lanes for one episode: when the price moved, when each fee answered, when each arb landed. */
export function BlockLanes({ e, history, d }: { e: Episode; history: HistoryPoint[]; d: Deployments }) {
  const [b0, b1] = lanesRange(e);
  const cols = Array.from({ length: b1 - b0 + 1 }, (_, i) => b0 + i);
  const byBlock = new Map(history.map((h) => [h.block, h]));
  const root = useRef<HTMLDivElement>(null);
  const max = d.params.maxFee;
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const cells = root.current?.querySelectorAll("[data-cell]");
        const ticks = root.current?.querySelectorAll("[data-tick]");
        if (cells?.length) gsap.fromTo(cells, { scaleY: 0 }, { scaleY: 1, transformOrigin: "50% 100%", duration: 0.7, ease: "expo.out", stagger: { each: 0.012, from: "start" }, clearProps: "transform" });
        if (ticks?.length) gsap.fromTo(ticks, { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(2.5)", stagger: 0.05, delay: 0.3, clearProps: "transform" });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [e.block, e.kind] },
  );
  const arbAt = (pool: "aven" | "control", b: number) => e[pool].arbs.filter((t) => t.block === b);
  const retailAt = (b: number) => [...e.aven.trades, ...e.control.trades].filter((t) => t.kind === "retail" && t.block === b);

  const lane = ({ label, sub, render }: { label: string; sub: string; render: (b: number, h: HistoryPoint | undefined) => ReactNode }) => (
    <>
      <div className="flex flex-col justify-center border-t border-line/60 py-2 pr-3">
        <p className="text-xs text-ink">{label}</p>
        <p className="text-[10px] text-faint">{sub}</p>
      </div>
      {cols.map((b) => (
        <div key={b} className={`relative flex h-14 items-end justify-center border-l border-t border-line/60 ${b === e.block ? "bg-mint/[0.04]" : ""}`}>
          {render(b, byBlock.get(b))}
        </div>
      ))}
    </>
  );
  const feeCell = ({ fee, color, mark }: { fee: number | null | undefined; color: string; mark?: string }) =>
    fee == null ? (
      <span className="mb-2 text-[9px] text-faint">·</span>
    ) : (
      <>
        <span data-cell className="w-[60%] max-w-[18px] rounded-t-[4px]" style={{ height: `${Math.max(3, (fee / max) * 44)}px`, background: color }} title={`${pipsPct(fee)}`} />
        {mark && <span className="num absolute left-1/2 top-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-bg/90 px-1.5 text-[9px] text-ink">{mark}</span>}
      </>
    );
  const arbDirAt = (h: HistoryPoint | undefined) => (h?.avenGap !== undefined ? arbDir(h.avenGap) : null);

  return (
    <div ref={root} className="overflow-x-auto">
      <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `168px repeat(${cols.length}, minmax(28px, 1fr))` }}>
        <div />
        {cols.map((b) => (
          <div key={b} className={`num pb-1.5 text-center text-[10px] ${b === e.block ? "text-mint" : "text-muted"}`}>
            {b === e.block ? "B" : b > e.block ? `+${b - e.block}` : b - e.block}
          </div>
        ))}
        {lane({ label: e.kind === "oracle" ? "HyperCore input" : "Shock swap", sub: e.kind === "oracle" ? "oracle 0x807 · mark 0x806" : "both pools pushed", render: (b) =>
            b === e.block ? (
              <span data-tick className="absolute bottom-2 left-1/2 z-10 flex h-6 -translate-x-1/2 items-center whitespace-nowrap rounded-full border border-mint/60 bg-bg px-2 text-[10px] font-medium text-mint">
                ◆ {e.label.replace("Shock · ", "shock · ")}
              </span>
            ) : retailAt(b).length && e.kind === "shock" ? (
              <span data-tick className="mb-3 h-2.5 w-2.5 rounded-full bg-ink" />
            ) : null
           })}
        {lane({ label: "Aven fee · arb side", sub: "AvenHook.previewFee, this block", render: (b, h) => {
            const dir = arbDirAt(h);
            const f = h && dir ? quoteOf(h, dir)?.fee : null;
            return feeCell({ fee: f, color: COLORS.aven, mark: b === e.block && f != null ? pipsPct(f) : undefined });
          } })}
        {lane({ label: "Plain fee", sub: "static 0.30%, never moves", render: (b, h) => feeCell({ fee: h ? PLAIN_FEE : null, color: COLORS.plain }) })}
        {lane({ label: "Aven fee · retail side", sub: "the direction that doesn't arb", render: (b, h) => {
            const dir = arbDirAt(h);
            const f = h && dir ? quoteOf(h, otherDir(dir))?.fee : null;
            const back = e.retailBase && b === e.block + e.retailBase.blocks;
            return feeCell({ fee: f, color: COLORS.base, mark: back ? "base" : undefined });
          } })}
        {lane({ label: "Arb landed · plain", sub: "bot swap mined", render: (b) =>
            arbAt("control", b).map((t) => (
              <span key={t.id} data-tick title={`${pipsPct(t.feePips)} · bot ${usd(t.botProfitUsd)}`} className="mb-3 h-3 w-3 rounded-full border-2 border-surface" style={{ background: COLORS.plain }} />
            ))
           })}
        {lane({ label: "Arb landed · Aven", sub: "bot swap mined", render: (b) =>
            arbAt("aven", b).map((t) => (
              <span key={t.id} data-tick title={`${pipsPct(t.feePips)} · bot ${usd(t.botProfitUsd)}`} className="mb-3 h-3 w-3 rounded-full border-2 border-surface" style={{ background: COLORS.aven }} />
            ))
           })}
      </div>
      <p className="mt-3 text-[11px] text-faint">
        Columns are HyperEVM blocks; B is the first block the Arena saw the move. Bar height = fee (top = the {pipsPct(max)} cap). Blank = no stream sample for that block.
      </p>
    </div>
  );
}

/** Milestones of one episode on the Arena clock, as a Gantt row each. */
function Milestones({ e, head }: { e: Episode; head: number | null }) {
  // Open = the newest episode and its Aven arbs are still landing (within 3 blocks of the newest block).
  const open = e.endBlock === null && head !== null && e.aven.last !== null && head - e.aven.last.block <= 3;
  const rows: Array<{ k: string; v: number | null; b: number | null; color: string; note: string }> = [
    {
      k: "Aven fee repriced",
      v: e.repriceMs,
      b: e.repriceBlocks,
      color: COLORS.aven,
      note:
        e.quotesBefore && e.quotesAt
          ? `buy ${e.quotesBefore.buy !== null ? pipsPct(e.quotesBefore.buy) : "—"} → ${e.quotesAt.buy !== null ? pipsPct(e.quotesAt.buy) : "—"} · sell ${e.quotesBefore.sell !== null ? pipsPct(e.quotesBefore.sell) : "—"} → ${e.quotesAt.sell !== null ? pipsPct(e.quotesAt.sell) : "—"}`
          : "",
    },
    { k: "Plain fee repriced", v: null, b: null, color: COLORS.plain, note: "never: static 0.30%" },
    { k: "First arb landed · plain", v: e.control.firstMs, b: e.control.firstBlocks, color: COLORS.plain, note: e.control.first ? `${pipsPct(e.control.first.feePips)} · bot ${usd(e.control.first.botProfitUsd)}` : "" },
    { k: "First arb landed · Aven", v: e.aven.firstMs, b: e.aven.firstBlocks, color: COLORS.aven, note: e.aven.first ? `${pipsPct(e.aven.first.feePips)} · bot ${usd(e.aven.first.botProfitUsd)}` : "" },
    { k: "Retail fee back to base", v: e.retailBase?.ms ?? null, b: e.retailBase?.blocks ?? null, color: COLORS.base, note: e.retailBase ? "no surcharge left" : "not yet" },
    {
      k: open ? "Latest Aven arb (still arbing)" : "Last Aven arb (stopped)",
      v: e.aven.lastMs,
      b: e.aven.lastBlocks,
      color: COLORS.aven,
      note: e.aven.gapLeft !== null && e.aven.last ? `gap left ${bps(Math.abs(e.aven.gapLeft))}${open ? "" : ": the fee now covers it"}` : "",
    },
  ];
  const tmax = Math.max(1000, ...rows.map((r) => r.v ?? 0));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.k} className="grid grid-cols-[150px_1fr_130px] items-center gap-3 text-xs">
          <span className="text-ink-2">{r.k}</span>
          <div className="relative h-5 rounded-full bg-raised/60">
            {r.v !== null ? (
              <span className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ width: `${Math.max(1.5, (r.v / tmax) * 100)}%`, background: r.color }} />
            ) : (
              <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-faint">{r.b === null && r.k.startsWith("Plain fee") ? "∞ — the static fee ignores the market" : "—"}</span>
            )}
            {r.v !== null && (
              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ left: `${Math.max(1.5, (r.v / tmax) * 100)}%`, background: r.color }} />
            )}
          </div>
          <span className="num text-right text-ink">
            {r.v !== null ? `${ms(r.v)} · ${blocks(r.b)}` : r.b !== null ? blocks(r.b) : "—"}
            {r.note && <span className="block text-[10px] text-faint">{r.note}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LatencyProof({ eps, history }: { eps: Episode[]; history: HistoryPoint[] }) {
  const a = useArena();
  const d = a.math;
  const [pick, setPick] = useState<number | null>(null); // null = follow the latest
  const e = pick !== null ? eps.find((x) => x.block === pick) ?? eps[eps.length - 1] : eps[eps.length - 1];
  const measured = eps.filter((x) => x.repriceBlocks !== null);
  const sameBlock = measured.filter((x) => x.repriceBlocks === 0).length;
  const recent = eps.slice(-10);
  const bi = blockIntervalMs(history.slice(-120));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          label="Aven fee reprices after a price move"
          value={measured.length ? 0 : null}
          format={() => (measured.length && sameBlock === measured.length ? "0 blocks" : measured.length ? `${sameBlock}/${measured.length} same block` : "—")}
          sub={measured.length ? `${sameBlock} of ${measured.length} moves and shocks: the quote changed in the first block the change was seen` : "Waiting for a price move or a shock."}
          src="measured on this stream"
        />
        <Stat label="Plain 0.30% pool reprices" value={0} format={() => "never"} sub="a static fee can't see the market" src="pool key fee 3000" />
        <Stat label="A 60 s-delayed oracle reprices" value={60} format={(v) => `${v.toFixed(0)} s`} sub={bi ? `≈ ${Math.round(60_000 / bi)} blocks at the measured ${num(bi / 1000, 2)} s block time` : "the delayed design in the replay"} src="Replay engine design (avenDelayed)" />
        <Stat label="Settlement latency the hook adds" value={0} format={() => "0 blocks"} sub="Aven and plain swaps land in the same block cadence; the hook costs gas, not time" src="see gas in the swap inspector" />
      </div>

      <Card data-reveal className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 text-sm font-medium text-ink">Price moves and shocks</p>
          {recent.length === 0 && <span className="text-xs text-muted">none yet in this window</span>}
          {recent.map((x) => (
            <button
              key={`${x.kind}${x.block}`}
              onClick={() => setPick(x.block)}
              className={`rounded-full border px-3 py-1 text-[11px] transition ${e?.block === x.block ? "border-mint/60 bg-mint/10 text-mint" : "border-line text-ink-2 hover:border-line-strong"}`}
            >
              #{int(x.block)} · {x.label}
            </button>
          ))}
          {pick !== null && (
            <button onClick={() => setPick(null)} className="ml-auto text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
              Follow live
            </button>
          )}
        </div>
        {e && d ? (
          <>
            <BlockLanes e={e} history={history} d={d} />
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <Milestones e={e} head={history[history.length - 1]?.block ?? null} />
              <div className="space-y-2 text-xs text-ink-2">
                <p>
                  <span className="text-ink">Why the fee is instant:</span> AvenHook reads the HyperCore oracle and mark precompiles inside <code className="num text-[11px]">beforeSwap</code>, in the swap&apos;s own block. There is no keeper and no push, so there is nothing to wait for.
                </p>
                <p>
                  <span className="text-ink">Why the Aven arb lands a block later:</span> the Arena bot is one wallet. It sends the plain-pool arb first and waits for its receipt, then the Aven arb. That is bot ordering, not hook latency.
                </p>
                <p className="text-faint">ms are on the Arena&apos;s clock (it reads each block, then sees each receipt). Blocks come from the chain.</p>
              </div>
            </div>
          </>
        ) : (
          <Empty>Move the price or fire a shock (operator controls below), then watch it here block by block.</Empty>
        )}
      </Card>

      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">Price move → first arb mined, per episode</p>
        <p className="mb-4 text-xs text-muted">Arena clock, ms. Each pair is one price move or shock. The fee itself answers in 0 blocks every time (above).</p>
        <Columns
          cats={recent.map((x) => `#${x.block}`)}
          series={[
            { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: recent.map((x) => x.control.firstMs ?? 0) },
            { id: "aven", label: "Aven", color: COLORS.aven, values: recent.map((x) => x.aven.firstMs ?? 0) },
          ]}
          format={(v) => ms(v)}
          axisFormat={(v) => (v >= 1000 ? `${v / 1000}s` : `${v}`)}
          ariaLabel="Milliseconds from a price move to the first arbitrage swap, per pool"
          yLabel="Episode"
        />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ market charts

export function MarketCharts({ history, eps }: { history: HistoryPoint[]; eps: Episode[] }) {
  const xs = history.map((h) => h.ts);
  const idx = new Map(history.map((h, i) => [h.block, i]));
  // Numbered event lines (full labels collide when moves are close); the key above the charts names each one.
  const shown = eps.filter((e) => idx.has(e.block));
  const markers: Marker[] = shown.map((e, n) => ({ i: idx.get(e.block)!, kind: "event" as const, label: `${n + 1}` }));
  const tooFew = history.length < 2;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div data-reveal className="flex min-h-7 flex-wrap items-center gap-2 text-[11px] text-ink-2 lg:col-span-2">
        <span className="text-muted">Events</span>
        {shown.length === 0 && <span className="text-faint">none in this window</span>}
        {shown.map((e, n) => (
          <span key={`${e.kind}${e.block}`} className="rounded-full border border-line px-2.5 py-1">
            <span className="text-warn">⚠ {n + 1}</span> · #{int(e.block)} · {e.label}
          </span>
        ))}
      </div>
      <Card data-reveal className="lg:col-span-2">
        <p className="mb-1 text-sm font-medium text-ink">Pool prices vs the HyperCore oracle</p>
        <p className="mb-4 text-xs text-muted">One sample per block from the Arena stream. A price move opens a gap; arbitrage closes it.</p>
        {tooFew ? (
          <Empty>Collecting blocks…</Empty>
        ) : (
          <LineChart
            xs={xs}
            series={[
              { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: history.map((h) => h.control) },
              { id: "aven", label: "Aven", color: COLORS.aven, values: history.map((h) => h.aven) },
              { id: "oracle", label: "Oracle", color: "var(--color-ink-2)", dashed: true, values: history.map((h) => h.oracle) },
            ]}
            markers={markers}
            height={300}
            yFormat={(v) => `$${num(v, 2)}`}
            xFormat={timeUtc}
            ariaLabel="Pool prices and the oracle over time"
            yLabel="USD"
          />
        )}
      </Card>
      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">Gap vs the oracle</p>
        <p className="mb-4 text-xs text-muted">bp, signed: below 0 = the pool is under the oracle (stale low).</p>
        {tooFew ? (
          <Empty>Collecting blocks…</Empty>
        ) : (
          <LineChart
            xs={xs}
            series={[
              { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: history.map((h) => h.controlGap ?? null) },
              { id: "aven", label: "Aven", color: COLORS.aven, values: history.map((h) => h.avenGap ?? null) },
            ]}
            markers={markers}
            baseline={0}
            height={260}
            yFormat={(v) => `${Math.round(v)} bp`}
            xFormat={timeUtc}
            ariaLabel="Gap between each pool and the oracle, in basis points"
            yLabel="bp"
          />
        )}
      </Card>
      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">Fee a swap would pay now</p>
        <p className="mb-4 text-xs text-muted">AvenHook.previewFee per direction (I6: equal to what beforeSwap charges) vs the static 0.30%.</p>
        {tooFew ? (
          <Empty>Collecting blocks…</Empty>
        ) : (
          <LineChart
            xs={xs}
            series={[
              { id: "plain", label: "Plain", color: COLORS.plain, values: history.map(() => PLAIN_FEE) },
              { id: "buy", label: "Aven · buy", color: COLORS.aven, values: history.map((h) => h.avenBuy?.fee ?? null) },
              { id: "sell", label: "Aven · sell", color: COLORS.aven, dashed: true, values: history.map((h) => h.avenSell?.fee ?? null) },
            ]}
            markers={markers}
            height={260}
            yFormat={(v) => pipsPct(v)}
            xFormat={timeUtc}
            ariaLabel="Fee quote per direction on the Aven pool vs the plain pool"
            yLabel="fee"
          />
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ swap inspector

function nearestBefore(history: HistoryPoint[], block: number): HistoryPoint | undefined {
  for (let i = history.length - 1; i >= 0; i--) if (history[i]!.block < block) return history[i];
  return undefined;
}
function atOrAfter(history: HistoryPoint[], block: number): HistoryPoint | undefined {
  return history.find((h) => h.block >= block);
}

function Waterfall({ t, d }: { t: Trade; d: Deployments }) {
  const p = d.params;
  if (!t.breakdown) return <p className="text-xs text-muted">No fee breakdown on this trade.</p>;
  const parts = feeParts(t.breakdown, p);
  const raw = parts.raw;
  const scale = Math.max(p.maxFee, raw, PLAIN_FEE) * 1.04;
  const segs = [
    { k: "base", v: parts.base, c: COLORS.base, label: "base" },
    { k: "gap", v: parts.gap, c: COLORS.gap, label: "gap" },
    { k: "premium", v: parts.premium, c: COLORS.premium, label: "premium" },
    { k: "stress", v: parts.stress, c: COLORS.stress, label: "stress" },
  ].filter((s) => s.v > 0);
  const W = (v: number) => `${(v / scale) * 100}%`;
  return (
    <div>
      <div className="relative h-7">
        <div className="absolute inset-0 rounded-[6px] bg-raised/70" />
        <div className="absolute inset-0 flex gap-[2px]">
          {segs.map((s) => (
            <div key={s.k} className="h-7 rounded-[4px]" style={{ width: W(s.v), background: s.c }} title={`${s.label}: ${pipsPct(s.v)}`}>
              {s.v / scale > 0.09 && <span className="num block truncate px-1.5 text-[10px] leading-7 text-white">{pipsPct(s.v)}</span>}
            </div>
          ))}
        </div>
        {parts.regime === "capped" && <div className="absolute inset-y-0 rounded-r-[4px] border border-dashed border-line-strong" style={{ left: W(p.maxFee), width: W(raw - p.maxFee) }} title={`cut by the cap: ${pipsPct(raw - p.maxFee)}`} />}
        <div className="absolute -top-1 bottom-[-4px] w-px bg-[var(--color-plain)]" style={{ left: W(PLAIN_FEE) }} />
        <div className="absolute -top-1 bottom-[-4px] w-px bg-ink-2" style={{ left: W(p.maxFee) }} />
      </div>
      <div className="relative mt-1.5 h-4 text-[10px] text-muted">
        <span className="absolute -translate-x-1/2" style={{ left: W(PLAIN_FEE) }}>
          plain 0.30%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: W(p.maxFee) }}>
          cap {pipsPct(p.maxFee)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        {segs.map((s) => (
          <span key={s.k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.c }} />
            {s.label} {pipsPct(s.v)}
          </span>
        ))}
        {parts.regime === "capped" && <span className="text-muted">⌐ {pipsPct(raw - p.maxFee)} cut by the cap</span>}
        <span className="ml-auto num text-ink">= {pipsPct(t.feePips)} charged</span>
      </div>
    </div>
  );
}

function Snapshot({ title, h, dir, tone, pending }: { title: string; h: HistoryPoint | undefined; dir: Trade["direction"]; tone: string; pending?: boolean }) {
  const q = h ? quoteOf(h, dir) : null;
  return (
    <div className="rounded-[20px] border border-line bg-surface/70 p-4">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
        {title}
      </p>
      {h ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted">Block</dt>
          <dd className="num text-right text-ink">#{int(h.block)}</dd>
          <dt className="text-muted">Oracle</dt>
          <dd className="num text-right text-ink">${num(h.oracle, 2)}</dd>
          <dt className="text-muted">Aven pool</dt>
          <dd className="num text-right text-ink">${num(h.aven, 2)}</dd>
          <dt className="text-muted">Gap</dt>
          <dd className={`num text-right ${Math.abs(h.avenGap ?? 0) >= 30 ? "text-warn" : "text-ink"}`}>{h.avenGap !== undefined ? bps(h.avenGap) : "—"}</dd>
          <dt className="text-muted">Quote, this side</dt>
          <dd className="num text-right text-ink">{q ? pipsPct(q.fee) : "—"}</dd>
        </dl>
      ) : (
        <p className="text-xs text-muted">{pending ? "Waiting for the next block…" : "Not in this tab's stream (the trade is older than the page)."}</p>
      )}
    </div>
  );
}

const gasCache = new Map<string, bigint | null>();
function useGas(hashes: string[]): Record<string, bigint | null> {
  const [, bump] = useState(0);
  const key = hashes.join(",");
  useEffect(() => {
    let alive = true;
    for (const h of hashes) {
      if (gasCache.has(h)) continue;
      gasCache.set(h, null);
      publicClient()
        .getTransactionReceipt({ hash: h as `0x${string}` })
        .then((r) => gasCache.set(h, r.gasUsed))
        .catch(() => gasCache.delete(h))
        .finally(() => alive && bump((n) => n + 1));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return Object.fromEntries(hashes.map((h) => [h, gasCache.get(h) ?? null]));
}

export function SwapInspector({ history, eps }: { history: HistoryPoint[]; eps: Episode[] }) {
  const a = useArena();
  const d = a.math;
  const aven = useMemo(() => a.trades.filter((t) => t.pool === "aven").slice(0, 40), [a.trades]);
  const [pinned, setPinned] = useState<string | null>(null);
  const t = (pinned ? aven.find((x) => x.id === pinned) : null) ?? aven.find((x) => x.kind === "arb") ?? aven[0] ?? null;
  const ep = t ? eps.find((e) => t.block >= e.block && (e.endBlock === null || t.block < e.endBlock)) : undefined;
  const twin = t ? (ep?.control.arbs[0] ?? a.trades.find((x) => x.pool === "control" && x.kind === t.kind && Math.abs(x.block - t.block) <= 3)) : undefined;
  const gas = useGas([t?.txHash, twin?.txHash].filter(Boolean) as string[]);
  const [v, setV] = useState<{ tx: string; r?: VerifyResult; err?: string } | null>(null);

  if (!d) return <Empty>Waiting for the deployment config…</Empty>;
  if (!t) return <Empty>No Aven swaps yet. Fire a shock or move the price; the first swap appears here.</Empty>;
  const before = nearestBefore(history, t.block);
  const after = atOrAfter(history, t.block);
  const baseDec = d.config.baseIsToken0 ? d.config.decimals0 : d.config.decimals1;
  const quoteDec = d.config.baseIsToken0 ? d.config.decimals1 : d.config.decimals0;
  const io =
    t.direction === "buyBase"
      ? { inA: `${units(t.amountIn.replace("-", ""), quoteDec, 2)} ${d.tokens.quoteSymbol}`, outA: `${units(t.amountOut.replace("-", ""), baseDec, 4)} ${d.tokens.baseSymbol}` }
      : { inA: `${units(t.amountIn.replace("-", ""), baseDec, 4)} ${d.tokens.baseSymbol}`, outA: `${units(t.amountOut.replace("-", ""), quoteDec, 2)} ${d.tokens.quoteSymbol}` };
  const exp = t.breakdown ? expectedFee(t.breakdown, d.params) : null;
  const g = gas[t.txHash];
  const g2 = twin ? gas[twin.txHash] : null;
  const run = async () => {
    setV({ tx: t.txHash });
    try {
      setV({ tx: t.txHash, r: await a.verify(t.txHash) });
    } catch (e) {
      setV({ tx: t.txHash, err: (e as Error).message });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <Card data-reveal className="max-h-[640px] overflow-auto p-3">
        <div className="mb-2 flex items-center justify-between px-2 pt-1">
          <p className="text-xs font-medium text-ink">Aven swaps</p>
          {pinned ? (
            <button onClick={() => setPinned(null)} className="text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
              Follow live
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-aven-glow">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />
              following
            </span>
          )}
        </div>
        <ul className="space-y-1">
          {aven.map((x) => (
            <li key={x.id}>
              <button
                onClick={() => setPinned(x.id)}
                className={`grid w-full grid-cols-[1fr_auto] gap-1 rounded-xl px-3 py-2 text-left text-xs transition ${x.id === t.id ? "bg-raised" : "hover:bg-raised/60"}`}
              >
                <span className="text-ink">
                  {x.kind === "arb" ? "Arb" : "Retail"} · {x.direction === "buyBase" ? "buy" : "sell"}
                </span>
                <span className="num text-right text-ink">{pipsPct(x.feePips)}</span>
                <span className="num text-[10px] text-muted">
                  #{int(x.block)} · {timeUtc(x.ts)}
                </span>
                <span className="num text-right text-[10px] text-muted">gap {x.breakdown ? bps(x.breakdown.gapBps) : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-5">
        <Card data-reveal className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-ink">
              {t.kind === "arb" ? "Arbitrage" : "Retail"} {t.direction === "buyBase" ? "buy" : "sell"} on the Aven pool
            </p>
            <span className="num text-xs text-muted">
              block #{int(t.block)} · {timeUtc(t.ts)} UTC
            </span>
            <span className="ml-auto">
              <TxLink hash={t.txHash} />
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Snapshot title="Before · stale" h={before} dir={t.direction} tone={COLORS.plain} />
            <div className="rounded-[20px] border border-mint/30 bg-mint/[0.04] p-4">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-mint">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                The swap
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted">In</dt>
                <dd className="num text-right text-ink">{io.inA}</dd>
                <dt className="text-muted">Out</dt>
                <dd className="num text-right text-ink">{io.outA}</dd>
                <dt className="text-muted">Fee charged</dt>
                <dd className="num text-right text-ink">
                  {pipsPct(t.feePips)} · {usd(t.feeUsd)}
                </dd>
                <dt className="text-muted">Gap the hook saw</dt>
                <dd className="num text-right text-ink">{t.breakdown ? bps(t.breakdown.gapBps) : "—"}</dd>
                <dt className="text-muted">Bot profit</dt>
                <dd className="num text-right text-ink">{usd(t.botProfitUsd)}</dd>
              </dl>
            </div>
            <Snapshot title="After · repriced" h={after} dir={t.direction} tone={COLORS.aven} pending={!after && (history[history.length - 1]?.block ?? 0) <= t.block} />
          </div>
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="mr-1 text-xs font-medium text-ink">How the hook built this fee</p>
              {t.breakdown && termsFired(t.breakdown, d.params.stressThresholdBps).map((x) => <TermChip key={x} term={x} />)}
            </div>
            <Waterfall t={t} d={d} />
          </div>
        </Card>

        <div className="grid gap-5 md:grid-cols-3">
          <Card data-reveal className="space-y-3">
            <p className="text-xs font-medium text-ink">Proof</p>
            <div className="flex flex-wrap gap-2">
              <Check ok={exp === null ? null : exp === t.feePips}>§6.3 on its inputs = {exp !== null ? pipsPct(exp) : "—"}</Check>
              <Check ok={t.verify ? t.verify.checkA : null}>A · fee = formula(event)</Check>
              <Check ok={t.verify ? t.verify.checkB : null}>B · PoolManager charged it</Check>
            </div>
            {v?.tx === t.txHash && v.r && (
              <div className="flex items-center gap-2 text-xs text-ink-2">
                <MatchBadge ok={v.r.match} /> on-chain {int(v.r.onchainFee)} · recomputed {int(v.r.recomputedFee)} · Swap event {int(v.r.swapEventFee)}
              </div>
            )}
            {v?.tx === t.txHash && v.err && <p className="text-xs text-warn">⚠ {v.err}</p>}
            <div className="flex flex-wrap gap-3 text-[11px]">
              <button onClick={run} className="btn btn-ghost btn-sm">
                {v?.tx === t.txHash && !v.r && !v.err ? "Verifying…" : "Re-verify now"}
              </button>
              <Link href={`/verify/${t.txHash}`} className="self-center text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
                Full step-by-step proof →
              </Link>
            </div>
          </Card>
          <Card data-reveal className="space-y-2">
            <p className="text-xs font-medium text-ink">Same move on the plain pool</p>
            {twin ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted">Fee</dt>
                <dd className="num text-right text-ink">{pipsPct(twin.feePips)} (fixed)</dd>
                <dt className="text-muted">LP fee</dt>
                <dd className="num text-right text-ink">{usd(twin.lpFeeIncomeUsd)}</dd>
                <dt className="text-muted">Bot profit</dt>
                <dd className="num text-right text-ink">{usd(twin.botProfitUsd)}</dd>
                <dt className="text-muted">Block</dt>
                <dd className="num text-right text-ink">#{int(twin.block)}</dd>
              </dl>
            ) : (
              <p className="text-xs text-muted">No plain-pool counterpart near this block.</p>
            )}
          </Card>
          <Card data-reveal className="space-y-2">
            <p className="text-xs font-medium text-ink">Cost of the hook</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted">Gas · this Aven swap</dt>
              <dd className="num text-right text-ink">{g ? int(g) : "…"}</dd>
              <dt className="text-muted">Gas · plain twin</dt>
              <dd className="num text-right text-ink">{g2 ? int(g2) : twin ? "…" : "—"}</dd>
              <dt className="text-muted">Hook overhead</dt>
              <dd className="num text-right text-ink">{g && g2 ? `${g > g2 ? "+" : ""}${int(g - g2)} gas` : "—"}</dd>
              <dt className="text-muted">Extra blocks</dt>
              <dd className="num text-right text-ink">0</dd>
            </dl>
            <Src>transaction receipts (gasUsed), RPC</Src>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ no extra fee

export function NoExtraFee({ trades, eps, history }: { trades: Trade[]; eps: Episode[]; history: HistoryPoint[] }) {
  const a = useArena();
  const d = a.math;
  if (!d) return <Empty>Waiting for the deployment config…</Empty>;
  const p = d.params;
  const audit = auditFees(trades, p);
  const last = history[history.length - 1];
  const dir = last?.avenGap !== undefined ? arbDir(last.avenGap) : null;
  const arbQ = last && dir ? quoteOf(last, dir) : null;
  const retQ = last && dir ? quoteOf(last, otherDir(dir)) : null;
  const settled = eps.filter((e) => e.retailBase);
  const avenPts = trades.filter((t) => t.pool === "aven" && t.breakdown && t.breakdown.reason === "OK");
  // x = the gap the fee was charged for: the pool's gap on the arb side, 0 on the retail side (no gap term).
  const charged = (t: Trade) => (t.breakdown!.arb ? Math.abs(t.breakdown!.gapBps) : 0);
  const gapOnly = avenPts.filter((t) => !t.breakdown!.withPressure && t.breakdown!.moveBps <= p.stressThresholdBps);
  const withMore = avenPts.filter((t) => !gapOnly.includes(t));
  const plainPts = trades.filter((t) => t.pool === "control");
  const plainGap = (t: Trade) => {
    const h = nearestBefore(history, t.block);
    return h?.controlGap !== undefined ? Math.abs(h.controlGap) : null;
  };
  const maxGap = Math.max(200, ...avenPts.map(charged));
  const capGap = (p.maxFee - p.baseFee) / p.gapWeight;
  const line: Array<[number, number]> = [
    [0, p.baseFee],
    [Math.min(capGap, maxGap), Math.min(p.maxFee, p.baseFee + Math.min(capGap, maxGap) * p.gapWeight)],
    ...(maxGap > capGap ? ([[maxGap, p.maxFee]] as Array<[number, number]>) : []),
  ];
  const tip = (t: Trade) =>
    `#${t.block} · ${t.kind} ${t.direction === "buyBase" ? "buy" : "sell"}${t.breakdown!.arb ? "" : ` (retail side: pool gap ${Math.abs(t.breakdown!.gapBps)} bp not charged)`} · premium ${t.breakdown?.premiumBps ?? 0} bp · stress ${t.breakdown?.moveBps ?? 0} bp`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-reveal className="space-y-4">
          <p className="text-sm font-medium text-ink">Checks over every Aven swap in this window</p>
          <ul className="space-y-3 text-xs text-ink-2">
            <li className="flex items-start gap-3">
              <Check ok={audit.avenTrades ? audit.formulaMatch === audit.avenTrades : null}>{pct(audit.formulaMatch, audit.avenTrades)}</Check>
              <span>
                Fee = base + gap·{p.gapWeight} + premium·{p.premiumWeight} + stress·{p.stressWeight}, clamped to [{pipsPct(p.minFee)}, {pipsPct(p.maxFee)}], on each swap&apos;s own inputs ({int(audit.formulaMatch)}/{int(audit.avenTrades)}).
                Every pip above the base comes from a live market term.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check ok={audit.noTerm ? audit.noTermAtBase === audit.noTerm : null}>{pct(audit.noTermAtBase, audit.noTerm)}</Check>
              <span>
                Swaps with no live term paid exactly the base {pipsPct(p.baseFee)} ({int(audit.noTermAtBase)}/{int(audit.noTerm)}). That&apos;s 6× cheaper than the plain pool, so there&apos;s no hidden surcharge.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check ok={audit.verified ? audit.verifiedOk === audit.verified : null}>{pct(audit.verifiedOk, audit.verified)}</Check>
              <span>On-chain verify: the FeeComputed inputs reproduce the fee (A) and the PoolManager charged that fee (B) ({int(audit.verifiedOk)}/{int(audit.verified)}).</span>
            </li>
            <li className="flex items-start gap-3">
              <Check ok={eps.length ? settled.length > 0 : null}>{settled.length}/{eps.length}</Check>
              <span>
                After a price move, the retail-side fee went back to the base in{" "}
                {settled.length ? settled.map((e) => ms(e.retailBase!.ms)).slice(-4).join(", ") : "—"}. Any lingering stress decays with the {p.stressTauSec} s mark anchor.
              </span>
            </li>
          </ul>
        </Card>
        <Card data-reveal className="space-y-4">
          <p className="text-sm font-medium text-ink">Right now</p>
          {last && arbQ && retQ ? (
            <div className="grid grid-cols-2 gap-4 text-xs">
              {[
                { k: "Closes the gap (arb side)", q: arbQ, d: dir! },
                { k: "Other side (retail)", q: retQ, d: otherDir(dir!) },
              ].map(({ k, q, d: dd }) => {
                const parts = feeParts(q, p);
                return (
                  <div key={k} className="rounded-[20px] border border-line bg-surface/70 p-4">
                    <p className="text-[11px] text-muted">{k}</p>
                    <p className="mt-1 text-[11px] text-faint">{dd === "buyBase" ? "buy" : "sell"} {d.tokens.baseSymbol}</p>
                    <p className="mt-3 text-2xl font-medium tracking-[-0.03em] text-ink">{pipsPct(q.fee)}</p>
                    <p className="mt-2">
                      {parts.regime === "base" ? (
                        <Check ok>base only, no surcharge</Check>
                      ) : (
                        <span className="text-ink-2">
                          base {pipsPct(parts.base)}
                          {parts.gap > 0 && ` + gap ${pipsPct(parts.gap)}`}
                          {parts.premium > 0 && ` + premium ${pipsPct(parts.premium)}`}
                          {parts.stress > 0 && ` + stress ${pipsPct(parts.stress)}`}
                        </span>
                      )}
                    </p>
                  </div>
                );
              })}
              <p className="col-span-2 text-[11px] text-faint">
                Gap now {bps(last.avenGap ?? 0)} at block #{int(last.block)}. The arb side pays for the open gap and nothing more. The retail side pays the base unless the mark is stressed.
              </p>
            </div>
          ) : (
            <Empty>Waiting for a live quote…</Empty>
          )}
        </Card>
      </div>
      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">Fee charged vs the gap it was charged for</p>
        <p className="mb-4 text-xs text-muted">
          Each dot is a swap. Aven dots sit on the formula line (base + {p.gapWeight}·gap, capped); dots above it also carry premium or stress. Retail-side swaps pay no gap term, so they sit at 0 on the base. The plain pool charges 0.30% whatever the gap.
        </p>
        <Scatter
          series={[
            { id: "gap", label: "Aven · gap only", color: COLORS.aven, points: gapOnly.map((t) => ({ x: charged(t), y: t.feePips, tip: tip(t) })) },
            { id: "more", label: "Aven · + premium or stress", color: COLORS.delayed, points: withMore.map((t) => ({ x: charged(t), y: t.feePips, tip: tip(t) })) },
            {
              id: "plain",
              label: "Plain 0.30%",
              color: COLORS.plain,
              points: plainPts.flatMap((t) => {
                const gg = plainGap(t);
                return gg === null ? [] : [{ x: gg, y: t.feePips, tip: `#${t.block} · ${t.kind} · gap before ${gg} bp` }];
              }),
            },
          ]}
          line={{ label: "§6.3 formula (gap only)", pts: line }}
          xFormat={(v) => `${Math.round(v)} bp`}
          yFormat={(v) => pipsPct(v)}
          xLabel="gap charged (Aven) · gap before the swap (plain)"
          yLabel="fee"
          ariaLabel="Fee charged against the price gap, per swap"
        />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ composition

export function Composition({ trades }: { trades: Trade[] }) {
  const a = useArena();
  const d = a.math;
  if (!d) return <Empty>Waiting for the deployment config…</Empty>;
  const p = d.params;
  // $ each term earned LPs: a trade's fee $ split by its terms (capped fees scaled to what was charged).
  const usdBy = { base: 0, gap: 0, premium: 0, stress: 0 };
  const regimes = { live: 0, capped: 0, base: 0, fallback: 0 };
  for (const t of trades) {
    if (t.pool !== "aven" || !t.breakdown || t.feePips <= 0) continue;
    const f = feeParts(t.breakdown, p);
    regimes[f.regime]++;
    if (f.regime === "fallback") continue;
    const k = t.feeUsd / t.feePips;
    usdBy.base += f.base * k;
    usdBy.gap += f.gap * k;
    usdBy.premium += f.premium * k;
    usdBy.stress += f.stress * k;
  }
  const hist = feeHistogram(trades);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-reveal>
          <p className="mb-1 text-sm font-medium text-ink">What Aven LPs were paid for</p>
          <p className="mb-5 text-xs text-muted">Fee $ by term, over every Aven swap in this window.</p>
          <Donut
            parts={[
              { id: "gap", label: "Gap: the stale price", value: usdBy.gap, color: COLORS.gap },
              { id: "premium", label: "Perp premium", value: usdBy.premium, color: COLORS.premium },
              { id: "base", label: "Base 0.05%", value: usdBy.base, color: COLORS.base },
              { id: "stress", label: "Mark stress", value: usdBy.stress, color: COLORS.stress },
            ]}
            format={(v) => usd(v)}
            centerLabel="LP fees, Aven"
            ariaLabel="Aven LP fee income split by fee term"
          />
        </Card>
        <Card data-reveal>
          <p className="mb-1 text-sm font-medium text-ink">How each Aven fee was set</p>
          <p className="mb-5 text-xs text-muted">Swaps by regime. Fallback means a precompile read failed, and the swap still went through (I1).</p>
          <Donut
            parts={[
              { id: "live", label: "Priced by live terms", value: regimes.live, color: COLORS.gap },
              { id: "capped", label: `Hit the ${pipsPct(p.maxFee)} cap`, value: regimes.capped, color: COLORS.premium },
              { id: "base", label: "Base only (no surcharge)", value: regimes.base, color: COLORS.base },
              { id: "fallback", label: "Fallback 0.30%", value: regimes.fallback, color: COLORS.stress, icon: "⚠" },
            ]}
            format={(v) => int(v)}
            centerLabel="Aven swaps"
            ariaLabel="Aven swaps by fee regime"
          />
        </Card>
      </div>
      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">Fee per swap</p>
        <p className="mb-4 text-xs text-muted">Swaps per fee band. Plain always lands in 0.3%; Aven spreads with the market.</p>
        <Columns
          cats={FEE_BINS.map((b) => b.label)}
          series={[
            { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: hist.control },
            { id: "aven", label: "Aven", color: COLORS.aven, values: hist.aven },
          ]}
          format={(v) => `${int(v)} swaps`}
          axisFormat={(v) => int(v)}
          ariaLabel="Number of swaps per fee band, per pool"
          yLabel="Fee band"
        />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ throughput

export function Throughput({ trades, windowMs, now }: { trades: Trade[]; windowMs: number | null; now: number }) {
  const a = useArena();
  const d = a.math;
  const span = windowMs ?? Math.max(60_000, now - Math.min(now, ...trades.map((t) => t.ts)));
  const n = 15;
  const bucket = Math.max(5_000, Math.ceil(span / n / 5_000) * 5_000);
  const vb = volumeBuckets(trades, now, bucket, n);
  const cum = cumulative(trades);
  const fl = flows(trades);
  const baseDec = d ? (d.config.baseIsToken0 ? d.config.decimals0 : d.config.decimals1) : 18;
  const quoteDec = d ? (d.config.baseIsToken0 ? d.config.decimals1 : d.config.decimals0) : 6;
  const bs = d?.tokens.baseSymbol ?? "base";
  const qs = d?.tokens.quoteSymbol ?? "quote";
  return (
    <div className="space-y-6">
      <Card data-reveal>
        <p className="mb-1 text-sm font-medium text-ink">Volume through each pool</p>
        <p className="mb-4 text-xs text-muted">$ of swap input per {bucket >= 60_000 ? `${bucket / 60_000} min` : `${bucket / 1000} s`}, valued at the oracle. Arb and retail swaps.</p>
        <Columns
          cats={vb.starts.map((s) => timeUtc(s).slice(0, bucket >= 60_000 ? 5 : 8))}
          series={[
            { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: vb.control },
            { id: "aven", label: "Aven", color: COLORS.aven, values: vb.aven },
          ]}
          format={(v) => usd(v, 0)}
          axisFormat={(v) => (v >= 1000 ? `$${v / 1000}K` : `$${v}`)}
          ariaLabel="Swap volume per time bucket, per pool"
          yLabel="Time"
        />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-reveal>
          <p className="mb-1 text-sm font-medium text-ink">LP fee income, running total</p>
          <p className="mb-4 text-xs text-muted">Arb trades, in order. $ at the oracle.</p>
          {cum.xs.length < 2 ? (
            <Empty>Needs two arb trades.</Empty>
          ) : (
            <LineChart
              xs={cum.xs}
              series={[
                { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: cum.lp.control },
                { id: "aven", label: "Aven", color: COLORS.aven, values: cum.lp.aven },
              ]}
              height={240}
              yFormat={(v) => usd(v, 0)}
              xFormat={timeUtc}
              ariaLabel="Cumulative LP fee income per pool"
              yLabel="$"
            />
          )}
        </Card>
        <Card data-reveal>
          <p className="mb-1 text-sm font-medium text-ink">Arbitrage bot profit, running total</p>
          <p className="mb-4 text-xs text-muted">What the stale price paid out to the bot. Lower is better for LPs.</p>
          {cum.xs.length < 2 ? (
            <Empty>Needs two arb trades.</Empty>
          ) : (
            <LineChart
              xs={cum.xs}
              series={[
                { id: "control", label: "Plain 0.30%", color: COLORS.plain, values: cum.bot.control },
                { id: "aven", label: "Aven", color: COLORS.aven, values: cum.bot.aven },
              ]}
              height={240}
              yFormat={(v) => usd(v, 0)}
              xFormat={timeUtc}
              ariaLabel="Cumulative arbitrage bot profit per pool"
              yLabel="$"
            />
          )}
        </Card>
      </div>
      <Card data-reveal className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-xs">
          <caption className="px-6 pb-2 pt-5 text-left text-sm font-medium text-ink">In and out of each pool</caption>
          <thead className="text-muted">
            <tr className="border-b border-line">
              {["Pool", "Swaps", "arb / retail", `${qs} in`, `${qs} out`, `${bs} in`, `${bs} out`, "Volume", "Fees"].map((h) => (
                <th key={h} className="px-6 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num text-ink-2">
            {(["aven", "control"] as const).map((k) => {
              const f = fl[k];
              return (
                <tr key={k} className="border-b border-line/60 last:border-0">
                  <td className="px-6 py-3 font-sans text-ink">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: k === "aven" ? COLORS.aven : COLORS.plain }} />
                    {k === "aven" ? "Aven" : "Plain 0.30%"}
                  </td>
                  <td className="px-6 py-3">{int(f.trades)}</td>
                  <td className="px-6 py-3">
                    {int(f.arbs)} / {int(f.retail)}
                  </td>
                  <td className="px-6 py-3">{units(f.quoteIn, quoteDec, 0)}</td>
                  <td className="px-6 py-3">{units(f.quoteOut, quoteDec, 0)}</td>
                  <td className="px-6 py-3">{units(f.baseIn, baseDec, 3)}</td>
                  <td className="px-6 py-3">{units(f.baseOut, baseDec, 3)}</td>
                  <td className="px-6 py-3">{usd(f.volumeUsd, 0)}</td>
                  <td className="px-6 py-3 text-ink">{usd(f.feesUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-6 pb-5 text-[11px] text-faint">Amounts from each swap&apos;s PoolManager Swap event. In = paid into the pool by the swapper.</p>
      </Card>
    </div>
  );
}

export function RecordedNote() {
  const a = useArena();
  if (a.mode !== "RECORDED") return null;
  return (
    <Notice tone="warn" title="Showing a recorded run">
      {a.note ?? "The Arena service isn't reachable."} The per-block stream (lanes, gap and fee charts) has only the recording&apos;s three snapshots. Start the Arena for the live view.
    </Notice>
  );
}
