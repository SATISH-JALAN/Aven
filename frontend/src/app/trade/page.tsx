"use client";
import { Activity } from "@/components/trade/Activity";
import { MarketBar } from "@/components/trade/MarketBar";
import { OrderBook } from "@/components/trade/OrderBook";
import { OrderPanel } from "@/components/trade/OrderPanel";
import { PriceChart } from "@/components/trade/PriceChart";
import { UsePageMode } from "@/components/shell";
import { useArena } from "@/lib/arena";
import { dateUtc } from "@/lib/format";

const panel = "min-h-0 overflow-hidden rounded-2xl border border-line bg-surface";

export default function TradePage() {
  const a = useArena();
  return (
    <div className="mx-auto max-w-[1680px] px-3 pb-6 pt-[84px] md:px-4">
      <UsePageMode mode={a.mode === "LIVE" && a.status === "ok" ? "LIVE" : a.mode === "RECORDED" ? "RECORDED" : null} />
      {a.mode === "RECORDED" && a.recorded && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warn/30 bg-warn/5 px-4 py-2 text-xs">
          <span className="font-medium text-warn">⚠ Recorded run</span>
          <span className="text-ink-2">Arena offline: pool data is the {dateUtc(new Date(a.recorded.recordedAt).getTime())} recording. Market data (chart, book, stats) is live from Hyperliquid.</span>
          <button onClick={a.refresh} className="ml-auto text-ink underline decoration-line-strong underline-offset-4 hover:text-mint">
            Retry live
          </button>
        </div>
      )}
      <MarketBar />
      <div className="mt-2 grid gap-2 xl:h-[calc(100svh-230px)] xl:min-h-[560px] md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_300px_340px]">
        <section className={`${panel} h-[460px] md:col-span-2 xl:col-span-1 xl:h-auto`} aria-label="Price chart">
          <PriceChart />
        </section>
        <section className={`${panel} hidden md:block`} aria-label="Order book">
          <OrderBook />
        </section>
        <section className={`${panel} overflow-y-auto`} aria-label="Order panel">
          <OrderPanel />
        </section>
      </div>
      <section className={`${panel} mt-2 h-[360px]`} aria-label="Activity">
        <Activity />
      </section>
    </div>
  );
}
