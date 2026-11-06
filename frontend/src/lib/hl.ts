"use client";
/**
 * Read-only Hyperliquid market data for the Trade page, straight from the public info API (config.hlApi).
 * Request shapes checked against the live API on 2026-11-06 (candleSnapshot, l2Book, metaAndAssetCtxs).
 * Nothing here trades: Aven only reads the perp market (AGENTS.md §6).
 */
import { useEffect, useRef, useState } from "react";
import { config } from "@/config";

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const INTERVAL_MS: Record<Interval, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3 };

export interface Candle {
  time: number; // unix seconds (open)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface BookLevel {
  px: number;
  sz: number;
  total: number;
}
export interface Book {
  bids: BookLevel[];
  asks: BookLevel[];
  time: number;
}
export interface AssetCtx {
  markPx: number;
  oraclePx: number;
  midPx: number | null;
  prevDayPx: number;
  dayNtlVlm: number;
  openInterest: number;
  funding: number;
  premium: number;
  maxLeverage: number;
}

async function info<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(config.hlApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, cache: "no-store" });
  if (!r.ok) throw new Error(`Hyperliquid info: HTTP ${r.status}`);
  return (await r.json()) as T;
}

type RawCandle = { t: number; o: string; h: string; l: string; c: string; v: string };

export async function fetchCandles(coin: string, interval: Interval, bars = 300, signal?: AbortSignal): Promise<Candle[]> {
  const end = Date.now();
  const raw = await info<RawCandle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - bars * INTERVAL_MS[interval], endTime: end } }, signal);
  return raw.map((c) => ({ time: Math.floor(c.t / 1000), open: +c.o, high: +c.h, low: +c.l, close: +c.c, volume: +c.v }));
}

export async function fetchBook(coin: string, depth = 9, signal?: AbortSignal): Promise<Book> {
  const raw = await info<{ time: number; levels: [Array<{ px: string; sz: string }>, Array<{ px: string; sz: string }>] }>({ type: "l2Book", coin }, signal);
  const side = (lv: Array<{ px: string; sz: string }>) => {
    let total = 0;
    return lv.slice(0, depth).map((l) => ({ px: +l.px, sz: +l.sz, total: (total += +l.sz) }));
  };
  return { bids: side(raw.levels[0]), asks: side(raw.levels[1]), time: raw.time };
}

export async function fetchCtx(coin: string, signal?: AbortSignal): Promise<AssetCtx> {
  type Meta = { universe: Array<{ name: string; maxLeverage: number }> };
  type Ctx = { markPx: string; oraclePx: string; midPx: string | null; prevDayPx: string; dayNtlVlm: string; openInterest: string; funding: string; premium: string | null };
  const [meta, ctxs] = await info<[Meta, Ctx[]]>({ type: "metaAndAssetCtxs" }, signal);
  const i = meta.universe.findIndex((u) => u.name === coin);
  if (i < 0) throw new Error(`${coin} is not listed on this Hyperliquid network`);
  const c = ctxs[i]!;
  return {
    markPx: +c.markPx,
    oraclePx: +c.oraclePx,
    midPx: c.midPx === null ? null : +c.midPx,
    prevDayPx: +c.prevDayPx,
    dayNtlVlm: +c.dayNtlVlm,
    openInterest: +c.openInterest,
    funding: +c.funding,
    premium: c.premium === null ? 0 : +c.premium,
    maxLeverage: meta.universe[i]!.maxLeverage,
  };
}

/** Poll `fn` every `ms` while the tab is visible; keeps the last good value and reports the last error. */
function usePoll<T>(fn: (s: AbortSignal) => Promise<T>, ms: number, deps: unknown[]): { data: T | null; error: string | null; at: number | null } {
  const [s, setS] = useState<{ data: T | null; error: string | null; at: number | null }>({ data: null, error: null, at: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctl: AbortController | undefined;
    setS((p) => ({ ...p, data: null }));
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") {
        ctl = new AbortController();
        try {
          const data = await fnRef.current(ctl.signal);
          if (alive) setS({ data, error: null, at: Date.now() });
        } catch (e) {
          if (alive && (e as Error).name !== "AbortError") setS((p) => ({ ...p, error: (e as Error).message }));
        }
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      ctl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

export const useCandles = (interval: Interval, coin = config.hlCoin) => usePoll((s) => fetchCandles(coin, interval, 300, s), 4_000, [coin, interval]);
export const useBook = (coin = config.hlCoin) => usePoll((s) => fetchBook(coin, 9, s), 2_000, [coin]);
export const useCtx = (coin = config.hlCoin) => usePoll((s) => fetchCtx(coin, s), 3_000, [coin]);
