"use client";
/**
 * Read-only Hyperliquid market data for the Trade page, straight from the public info API (config.hlApi).
 * Request shapes checked against the live API on 2026-11-06 (candleSnapshot, l2Book, metaAndAssetCtxs).
 * Nothing here trades: Aven only reads the perp market (AGENTS.md §6).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** Candles for a fixed time range (ms), e.g. the minutes that on-chain swaps fall in. One call; Hyperliquid serves
 *  up to 5,000 candles per request. */
export async function fetchCandleRange(coin: string, interval: Interval, startMs: number, endMs: number, signal?: AbortSignal): Promise<Candle[]> {
  const raw = await info<RawCandle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: startMs, endTime: endMs } }, signal);
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

type PollState<T> = { data: T | null; error: string | null; at: number | null };
const EMPTY: PollState<never> = { data: null, error: null, at: null };
type Shared = { state: PollState<unknown>; subs: Set<() => void>; fn: (s: AbortSignal) => Promise<unknown>; ms: number; timer?: ReturnType<typeof setTimeout>; ctl?: AbortController };
const shared = new Map<string, Shared>();

/** One poll per `key` for the whole page, however many components read it (same visibility rule as usePoll). */
function useSharedPoll<T>(key: string, fn: (s: AbortSignal) => Promise<T>, ms: number): PollState<T> {
  let e = shared.get(key);
  if (!e) shared.set(key, (e = { state: EMPTY, subs: new Set(), fn, ms }));
  e.fn = fn;
  const entry = e;
  const subscribe = useCallback(
    (l: () => void) => {
      entry.subs.add(l);
      if (entry.subs.size === 1) {
        const tick = async () => {
          if (document.visibilityState === "visible") {
            entry.ctl = new AbortController();
            try {
              entry.state = { data: await entry.fn(entry.ctl.signal), error: null, at: Date.now() };
            } catch (err) {
              if ((err as Error).name !== "AbortError") entry.state = { ...entry.state, error: (err as Error).message };
            }
            entry.subs.forEach((f) => f());
          }
          if (entry.subs.size) entry.timer = setTimeout(tick, entry.ms);
        };
        void tick();
      }
      return () => {
        entry.subs.delete(l);
        if (!entry.subs.size) {
          clearTimeout(entry.timer);
          entry.ctl?.abort();
        }
      };
    },
    [entry],
  );
  return useSyncExternalStore(subscribe, () => entry.state as PollState<T>, () => EMPTY);
}

/*
 * Poll rates, budgeted against Hyperliquid's 1,200 weight/min per IP ("REST requests share an aggregated weight limit
 * of 1200 per minute"; l2Book weight 2, other info requests 20, candleSnapshot +1 per 60 candles returned):
 * chart 6/min × 25 = 150, sparkline 1/min × 25 = 25, book 30/min × 2 = 60, ctx (shared) 12/min × 20 = 240 → ~475.
 */
export const useCandles = (interval: Interval, coin = config.hlCoin, ms = 10_000) => usePoll((s) => fetchCandles(coin, interval, 300, s), ms, [coin, interval, ms]);
export const useBook = (coin = config.hlCoin) => usePoll((s) => fetchBook(coin, 9, s), 2_000, [coin]);
export const useCtx = (coin = config.hlCoin) => useSharedPoll(`ctx:${coin}`, (s) => fetchCtx(coin, s), 5_000);
