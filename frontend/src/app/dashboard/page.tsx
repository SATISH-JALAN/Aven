"use client";
import { useMemo, useState } from "react";
import { Controls } from "@/components/arena/Controls";
import { TradeTape } from "@/components/arena/Tape";
import { Block, Composition, Headline, LatencyProof, LiveStrip, MarketCharts, NoExtraFee, RecordedNote, SwapInspector, Throughput } from "@/components/dashboard/sections";
import { OnchainRecord } from "@/components/onchain/Ledger";
import { WalletCard } from "@/components/onchain/Portfolio";
import { UsePageMode } from "@/components/shell";
import { Details, PageHero } from "@/components/ui";
import { useArena } from "@/lib/arena";
import { episodes, inWindow } from "@/lib/dashboard";

const WINDOWS: Array<{ label: string; ms: number | null }> = [
  { label: "2 min", ms: 2 * 60_000 },
  { label: "10 min", ms: 10 * 60_000 },
  { label: "30 min", ms: 30 * 60_000 },
  { label: "All", ms: null },
];

const NAV = [
  ["latency", "Latency"],
  ["market", "Market"],
  ["chain", "On chain"],
  ["swap", "Swap inspector"],
  ["fees", "No extra fee"],
  ["split", "Where fees go"],
  ["flow", "Throughput"],
  ["feed", "Live feed"],
] as const;

export default function DashboardPage() {
  const a = useArena();
  const [win, setWin] = useState<number | null>(10 * 60_000);
  // "Now" on the Arena's clock (the newest stream sample), so windows never depend on this browser's clock.
  const now = a.state?.ts ?? a.trades[0]?.ts ?? 0;
  const history = useMemo(() => inWindow(a.history, win, now), [a.history, win, now]);
  const trades = useMemo(() => inWindow(a.trades, win, now), [a.trades, win, now]);
  const eps = useMemo(() => (a.math ? episodes(history, trades, a.shocks, a.math.params) : []), [history, trades, a.shocks, a.math]);

  return (
    <>
      <UsePageMode mode={a.mode === "LIVE" && a.status === "ok" ? "LIVE" : a.mode === "RECORDED" ? "RECORDED" : null} />
      <PageHero
        eyebrow="Dashboard"
        title="Every swap, every block, live."
        lede="The HyperCore price moves, the Aven fee answers in the same block, and arbitrage pays LPs instead of the bot. All measured from the live Arena."
      />

      <div className="mx-auto max-w-7xl space-y-4 px-6">
        <RecordedNote />
        <LiveStrip history={a.history} />
        <WalletCard />
        <Headline />
      </div>

      {/* One filter row; it scopes every chart and table below it. */}
      <div className="sticky top-20 z-30 mx-auto mt-10 max-w-7xl px-6">
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-line bg-bg/85 px-3 py-2 backdrop-blur">
          <span className="px-2 text-[11px] text-muted">Window</span>
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWin(w.ms)}
              className={`rounded-full px-3 py-1 text-xs transition ${win === w.ms ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              aria-pressed={win === w.ms}
            >
              {w.label}
            </button>
          ))}
          <span className="mx-2 hidden h-4 w-px bg-line md:block" />
          <nav className="hidden flex-wrap gap-1 md:flex" aria-label="Dashboard sections">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-full px-2.5 py-1 text-[11px] text-muted transition hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          <span className="num ml-auto pr-2 text-[11px] text-faint">
            {history.length} blocks · {trades.length} swaps · {eps.length} moves
          </span>
        </div>
      </div>

      <Block id="latency" eyebrow="Latency" title="The fee moves in the same block as the market." lede="Watch a price move block by block: when the oracle moves, when each fee answers, when each arb lands.">
        <LatencyProof eps={eps} history={history} />
      </Block>

      <Block id="market" eyebrow="Market" title="Prices, gaps and fees, per block.">
        <MarketCharts history={history} eps={eps} />
      </Block>

      <Block id="chain" eyebrow="On chain" title="Every swap, from the chain itself." lede="Read from HyperEVM logs, not the Arena: what each swap met, the oracle and perp mark the hook read in that block, and the proof. The time window doesn't apply here: it's the whole history.">
        <OnchainRecord />
      </Block>

      <Block id="swap" eyebrow="Swap inspector" title="One swap: before, during, after." lede="Pick any Aven swap: the stale price it met, how the hook priced it, what it left behind.">
        <SwapInspector history={history} eps={eps} />
      </Block>

      <Block id="fees" eyebrow="No extra fee" title="Every pip above the base is the market's." lede="Each fee is checked against its inputs and against the chain.">
        <NoExtraFee trades={trades} eps={eps} history={history} />
      </Block>

      <Block id="split" eyebrow="Where fees go" title="What LPs were paid for.">
        <Composition trades={trades} />
      </Block>

      <Block id="flow" eyebrow="Throughput" title="What flowed in and out.">
        <Throughput trades={trades} windowMs={win} now={now} />
      </Block>

      <Block id="feed" eyebrow="Live feed" title="Every trade, as it lands.">
        <TradeTape />
        <Details summary="Operator controls (Arena admin)" className="mt-6">
          <Controls />
        </Details>
      </Block>
    </>
  );
}
