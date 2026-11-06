"use client";
/**
 * The perp order book Aven prices against: Hyperliquid's live l2Book (read-only). Aven pools are AMMs and have no book,
 * so this panel shows the market the hook reads, with the Aven pool price marked against it.
 */
import { config } from "@/config";
import { useArena } from "@/lib/arena";
import { num } from "@/lib/format";
import { useBook, type BookLevel } from "@/lib/hl";

export function OrderBook() {
  const b = useBook();
  const a = useArena();
  const book = b.data;
  const max = book ? Math.max(book.asks[book.asks.length - 1]?.total ?? 0, book.bids[book.bids.length - 1]?.total ?? 0) : 0;
  const bestAsk = book?.asks[0]?.px;
  const bestBid = book?.bids[0]?.px;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null;
  const bidSz = book?.bids.reduce((s, l) => s + l.sz, 0) ?? 0;
  const askSz = book?.asks.reduce((s, l) => s + l.sz, 0) ?? 0;
  const bidPct = bidSz + askSz > 0 ? (bidSz / (bidSz + askSz)) * 100 : 50;
  const pool = a.mode === "LIVE" && a.status === "ok" ? a.state?.pools.aven.price : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-medium text-ink">Perp order book</p>
        <p className="text-[11px] text-muted">Hyperliquid · read-only</p>
      </div>
      <div className="num grid grid-cols-3 px-4 pb-1 pt-2.5 text-[11px] text-muted">
        <span>Price</span>
        <span className="text-right">Size ({config.hlCoin})</span>
        <span className="text-right">Total</span>
      </div>
      {!book ? (
        <p className="px-4 py-8 text-center text-xs text-muted">{b.error ? `Book unavailable: ${b.error}` : "Loading book…"}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <div className="flex flex-col-reverse">
            {book.asks.map((l) => (
              <Row key={`a${l.px}`} l={l} max={max} side="ask" />
            ))}
          </div>
          <div className="my-1 flex items-center justify-between border-y border-line bg-raised/40 px-4 py-2">
            <span className="num text-[15px] text-ink">{mid ? num(mid, 2) : "—"}</span>
            <span className="num text-[11px] text-muted">spread {spread !== null ? num(spread, 1) : "—"}</span>
          </div>
          <div>
            {book.bids.map((l) => (
              <Row key={`b${l.px}`} l={l} max={max} side="bid" />
            ))}
          </div>
          {pool !== undefined && (
            <p className="num mt-2 px-4 text-[11px] text-muted">
              Aven pool <span className="text-aven">{num(pool, 2)}</span>
              {mid ? <span> · {(((pool - mid) / mid) * 10_000).toFixed(0)} bp vs mid</span> : null}
            </p>
          )}
        </div>
      )}
      <div className="mt-auto px-4 pb-3 pt-3">
        <div className="flex h-6 overflow-hidden rounded-md text-[10px] font-medium">
          <div className="num flex items-center bg-[#22c08a]/20 pl-2 text-[#22c08a]" style={{ width: `${bidPct}%` }}>
            B {bidPct.toFixed(1)}%
          </div>
          <div className="num flex flex-1 items-center justify-end bg-[#e5534b]/20 pr-2 text-[#e5534b]">{(100 - bidPct).toFixed(1)}% S</div>
        </div>
      </div>
    </div>
  );
}

function Row({ l, max, side }: { l: BookLevel; max: number; side: "bid" | "ask" }) {
  const c = side === "bid" ? "34,192,138" : "229,83,75";
  return (
    <div className="num relative grid grid-cols-3 px-4 py-[3px] text-xs">
      <span className="absolute inset-y-0 right-0" style={{ width: `${max ? (l.total / max) * 100 : 0}%`, background: `rgba(${c},0.12)` }} aria-hidden />
      <span className="relative" style={{ color: `rgb(${c})` }}>
        {num(l.px, 1)}
      </span>
      <span className="relative text-right text-ink-2">{l.sz.toFixed(4)}</span>
      <span className="relative text-right text-muted">{l.total.toFixed(3)}</span>
    </div>
  );
}
