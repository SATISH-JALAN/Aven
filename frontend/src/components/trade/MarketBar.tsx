"use client";
/** The stats strip above the chart: the perp market (Hyperliquid, read-only) next to what the Aven pool does with it. */
import { useMemo } from "react";
import { config } from "@/config";
import { useArena } from "@/lib/arena";
import { bps, num, pipsPct, usd } from "@/lib/format";
import { useCandles, useCtx } from "@/lib/hl";
import { pushState } from "@/lib/pressure";
import { feeFor } from "@/lib/swap";

const UP = "#22c08a";
const DOWN = "#e5534b";

export function MarketBar() {
  const ctx = useCtx();
  const spark = useCandles("15m");
  const a = useArena();
  const c = ctx.data;
  const chg = c ? c.markPx - c.prevDayPx : 0;
  const chgPct = c && c.prevDayPx ? (chg / c.prevDayPx) * 100 : 0;
  const aven = a.state?.pools.aven;
  const plain = a.state?.pools.control;
  const sellFee = feeFor(a.state, "aven", "sellBase");
  const buyFee = feeFor(a.state, "aven", "buyBase");
  const tag = a.mode === "LIVE" && a.status === "ok" ? "live" : a.mode === "RECORDED" ? "recorded" : null;

  const path = useMemo(() => {
    const k = spark.data?.slice(-48);
    if (!k || k.length < 2) return null;
    const ys = k.map((x) => x.close);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    return ys.map((y, i) => `${i ? "L" : "M"}${((i / (ys.length - 1)) * 80).toFixed(1)},${(22 - ((y - lo) / (hi - lo || 1)) * 20).toFixed(1)}`).join(" ");
  }, [spark.data]);

  return (
    <div className="no-scrollbar flex items-stretch gap-px overflow-x-auto rounded-2xl border border-line bg-line">
      <div className="flex shrink-0 items-center gap-3 bg-surface px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#627eea]/15 text-[15px] font-semibold text-[#8ea2f2]" aria-hidden>
          Ξ
        </span>
        <div>
          <p className="text-[15px] font-medium tracking-[-0.01em] text-ink">{config.hlCoin}-PERP</p>
          <p className="text-[11px] text-muted">Hyperliquid {config.chainId === 999 ? "mainnet" : "testnet"}</p>
        </div>
      </div>
      <div className="flex min-w-max flex-1 items-center gap-7 bg-surface px-5 py-3">
        <Stat k="Mark" v={c ? num(c.markPx, 1) : "—"} color={chg >= 0 ? UP : DOWN}>
          {path && (
            <svg viewBox="0 0 80 24" className="ml-2 h-6 w-20" aria-hidden>
              <path d={path} fill="none" stroke={chg >= 0 ? UP : DOWN} strokeWidth="1.4" />
            </svg>
          )}
        </Stat>
        <Stat k="24h change" v={c ? `${chg >= 0 ? "+" : ""}${chgPct.toFixed(2)}%` : "—"} color={chg >= 0 ? UP : DOWN} />
        <Stat k="Oracle" v={c ? num(c.oraclePx, 2) : "—"} />
        <Stat k="Premium (mark vs oracle)" v={c && c.oraclePx ? bps(((c.markPx - c.oraclePx) / c.oraclePx) * 10_000) : "—"} />
        <Stat k="Funding (1h)" v={c ? `${(c.funding * 100).toFixed(4)}%` : "—"} />
        <Stat k="24h volume" v={c ? usd(c.dayNtlVlm, 0) : "—"} />
        <Stat k="Open interest" v={c ? usd(c.openInterest * c.markPx, 0) : "—"} />
        <span className="h-8 w-px bg-line" aria-hidden />
        <Stat k={`Aven pool${tag ? ` · ${tag}` : ""}`} v={aven ? num(aven.price, 2) : "—"} />
        <Stat k="Pool gap" v={aven ? bps(aven.gapBps) : "—"} color={aven && pushState(aven.gapBps).pushed ? "var(--color-warn)" : undefined} />
        <Stat k="Aven fee · sell / buy" v={sellFee !== null && buyFee !== null ? `${pipsPct(sellFee)} / ${pipsPct(buyFee)}` : "—"} />
        <span className="h-8 w-px bg-line" aria-hidden />
        <Stat k={`Plain pool (0.30%)${tag ? ` · ${tag}` : ""}`} v={plain ? num(plain.price, 2) : "—"} />
        <Stat k="Plain gap" v={plain ? bps(plain.gapBps) : "—"} color={plain && pushState(plain.gapBps).pushed ? "var(--color-warn)" : undefined} />
      </div>
    </div>
  );
}

function Stat({ k, v, color, children }: { k: string; v: string; color?: string; children?: React.ReactNode }) {
  return (
    <div className="shrink-0">
      <p className="text-[11px] text-muted">{k}</p>
      <p className="num mt-0.5 flex items-center text-[13px] text-ink" style={color ? { color } : undefined}>
        {v}
        {children}
      </p>
    </div>
  );
}
