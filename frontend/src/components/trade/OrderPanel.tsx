"use client";
/**
 * Order panel: Buy / Sell aETH as a spot swap on the chosen pool, with order types like a perps terminal:
 * - Market: swap now. Optional take-profit / stop-loss on the result (one cancels the other).
 * - Limit: buy at or below / sell at or above a pool price.
 * - Stop: buy at or above (breakout) / sell at or below a pool price.
 * Conditional orders are watched by this tab (src/lib/orders.ts): on each new block the engine below checks the pool
 * price and asks your wallet to sign when one triggers. No leverage, no margin, no liquidation: Aven reads the perp
 * market, it never trades it (AGENTS.md §6). Shows the fee before you sign, against the plain pool.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { TermChip, TxLink } from "@/components/ui";
import { useArena } from "@/lib/arena";
import { num, pipsPct, usd } from "@/lib/format";
import { addOrders, cancelOrder, KIND_LABEL, triggered, triggerProblem, updateOrder, useOrders, type Order, type OrderKind } from "@/lib/orders";
import { termsFired } from "@/lib/steps";
import { feeFor, indicativeOut, MAINNET_GAS_NOTE, SWAP_GAS_BUDGET, tokenSide, useBalances, useSwap } from "@/lib/swap";
import type { Direction, PoolName } from "@/lib/types";
import { config } from "@/config";

const SWAP_GAS = 180_000n; // a full swap through the test router, p50 (docs/PROOFS.md ~175k)
type OrderType = "market" | "limit" | "stop";
const BUY = "#22c08a";
const SELL = "#e5534b";
const opposite = (d: Direction): Direction => (d === "buyBase" ? "sellBase" : "buyBase");

export function OrderPanel() {
  const a = useArena();
  const s = useSwap();
  const m = a.math; // labels + decimals (real deployment, else the recording's)
  const [side, setSide] = useState<Direction>("buyBase");
  const [pool, setPool] = useState<PoolName>("aven");
  const [type, setType] = useState<OrderType>("market");
  const [amount, setAmount] = useState("");
  const [trigger, setTrigger] = useState("");
  const [bracket, setBracket] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const bal = useBalances(s.deployments, s.wallet.address, s.last);
  const all = useOrders();
  const owner = s.wallet.address?.toLowerCase() ?? null;
  const mine = useMemo(() => (owner ? all.filter((o) => o.owner === owner) : []), [all, owner]);

  const t = m ? tokenSide(m, side) : null;
  const amt = Number(amount) || 0;
  const price = a.state?.pools[pool].price ?? 0;
  const oracle = a.state?.oracle.price ?? 0;
  const fee = feeFor(a.state, pool, side);
  const plainFee = feeFor(a.state, "control", side) ?? 3000;
  const avenFee = feeFor(a.state, "aven", side);
  const inUsd = side === "sellBase" ? amt * oracle : amt;
  const out = fee !== null ? indicativeOut(amt, side, price, fee) : 0;
  const fp = a.state?.pools.aven.feePreview;
  const breakdown = fp && !("fixedPips" in fp) ? fp[side] : null;
  const terms = breakdown ? termsFired(breakdown, m?.params.stressThresholdBps ?? 50) : [];
  const inBal = bal && t ? (side === "sellBase" ? bal.base : bal.quote) : null;
  const gasHype = bal ? Number(formatUnits(SWAP_GAS * bal.gasPrice, 18)) : null;
  const gasOk = bal ? bal.native >= SWAP_GAS_BUDGET * bal.gasPrice : true;
  const buy = side === "buyBase";
  const sym = m?.tokens.baseSymbol ?? "aETH";

  // Validation per order type.
  const trig = Number(trigger) || 0;
  const condKind: OrderKind = type === "limit" ? "limit" : "stop";
  const closeSide = opposite(side);
  const problem = (() => {
    if (type !== "market") return triggerProblem({ side, kind: condKind, trigger: trig }, price);
    if (!bracket) return null;
    if (!tp && !sl) return "Set a take-profit or a stop-loss price, or turn TP / SL off";
    if (tp) {
      const p = triggerProblem({ side: closeSide, kind: "tp", trigger: Number(tp) || 0 }, price);
      if (p) return `Take profit: ${p}`;
    }
    if (sl) {
      const p = triggerProblem({ side: closeSide, kind: "sl", trigger: Number(sl) || 0 }, price);
      if (p) return `Stop loss: ${p}`;
    }
    return null;
  })();
  const blocker = s.blocker(amt, side) ?? (!gasOk ? "Not enough HYPE for gas" : null) ?? problem;

  const pct = (p: number) => {
    if (inBal === null || !t) return;
    const v = (inBal * BigInt(p)) / 100n;
    setAmount(formatUnits(v, t.inDec));
  };
  const saving = useMemo(() => (avenFee === null ? null : plainFee - avenFee), [avenFee, plainFee]);

  // Prefill triggers around the current price when switching type, so the defaults are valid.
  useEffect(() => {
    if (!(price > 0)) return;
    const up = (bp: number) => (price * (1 + bp / 10_000)).toFixed(2);
    if (type === "limit") setTrigger(up(buy ? -50 : 50));
    if (type === "stop") setTrigger(up(buy ? 50 : -50));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, side]);
  useEffect(() => {
    if (!bracket || !(price > 0)) return;
    const up = (bp: number) => (price * (1 + bp / 10_000)).toFixed(2);
    setTp(up(buy ? 100 : -100));
    setSl(up(buy ? -50 : 50));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket, side]);

  const submit = async () => {
    setNote(null);
    if (!owner) return;
    if (type !== "market") {
      addOrders([{ owner, pool, side, kind: condKind, amount, trigger: trig }]);
      setNote(`${KIND_LABEL[condKind]} ${buy ? "buy" : "sell"} placed. This tab watches it and asks your wallet to sign when the pool hits ${num(trig, 2)}.`);
      setAmount("");
      return;
    }
    const r = await s.execute(pool, side, amount, oracle);
    if (r.ok && bracket) {
      // Close the position just opened: sell what a buy received (or buy back with what a sell received), at 99%
      // of the quote so price impact and rounding can't make the closing swap ask for more than the wallet holds.
      const closeAmt = (out * 0.99).toFixed(buy ? 4 : 2);
      const legs: Omit<Order, "id" | "createdAt" | "status">[] = [];
      if (tp) legs.push({ owner, pool, side: closeSide, kind: "tp", amount: closeAmt, trigger: Number(tp) });
      if (sl) legs.push({ owner, pool, side: closeSide, kind: "sl", amount: closeAmt, trigger: Number(sl) });
      addOrders(legs);
      setNote(`Filled. ${legs.map((l) => `${KIND_LABEL[l.kind]} at ${num(l.trigger, 2)}`).join(" and ")} placed${legs.length === 2 ? " (one cancels the other)" : ""}.`);
    }
  };

  useOrderEngine(s, mine, a.state);

  const label = type === "market" ? `${buy ? "Buy" : "Sell"} ${amount} ${sym}` : `Place ${type} ${buy ? "buy" : "sell"}`;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="grid grid-cols-2 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Side">
        {(["buyBase", "sellBase"] as const).map((d) => {
          const on = side === d;
          const isBuy = d === "buyBase";
          return (
            <button
              key={d}
              role="radio"
              aria-checked={on}
              onClick={() => setSide(d)}
              className={`rounded-lg py-2.5 text-[15px] font-medium transition ${on ? "text-bg" : "text-muted hover:text-ink"}`}
              style={on ? { background: isBuy ? BUY : SELL } : undefined}
            >
              {isBuy ? "Buy" : "Sell"}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex gap-4 border-b border-line text-xs" role="tablist" aria-label="Order type">
        {(["market", "limit", "stop"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={type === k}
            onClick={() => setType(k)}
            className={`-mb-px border-b-2 pb-2 capitalize transition ${type === k ? "border-mint text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {k}
          </button>
        ))}
      </div>

      <p className="mb-1.5 mt-4 text-[11px] text-muted">Pool</p>
      <div className="grid grid-cols-2 gap-2">
        {(["aven", "control"] as const).map((p) => {
          const f = feeFor(a.state, p, side);
          return (
            <button
              key={p}
              onClick={() => setPool(p)}
              aria-pressed={pool === p}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${pool === p ? "border-mint/50 bg-raised" : "border-line hover:border-line-strong"}`}
            >
              <span className="flex items-center gap-1.5 text-xs text-ink">
                <span className="h-2 w-2 rounded-full" style={{ background: p === "aven" ? "var(--color-aven)" : "var(--color-plain)" }} />
                {p === "aven" ? "Aven" : "Plain 0.30%"}
              </span>
              <span className="num mt-1 block text-sm text-ink-2">{f === null ? "—" : pipsPct(f)}</span>
            </button>
          );
        })}
      </div>

      {type !== "market" && (
        <PriceInput
          label={`Trigger price (pool, ${m?.tokens.quoteSymbol ?? "aUSD"})`}
          value={trigger}
          onChange={setTrigger}
          hint={type === "limit" ? (buy ? "fills at or below" : "fills at or above") : buy ? "fills at or above" : "fills at or below"}
        />
      )}

      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-[11px] text-muted">Amount</p>
        {inBal !== null && t && (
          <p className="num text-[11px] text-muted">
            Balance {num(Number(formatUnits(inBal, t.inDec)), 4)} {t.inSym}
          </p>
        )}
      </div>
      <div className="mt-1.5 flex items-center rounded-xl border border-line bg-bg focus-within:border-mint/50">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="Amount"
          className="num min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[15px] text-ink placeholder:text-faint focus:outline-none"
        />
        <span className="pr-3.5 text-xs text-ink-2">{t?.inSym ?? "—"}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {[25, 50, 75, 100].map((p) => (
          <button key={p} onClick={() => pct(p)} disabled={inBal === null} className="num rounded-lg border border-line py-1.5 text-[11px] text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40">
            {p}%
          </button>
        ))}
      </div>

      {type === "market" && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <label className="flex cursor-pointer items-center justify-between text-xs text-ink">
            <span>Take profit / stop loss</span>
            <input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} className="h-4 w-4 accent-[var(--color-aven)]" />
          </label>
          {bracket && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <PriceInput label="Take profit" value={tp} onChange={setTp} compact />
              <PriceInput label="Stop loss" value={sl} onChange={setSl} compact />
              <p className="col-span-2 text-[10px] leading-snug text-faint">
                After the fill, a {buy ? "sell" : "buy"} of what you received is placed at each price; when one fills the other is cancelled.
              </p>
            </div>
          )}
        </div>
      )}

      <dl className="mt-4 space-y-2 text-xs">
        <Row k="Pool price" v={price ? num(price, 2) : "—"} />
        <Row k="You receive ≈" v={out ? `${num(out, side === "sellBase" ? 2 : 4)} ${t?.outSym ?? ""}` : "—"} hint={type === "market" ? "before price impact" : "at today's price"} />
        <Row k="LP fee" v={fee === null ? "—" : `${pipsPct(fee)} · ${usd((inUsd * fee) / 1e6)}`} hint={type === "market" ? undefined : "now; set again at the trigger block"} />
        <Row k="Plain pool would charge" v={pipsPct(plainFee)} />
        <Row k="Network fee ≈" v={gasHype === null ? "—" : `${gasHype.toFixed(6)} HYPE`} />
      </dl>
      {pool === "aven" && (
        <div className="mt-3 rounded-xl border border-line bg-bg/60 p-3">
          <p className="text-[11px] text-muted">Why this fee</p>
          <div className="mt-1.5 flex flex-wrap gap-1">{terms.length ? terms.map((x) => <TermChip key={x} term={x} />) : <span className="text-[11px] text-faint">no live quote</span>}</div>
          {saving !== null && (
            <p className="mt-2 text-[11px] text-ink-2">
              {saving > 0
                ? `${pipsPct(saving)} cheaper than the plain pool right now.`
                : saving < 0
                  ? `${pipsPct(-saving)} more than the plain pool, from the terms above. The extra goes to LPs.`
                  : "Same as the plain pool."}
            </p>
          )}
        </div>
      )}

      <div className="pt-5">
        {!s.wallet.authenticated && s.wallet.enabled ? (
          <button onClick={s.wallet.login} className="btn btn-primary w-full">
            Connect wallet to trade
          </button>
        ) : s.wallet.wrongChain ? (
          <button onClick={() => void s.wallet.switchChain()} className="btn btn-primary w-full">
            Switch network
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={!!blocker || !!s.step}
            className="btn w-full font-semibold text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: buy ? BUY : SELL }}
          >
            {s.step ?? blocker ?? label.replace(/\s+/g, " ")}
          </button>
        )}
        <p className="mt-2 text-[11px] text-faint">Spot only: no leverage, no liquidation. Limit, stop and TP / SL orders run in this tab and ask your wallet to sign when they trigger.</p>
        {config.chainId === 999 && <p className="mt-1 text-[11px] text-faint">{MAINNET_GAS_NOTE}</p>}
        {s.error && <p className="mt-2 text-[11px] text-crit">{s.error}</p>}
        {note && <p className="mt-2 text-[11px] text-ink-2">{note}</p>}
        {s.last && (
          <p className="mt-2 text-[11px] text-ink-2">
            Filled: <TxLink hash={s.last} />
          </p>
        )}
      </div>

      <OpenOrders orders={mine} sym={sym} quoteSym={m?.tokens.quoteSymbol ?? "aUSD"} />
    </div>
  );
}

/**
 * Watches this wallet's open orders on every new block and fills the first one whose trigger the pool price hit.
 * One swap at a time; a fill cancels its one-cancels-other partner. Never runs a swap the panel's own checks block.
 */
function useOrderEngine(s: ReturnType<typeof useSwap>, mine: Order[], state: ReturnType<typeof useArena>["state"]) {
  const busy = useRef(false);
  const block = state?.block ?? null;
  useEffect(() => {
    if (busy.current || s.step || !state || !s.wallet.address || s.wallet.wrongChain) return;
    const due = mine.find((o) => o.status === "open" && triggered(o, state.pools[o.pool].price));
    if (!due) return;
    const blocked = s.blocker(Number(due.amount) || 0, due.side);
    if (blocked) {
      updateOrder(due.id, { status: "failed", error: blocked });
      return;
    }
    busy.current = true;
    updateOrder(due.id, { status: "triggered" });
    void s.execute(due.pool, due.side, due.amount, state.oracle.price).then((r) => {
      busy.current = false;
      if (r.ok) {
        updateOrder(due.id, { status: "filled", tx: r.hash ?? undefined, filledAt: Date.now() });
        if (due.ocoWith) cancelOrder(due.ocoWith);
      } else updateOrder(due.id, { status: "failed", error: r.error ?? "swap failed" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, mine]);
}

function OpenOrders({ orders, sym, quoteSym }: { orders: Order[]; sym: string; quoteSym: string }) {
  const open = orders.filter((o) => o.status === "open" || o.status === "triggered");
  const recent = orders.filter((o) => o.status === "filled" || o.status === "failed").slice(-4).reverse();
  if (!open.length && !recent.length) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[11px] text-muted">Orders ({open.length} open)</p>
      <ul className="mt-2 space-y-1.5 text-[11px]">
        {[...open, ...recent].map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5">
            <span className="min-w-0">
              <span style={{ color: o.side === "buyBase" ? BUY : SELL }}>{o.side === "buyBase" ? "Buy" : "Sell"}</span>{" "}
              <span className="text-ink">{KIND_LABEL[o.kind]}</span>{" "}
              <span className="num text-ink-2">
                {num(Number(o.amount), 4)} {o.side === "sellBase" ? sym : quoteSym} @ {num(o.trigger, 2)}
              </span>{" "}
              <span className="text-faint">· {o.pool === "aven" ? "Aven" : "plain"}</span>
              {o.status === "failed" && o.error && <span className="block truncate text-crit">{o.error}</span>}
            </span>
            {o.status === "open" ? (
              <button onClick={() => cancelOrder(o.id)} className="shrink-0 text-muted hover:text-ink" aria-label="Cancel order">
                Cancel
              </button>
            ) : o.status === "triggered" ? (
              <span className="shrink-0 text-warn">signing…</span>
            ) : o.status === "filled" && o.tx ? (
              <span className="shrink-0">
                <TxLink hash={o.tx}>filled</TxLink>
              </span>
            ) : (
              <span className="shrink-0 text-faint">{o.status}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PriceInput({ label, value, onChange, hint, compact }: { label: string; value: string; onChange: (v: string) => void; hint?: string; compact?: boolean }) {
  return (
    <label className={`block ${compact ? "" : "mt-4"} text-[11px] text-muted`}>
      {label}
      {hint && <span className="ml-1 text-faint">({hint})</span>}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        className="num mt-1 block w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-mint/50 focus:outline-none"
      />
    </label>
  );
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">
        {k}
        {hint && <span className="ml-1 text-faint">({hint})</span>}
      </dt>
      <dd className="num text-right text-ink">{v}</dd>
    </div>
  );
}
