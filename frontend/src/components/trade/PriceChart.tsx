"use client";
/**
 * TradingView Lightweight Charts (Apache-2.0; the attribution logo stays on, as the licence asks).
 * - Candles + volume: Hyperliquid perp candles (read-only info API).
 * - Oracle: Hyperliquid's oracle price as a price line (what AvenFairValue reads at 0x…0807).
 * - Aven and plain pool prices: from the Arena's live /state history. Only drawn in LIVE mode: a recording from
 *   another day would put old pool prices over today's candles.
 * - Markers: the arb bot's trades (LIVE only, same reason).
 */
import { useEffect, useRef, useState } from "react";
import type { CandlestickData, HistogramData, IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, LineData, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { config } from "@/config";
import { useArena } from "@/lib/arena";
import { INTERVALS, useCandles, useCtx, type Interval } from "@/lib/hl";

const UP = "#22c08a";
const DOWN = "#e5534b";

export function PriceChart() {
  const [interval, setIntervalState] = useState<Interval>("1m");
  const candles = useCandles(interval);
  const ctx = useCtx();
  const a = useArena();
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    candle: ISeriesApi<"Candlestick">;
    volume: ISeriesApi<"Histogram">;
    aven: ISeriesApi<"Line">;
    plain: ISeriesApi<"Line">;
    markers: ISeriesMarkersPluginApi<Time>;
    oracleLine: IPriceLine | null;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef<string>("");
  const [hover, setHover] = useState<CandlestickData<Time> | null>(null);

  // Create the chart once.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    (async () => {
      const lw = await import("lightweight-charts");
      if (disposed || !box.current) return;
      const chart = lw.createChart(box.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#7c8682", fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: "rgba(29,34,32,0.6)" }, horzLines: { color: "rgba(29,34,32,0.6)" } },
        rightPriceScale: { borderColor: "#1d2220", scaleMargins: { top: 0.12, bottom: 0.22 } },
        timeScale: { borderColor: "#1d2220", timeVisible: true, secondsVisible: false, rightOffset: 6 },
        crosshair: { vertLine: { color: "#525a57", labelBackgroundColor: "#151917" }, horzLine: { color: "#525a57", labelBackgroundColor: "#151917" } },
      });
      const candle = chart.addSeries(lw.CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN });
      const volume = chart.addSeries(lw.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      const line = { lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
      const aven = chart.addSeries(lw.LineSeries, { ...line, color: "#199e70", title: "Aven pool" });
      const plain = chart.addSeries(lw.LineSeries, { ...line, color: "#d95926", title: "Plain pool" });
      const markers = lw.createSeriesMarkers(candle, []);
      chart.subscribeCrosshairMove((p) => {
        const d = p.seriesData.get(candle) as CandlestickData<Time> | undefined;
        setHover(d ?? null);
      });
      api.current = { chart, candle, volume, aven, plain, markers, oracleLine: null };
      setReady(true);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      api.current?.chart.remove();
      api.current = null;
    };
  }, []);

  // Candles + volume.
  useEffect(() => {
    const c = api.current;
    if (!ready || !c || !candles.data) return;
    c.candle.setData(candles.data.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    c.volume.setData(
      candles.data.map((k): HistogramData<Time> => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "rgba(34,192,138,0.35)" : "rgba(229,83,75,0.35)" })),
    );
    if (fitted.current !== interval) {
      c.chart.timeScale().fitContent();
      fitted.current = interval;
    }
  }, [ready, candles.data, interval]);

  // Oracle price line.
  useEffect(() => {
    const c = api.current;
    if (!ready || !c || !ctx.data) return;
    const opts = { price: ctx.data.oraclePx, color: "#b3bcb8", lineWidth: 1 as const, lineStyle: 2, axisLabelVisible: true, title: "oracle" };
    if (c.oracleLine) c.oracleLine.applyOptions(opts);
    else c.oracleLine = c.candle.createPriceLine(opts);
  }, [ready, ctx.data]);

  // Pool prices + arb markers (LIVE only).
  const live = a.mode === "LIVE" && a.status === "ok";
  useEffect(() => {
    const c = api.current;
    if (!ready || !c) return;
    if (!live) {
      c.aven.setData([]);
      c.plain.setData([]);
      c.markers.setMarkers([]);
      return;
    }
    // One point per second at most; lightweight-charts needs strictly increasing times.
    const bySec = new Map<number, { aven: number; plain: number }>();
    for (const h of a.history) bySec.set(Math.floor(h.ts / 1000), { aven: h.aven, plain: h.control });
    const pts = [...bySec.entries()].sort((x, y) => x[0] - y[0]);
    c.aven.setData(pts.map(([t, v]): LineData<Time> => ({ time: t as UTCTimestamp, value: v.aven })));
    c.plain.setData(pts.map(([t, v]): LineData<Time> => ({ time: t as UTCTimestamp, value: v.plain })));
    const bar = (ts: number) => {
      const s = Math.floor(ts / 1000);
      const step = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 }[interval];
      return (s - (s % step)) as UTCTimestamp;
    };
    const ms: SeriesMarker<Time>[] = a.trades
      .filter((t) => t.kind === "arb")
      .slice(0, 60)
      .map((t): SeriesMarker<Time> => ({
        time: bar(t.ts),
        position: t.direction === "buyBase" ? ("belowBar" as const) : ("aboveBar" as const),
        shape: t.direction === "buyBase" ? ("arrowUp" as const) : ("arrowDown" as const),
        color: t.pool === "aven" ? "#199e70" : "#d95926",
        text: `${t.pool === "aven" ? "Aven" : "Plain"} arb`,
      }))
      .sort((x, y) => (x.time as number) - (y.time as number));
    c.markers.setMarkers(ms);
  }, [ready, live, a.history, a.trades, interval]);

  const last = candles.data?.[candles.data.length - 1];
  const o = hover ?? (last ? { open: last.open, high: last.high, low: last.low, close: last.close } : null);
  const chg = o ? o.close - o.open : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Candle interval">
          {INTERVALS.map((i) => (
            <button key={i} role="radio" aria-checked={interval === i} onClick={() => setIntervalState(i)} className={`num rounded-md px-2 py-1 text-xs transition ${interval === i ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
              {i}
            </button>
          ))}
        </div>
        <span className="h-4 w-px bg-line" aria-hidden />
        {o && (
          <p className="num flex flex-wrap gap-x-3 text-[11px] text-muted">
            <span>
              O <span className="text-ink-2">{o.open.toFixed(1)}</span>
            </span>
            <span>
              H <span className="text-ink-2">{o.high.toFixed(1)}</span>
            </span>
            <span>
              L <span className="text-ink-2">{o.low.toFixed(1)}</span>
            </span>
            <span>
              C <span style={{ color: chg >= 0 ? UP : DOWN }}>{o.close.toFixed(1)}</span>
            </span>
          </p>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
          <Legend color="#b3bcb8" dashed label="Oracle" />
          <Legend color="#199e70" label="Aven pool" off={!live} />
          <Legend color="#d95926" label="Plain pool" off={!live} />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={box} className="absolute inset-0" />
        {!candles.data && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">{candles.error ? `Candles unavailable: ${candles.error}` : "Loading candles…"}</div>
        )}
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-faint">
        {config.hlCoin}-PERP candles from Hyperliquid {config.chainId === 999 ? "mainnet" : "testnet"} (read-only). {live ? "Pool lines and arb markers: live Arena." : "Pool lines appear when the live Arena is running."}
      </p>
    </div>
  );
}

function Legend({ color, label, dashed, off }: { color: string; label: string; dashed?: boolean; off?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 ${off ? "opacity-40" : ""}`}>
      <span className="inline-block h-0 w-4 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {label}
    </span>
  );
}
