"use client";
/**
 * Order panel. Long = buy aETH, Short = sell aETH, as a spot swap on the chosen pool (no leverage, no liquidation:
 * Aven reads the perp market, it never trades it, AGENTS.md §6). Shows the fee before you sign, against the plain pool.
 */
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { TermChip, TxLink } from "@/components/ui";
import { useArena } from "@/lib/arena";
import { num, pipsPct, usd } from "@/lib/format";
import { termsFired } from "@/lib/steps";
import { feeFor, indicativeOut, SWAP_GAS_BUDGET, tokenSide, useBalances, useSwap } from "@/lib/swap";
import type { Direction, PoolName } from "@/lib/types";

const SWAP_GAS = 180_000n; // a full swap through the test router, p50 (docs/PROOFS.md ~175k)

export function OrderPanel() {
  const a = useArena();
  const s = useSwap();
  const m = a.math; // labels + decimals (real deployment, else the recording's)
  const [side, setSide] = useState<Direction>("buyBase");
  const [pool, setPool] = useState<PoolName>("aven");
  const [amount, setAmount] = useState("");
  const bal = useBalances(s.deployments, s.wallet.address, s.last);

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
  const blocker = s.blocker(amt) ?? (!gasOk ? "Not enough HYPE for gas" : null);

  const pct = (p: number) => {
    if (inBal === null || !t) return;
    const v = (inBal * BigInt(p)) / 100n;
    setAmount(formatUnits(v, t.inDec));
  };

  const saving = useMemo(() => (avenFee === null ? null : plainFee - avenFee), [avenFee, plainFee]);
  const long = side === "buyBase";

  return (
    <div className="flex h-full flex-col p-4">
      <div className="grid grid-cols-2 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Side">
        {(["buyBase", "sellBase"] as const).map((d) => {
          const on = side === d;
          const isLong = d === "buyBase";
          return (
            <button
              key={d}
              role="radio"
              aria-checked={on}
              onClick={() => setSide(d)}
              className={`rounded-lg py-2.5 text-[15px] font-medium transition ${on ? (isLong ? "bg-[#22c08a] text-bg" : "bg-[#e5534b] text-bg") : "text-muted hover:text-ink"}`}
            >
              {isLong ? "Long" : "Short"}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {long ? "Buy" : "Sell"} {m?.tokens.baseSymbol ?? "aETH"} spot · no leverage, no liquidation
      </p>

      <p className="mb-1.5 mt-5 text-[11px] text-muted">Pool</p>
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

      <div className="mt-5 flex items-baseline justify-between">
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

      <dl className="mt-5 space-y-2 text-xs">
        <Row k="Pool price" v={price ? num(price, 2) : "—"} />
        <Row k="You receive ≈" v={out ? `${num(out, side === "sellBase" ? 2 : 4)} ${t?.outSym ?? ""}` : "—"} hint="before price impact" />
        <Row k="LP fee" v={fee === null ? "—" : `${pipsPct(fee)} · ${usd((inUsd * fee) / 1e6)}`} />
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

      <div className="mt-auto pt-5">
        {!s.wallet.authenticated && s.wallet.enabled ? (
          <button onClick={s.wallet.login} className="btn btn-primary w-full">
            Log in to trade
          </button>
        ) : s.wallet.wrongChain ? (
          <button onClick={() => void s.wallet.switchChain()} className="btn btn-primary w-full">
            Switch network
          </button>
        ) : (
          <button
            onClick={() => void s.execute(pool, side, amount, oracle)}
            disabled={!!blocker || !!s.step}
            className={`btn w-full font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40 ${long ? "bg-[#22c08a] hover:brightness-110" : "bg-[#e5534b] hover:brightness-110"}`}
          >
            {s.step ?? blocker ?? `${long ? "Long" : "Short"} ${amount} ${m?.tokens.baseSymbol ?? ""}`.replace(/\s+/g, " ")}
          </button>
        )}
        {s.error && <p className="mt-2 text-[11px] text-crit">{s.error}</p>}
        {s.last && (
          <p className="mt-2 text-[11px] text-ink-2">
            Filled: <TxLink hash={s.last} />
          </p>
        )}
      </div>
    </div>
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
