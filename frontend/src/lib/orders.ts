"use client";
/**
 * Conditional orders for the Trade page: limit, stop, and take-profit / stop-loss attached to a market buy or sell.
 *
 * They are spot swaps on the chosen pool, nothing more: no leverage, no margin, no liquidation (AGENTS.md §6; real
 * margin would need new lending/margin contracts, MEMORY.md 2026-11-07). They are watched by THIS browser tab: on
 * every new block the engine compares the pool's price with each open order's trigger, and when one is hit it asks the
 * wallet to sign the swap. Close the tab and they pause; nothing is held or executed by anyone else. Orders are kept in
 * localStorage per wallet (a per-viewer convenience, not a record): the chain stays the record of what was filled.
 *
 * Trigger price = the chosen pool's price (quote per base), the price the swap would actually execute near.
 */
import { useSyncExternalStore } from "react";
import type { Direction, PoolName } from "@/lib/types";

export type OrderKind = "limit" | "stop" | "tp" | "sl";
export type OrderStatus = "open" | "triggered" | "filled" | "failed" | "cancelled";

export interface Order {
  id: string;
  owner: string;
  pool: PoolName;
  side: Direction;
  kind: OrderKind;
  /** Amount of the INPUT token (base for a sell, quote for a buy), as typed. */
  amount: string;
  trigger: number;
  createdAt: number;
  status: OrderStatus;
  /** One-cancels-other partner (a TP and its SL). */
  ocoWith?: string;
  tx?: string;
  error?: string;
  filledAt?: number;
}

/**
 * Does `price` hit the order's trigger? Sells: a take-profit or limit sell fills at or above the trigger, a stop-loss
 * or stop sell at or below. Buys: a limit buy fills at or below the trigger, a stop buy (breakout) at or above.
 */
export function triggered(o: Pick<Order, "side" | "kind" | "trigger">, price: number): boolean {
  if (!(price > 0) || !(o.trigger > 0)) return false;
  const upward = o.side === "sellBase" ? o.kind === "tp" || o.kind === "limit" : o.kind === "stop" || o.kind === "tp";
  return upward ? price >= o.trigger : price <= o.trigger;
}

/** Why an order's trigger makes no sense against the current price (it would fire at once), or null if it's fine. */
export function triggerProblem(o: Pick<Order, "side" | "kind" | "trigger">, price: number): string | null {
  if (!(o.trigger > 0)) return "Enter a trigger price";
  if (!(price > 0)) return "Waiting for the pool price";
  if (triggered(o, price)) {
    const up = triggered({ ...o, trigger: price * 1.000001 }, price * 2);
    return `Trigger must be ${up ? "above" : "below"} the pool price (${price.toFixed(2)}) or it fills at once: use a market order`;
  }
  return null;
}

export const KIND_LABEL: Record<OrderKind, string> = { limit: "Limit", stop: "Stop", tp: "Take profit", sl: "Stop loss" };

// ------------------------------------------------------------------------------------------------ store

const KEY = "aven:orders:v1";
let orders: Order[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) orders = (JSON.parse(raw) as Order[]).filter((o) => o && typeof o.id === "string");
  } catch {
    orders = [];
  }
  // A swap that was mid-signature when the tab closed is unknown: mark it, never re-send it blindly.
  orders = orders.map((o) => (o.status === "triggered" ? { ...o, status: "failed", error: "Tab closed while the swap was pending; check your wallet" } : o));
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(orders.slice(-200)));
  } catch {}
  listeners.forEach((l) => l());
}

export function addOrders(list: Omit<Order, "id" | "createdAt" | "status">[]): Order[] {
  load();
  const now = Date.now();
  const made = list.map((o, i) => ({ ...o, id: `o${now.toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`, createdAt: now, status: "open" as const }));
  if (made.length === 2) {
    made[0]!.ocoWith = made[1]!.id;
    made[1]!.ocoWith = made[0]!.id;
  }
  orders = [...orders, ...made];
  save();
  return made;
}

export function updateOrder(id: string, patch: Partial<Order>) {
  load();
  orders = orders.map((o) => (o.id === id ? { ...o, ...patch } : o));
  save();
}

export function cancelOrder(id: string) {
  updateOrder(id, { status: "cancelled" });
}

const subscribe = (l: () => void) => {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY: Order[] = [];
/** Every order (all wallets) in this browser; filter by owner at the call site. */
export function useOrders(): Order[] {
  return useSyncExternalStore(subscribe, () => (load(), orders), () => EMPTY);
}
