"use client";
/**
 * Bottom panel of the Trade page: what just happened on the two pools.
 * - Arb feed: the Arena bot's trades as they land (SSE), one line each: who, what, the fee, who earned.
 * - All trades / Yours: the tape. Shocks: the price moves the bot reacted to. Earnings: LPs vs the arb bot.
 * Every row opens the fee proof (TradeDrawer).
 */
import { useMemo, useRef, useState } from "react";
import { Empty, MatchBadge, TermChip, TxLink } from "@/components/ui";
import { amountLabel, TradeDrawer } from "@/components/arena/Tape";
import { useArena } from "@/lib/arena";
import { pipsPct, timeUtc, usd } from "@/lib/format";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { termsFired } from "@/lib/steps";
import { useMyTrades } from "@/lib/swap";
import type { Trade } from "@/lib/types";

type Tab = "arb" | "all" | "mine" | "shocks" | "earn";

export function Activity() {
  const a = useArena();
  const mine = useMyTrades();
  const [tab, setTab] = useState<Tab>("arb");
  const [open, setOpen] = useState<Trade | null>(null);
  const arbs = useMemo(() => a.trades.filter((t) => t.kind === "arb"), [a.trades]);
  const all = useMemo(() => [...mine, ...a.trades].sort((x, y) => y.ts - x.ts).slice(0, 100), [mine, a.trades]);

  const tabs: Array<[Tab, string, number | null]> = [
    ["arb", "Arb feed", arbs.length],
    ["all", "All trades", all.length],
    ["mine", "Yours", mine.length],
    ["shocks", "Shocks", a.shocks.length],
    ["earn", "Earnings", null],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        {tabs.map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-[13px] transition ${tab === k ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
            {l}
            {n !== null && <span className="num ml-1.5 text-faint">{n}</span>}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 pr-2 text-[11px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${a.streaming ? "live-dot bg-good text-good" : "bg-faint"}`} />
          {a.mode === "LIVE" && a.status === "ok" ? (a.streaming ? "Streaming from the Arena" : "Polling the Arena") : a.mode === "RECORDED" ? "Recorded run" : "Arena offline"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "arb" && <Feed trades={arbs} onOpen={setOpen} />}
        {tab === "all" && <Table trades={all} onOpen={setOpen} />}
        {tab === "mine" && (mine.length ? <Table trades={mine} onOpen={setOpen} /> : <Pad>Your trades on this page show up here.</Pad>)}
        {tab === "shocks" && <Shocks />}
        {tab === "earn" && <Earnings />}
      </div>
      {open && <TradeDrawer trade={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4">
      <Empty>{children}</Empty>
    </div>
  );
}

/** Newest first, one sentence per arb; new lines flash in. */
function Feed({ trades, onOpen }: { trades: Trade[]; onOpen: (t: Trade) => void }) {
  const { math: d } = useArena();
  const ref = useRef<HTMLUListElement>(null);
  const seen = useRef(new Set<string>());
  useGSAP(
    () => {
      if (!ref.current) return; // empty state: nothing to animate
      const els = Array.from(ref.current.querySelectorAll<HTMLElement>("[data-id]"));
      const fresh = els.filter((e) => !seen.current.has(e.dataset.id!));
      const first = seen.current.size === 0;
      fresh.forEach((e) => seen.current.add(e.dataset.id!));
      if (first || !fresh.length) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(fresh, { autoAlpha: 0, y: -10, backgroundColor: "rgba(151,252,228,0.10)", duration: 1, ease: "expo.out", clearProps: "backgroundColor" });
      });
    },
    { dependencies: [trades.map((t) => t.id).join(",")], scope: ref },
  );
  if (!trades.length) return <Pad>No arb trades yet. They appear here the moment the bot closes a gap.</Pad>;
  return (
    <ul ref={ref} className="divide-y divide-line/60">
      {trades.slice(0, 60).map((t) => {
        const aven = t.pool === "aven";
        const lpShare = t.lpFeeIncomeUsd + t.botProfitUsd > 0 ? (t.lpFeeIncomeUsd / (t.lpFeeIncomeUsd + t.botProfitUsd)) * 100 : 0;
        return (
          <li key={t.id} data-id={t.id}>
            <button onClick={() => onOpen(t)} className="grid w-full grid-cols-[70px_1fr_auto] items-center gap-4 px-4 py-3 text-left transition hover:bg-raised/60 md:grid-cols-[70px_1fr_150px_150px_auto]">
              <span className="num text-[11px] text-muted">{timeUtc(t.ts)}</span>
              <span className="text-[13px] text-ink-2">
                <span className="text-ink">Arb bot</span> {t.direction === "buyBase" ? "bought" : "sold"} <span className="num text-ink">{amountLabel(t, d)}</span> on the{" "}
                <span style={{ color: aven ? "var(--color-aven)" : "var(--color-plain)" }}>{aven ? "Aven" : "plain"}</span> pool, paid <span className="num text-ink">{pipsPct(t.feePips)}</span>
              </span>
              <span className="num hidden text-xs md:block">
                <span className="text-muted">LPs </span>
                <span className="text-[#22c08a]">+{usd(t.lpFeeIncomeUsd)}</span>
                <span className="text-faint"> · {lpShare.toFixed(0)}%</span>
              </span>
              <span className="num hidden text-xs md:block">
                <span className="text-muted">bot </span>
                <span className="text-ink-2">{t.botProfitUsd >= 0 ? "+" : ""}{usd(t.botProfitUsd)}</span>
              </span>
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {t.verify && <MatchBadge ok={t.verify.checkA && t.verify.checkB} />}
                <TxLink hash={t.txHash} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Table({ trades, onOpen }: { trades: Trade[]; onOpen: (t: Trade) => void }) {
  const { math: d } = useArena();
  const threshold = d?.params.stressThresholdBps ?? 50;
  if (!trades.length) return <Pad>No trades yet.</Pad>;
  return (
    <table className="w-full min-w-[860px] text-left text-xs">
      <thead className="sticky top-0 bg-surface text-[11px] text-muted">
        <tr>
          {["Time", "Pool", "Who", "Side", "Size", "Fee", "Why", "LP fee", "Bot profit", "Tx"].map((h) => (
            <th key={h} className="px-4 py-2 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id} onClick={() => onOpen(t)} className="cursor-pointer border-t border-line/60 transition hover:bg-raised/60">
            <td className="num px-4 py-2.5 text-muted">{timeUtc(t.ts)}</td>
            <td className="px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-ink">
                <span className="h-2 w-2 rounded-full" style={{ background: t.pool === "aven" ? "var(--color-aven)" : "var(--color-plain)" }} />
                {t.pool === "aven" ? "Aven" : "Plain"}
              </span>
            </td>
            <td className="px-4 py-2.5 text-ink-2">{t.id.startsWith("you:") ? "you" : t.kind === "arb" ? "arb bot" : "shock"}</td>
            <td className={`px-4 py-2.5 ${t.direction === "buyBase" ? "text-[#22c08a]" : "text-[#e5534b]"}`}>{t.direction === "buyBase" ? "Buy" : "Sell"}</td>
            <td className="num px-4 py-2.5 text-ink-2">{amountLabel(t, d)}</td>
            <td className="num px-4 py-2.5 text-ink">{pipsPct(t.feePips)}</td>
            <td className="px-4 py-2.5">
              <span className="flex flex-wrap gap-1">{t.breakdown ? termsFired(t.breakdown, threshold).map((x) => <TermChip key={x} term={x} />) : <span className="text-faint">fixed</span>}</span>
            </td>
            <td className="num px-4 py-2.5 text-ink-2">{usd(t.lpFeeIncomeUsd)}</td>
            <td className="num px-4 py-2.5 text-ink-2">{t.kind === "arb" ? usd(t.botProfitUsd) : "—"}</td>
            <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
              <TxLink hash={t.txHash} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Shocks() {
  const a = useArena();
  if (!a.shocks.length) return <Pad>No shocks yet. A shock pushes both pools off the market price; the bot then arbs them back.</Pad>;
  return (
    <ul className="divide-y divide-line/60">
      {a.shocks.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-4 px-4 py-3 text-[13px]">
          <span className="num text-[11px] text-muted">{timeUtc(s.ts)}</span>
          <span className="text-ink-2">
            Shock: <span className="text-ink">{s.direction}</span> <span className="num text-ink">{s.sizeBase}</span> on both pools
          </span>
          <span className="ml-auto flex gap-3">
            {s.txHashes.map((h) => (
              <TxLink key={h} hash={h} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Earnings() {
  const { stats } = useArena();
  if (!stats) return <Pad>No stats yet.</Pad>;
  const rows = [
    { k: "Plain 0.30%", c: "var(--color-plain)", s: stats.control },
    { k: "Aven", c: "var(--color-aven)", s: stats.aven },
  ];
  return (
    <div className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto]">
      {rows.map((r) => {
        const total = r.s.lpFeeIncomeUsd + Math.max(0, r.s.botProfitUsd);
        const lp = total > 0 ? (r.s.lpFeeIncomeUsd / total) * 100 : 0;
        return (
          <div key={r.k} className="rounded-xl border border-line p-4">
            <p className="flex items-center gap-1.5 text-xs text-ink">
              <span className="h-2 w-2 rounded-full" style={{ background: r.c }} />
              {r.k}
              <span className="num ml-auto text-muted">{r.s.trades} arb trades</span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-muted">LPs earned</p>
                <p className="num text-lg text-[#22c08a]">{usd(r.s.lpFeeIncomeUsd)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted">Arb bot earned</p>
                <p className="num text-lg text-ink">{usd(r.s.botProfitUsd)}</p>
              </div>
            </div>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-raised">
              <div style={{ width: `${lp}%`, background: r.c }} />
            </div>
            <p className="num mt-1.5 text-[11px] text-muted">LPs keep {lp.toFixed(0)}% of the gap</p>
          </div>
        );
      })}
      <div className="flex flex-col justify-center rounded-xl border border-line p-4 md:min-w-[220px]">
        <p className="text-[11px] text-muted">LPs kept more on Aven</p>
        <p className="num text-3xl tracking-[-0.03em] text-ink">{usd(stats.lpKeptMoreUsd)}</p>
        <p className="mt-1 text-[11px] text-faint">same shocks, same bot, since {timeUtc(stats.since)} UTC</p>
      </div>
    </div>
  );
}
