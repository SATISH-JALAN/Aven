"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { ArenaChart, Controls } from "@/components/arena/Controls";
import { Earnings } from "@/components/trade/Activity";
import { useReveal } from "@/components/motion";
import { UsePageMode } from "@/components/shell";
import { Card, Details, PageHero, SectionHead, TxLink } from "@/components/ui";
import { useArena } from "@/lib/arena";
import { useBlockNumber, publicClient } from "@/lib/chain";
import { bps, num, pipsPct, signedUsd } from "@/lib/format";
import { planLiquidity, useAddLiquidity } from "@/lib/liquidity";
import { POOLS, type ReplayFile } from "@/lib/replay";
import { feeFor } from "@/lib/swap";
import type { PoolName } from "@/lib/types";

function Section({ eyebrow, title, lede, children, deps }: { eyebrow: string; title: string; lede?: string; children: React.ReactNode; deps?: unknown[] }) {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref, deps);
  return (
    <section ref={ref} className="mx-auto max-w-7xl px-6 py-14 md:py-16">
      <SectionHead eyebrow={eyebrow} title={title} lede={lede} />
      {children}
    </section>
  );
}

export default function PoolPage() {
  const a = useArena();
  return (
    <>
      <UsePageMode mode={a.mode === "LIVE" && a.status === "ok" ? "LIVE" : a.mode === "RECORDED" ? "RECORDED" : null} />
      <PageHero eyebrow="Pool" title="Provide liquidity. Keep the gap." lede="Arbitrage always pays someone. On the Aven pool, most of it goes to you." />

      <Section eyebrow="Pools" title="Two pools, one market." deps={[!!a.state]}>
        <div className="grid gap-4 md:grid-cols-2">
          <PoolTile which="aven" />
          <PoolTile which="control" />
        </div>
      </Section>

      <Section eyebrow="Earnings" title="Who earned what." lede="Same shocks, same bot. Both sides earn; on Aven the LPs keep the bigger share." deps={[!!a.stats]}>
        <Card data-reveal className="p-0">
          <Earnings />
        </Card>
        <p className="mt-3 text-[11px] text-faint">
          {a.mode === "LIVE" && a.status === "ok" ? "Live Arena stats (bot trades only)." : "Recorded Arena run (bot trades only)."} $ values at the HyperCore oracle price.
        </p>
      </Section>

      <Section eyebrow="Over time" title="Six hours of real data." lede="Oct 29, Binance down, Hyperliquid trading. Four pools, same flow, only the fee differs.">
        <ReplaySummary />
      </Section>

      <Section eyebrow="Cost" title="Cheap per swap.">
        <GasTiles />
      </Section>

      <Section eyebrow="Provide" title="Add liquidity." deps={[!!a.state]}>
        <AddLiquidity />
      </Section>

      <section className="mx-auto max-w-7xl px-6 pb-10">
        <Details summary="Operator controls (Arena admin)">
          <div className="space-y-4">
            <Controls />
            <ArenaChart />
          </div>
        </Details>
      </section>
    </>
  );
}

function PoolTile({ which }: { which: PoolName }) {
  const a = useArena();
  const p = a.state?.pools[which];
  const aven = which === "aven";
  const buy = feeFor(a.state, which, "buyBase");
  const sell = feeFor(a.state, which, "sellBase");
  const sym = a.math?.tokens;
  return (
    <Card data-reveal className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${aven ? "var(--color-aven)" : "var(--color-plain)"}, transparent)` }} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[17px] font-medium tracking-[-0.02em] text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: aven ? "var(--color-aven)" : "var(--color-plain)" }} />
            {aven ? "Aven pool" : "Plain pool"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {sym ? `${sym.baseSymbol} / ${sym.quoteSymbol}` : "—"} · {aven ? "fee from the perp market" : "fixed 0.30%"}
          </p>
        </div>
        <Link href="/trade" className="btn btn-ghost btn-sm">
          Trade
        </Link>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Kv k="Price" v={p ? num(p.price, 2) : "—"} />
        <Kv k="Gap vs oracle" v={p ? bps(p.gapBps) : "—"} warn={!!p && Math.abs(p.gapBps) >= 30} />
        <Kv k="Fee · buy" v={buy === null ? "—" : pipsPct(buy)} />
        <Kv k="Fee · sell" v={sell === null ? "—" : pipsPct(sell)} />
      </dl>
    </Card>
  );
}

function Kv({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className={`num mt-1 text-xl ${warn ? "text-warn" : "text-ink"}`}>{v}</dd>
    </div>
  );
}

function ReplaySummary() {
  const [f, setF] = useState<ReplayFile | null>(null);
  useEffect(() => {
    fetch("/replay/binance-halt.json")
      .then((r) => r.json())
      .then(setF)
      .catch(() => setF(null));
  }, []);
  if (!f) return <div className="h-40 animate-pulse rounded-[28px] border border-line bg-surface" />;
  const rows = POOLS.map((p) => {
    const r = f.results[p.id];
    return { ...p, vsHodl: Number(r.lpValueUsd) - Number(r.hodlValueUsd), fees: Number(r.feesEarnedUsd), arbs: r.arbTrades };
  });
  const max = Math.max(...rows.map((r) => Math.abs(r.vsHodl)));
  return (
    <Card data-reveal>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[150px_1fr_90px] items-center gap-4 sm:grid-cols-[180px_1fr_110px_120px]">
            <p className="flex items-center gap-2 text-sm text-ink">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </p>
            <div className="relative h-2.5 rounded-full bg-raised">
              <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
              <div
                className="absolute inset-y-0 rounded-full"
                style={{ background: r.color, opacity: r.dashed ? 0.6 : 1, width: `${(Math.abs(r.vsHodl) / max) * 50}%`, left: r.vsHodl >= 0 ? "50%" : `${50 - (Math.abs(r.vsHodl) / max) * 50}%` }}
              />
            </div>
            <p className={`num text-right text-sm ${r.vsHodl >= 0 ? "text-ink" : "text-crit"}`}>{signedUsd(r.vsHodl)}</p>
            <p className="num hidden text-right text-xs text-muted sm:block">{r.arbs} arb trades</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[11px] text-faint">LP value minus holding, after six hours · Replay.t.sol over Hyperliquid mainnet candles · $ at the oracle proxy</p>
        <Link href="/replay" className="text-xs text-ink underline decoration-line-strong underline-offset-4 hover:text-mint">
          Run the replay →
        </Link>
      </div>
    </Card>
  );
}

/** Measured gas (docs/PROOFS.md, docs/LOADTEST.md, recon C.5) and the chain's gas price right now. */
function GasTiles() {
  const rpc = useBlockNumber();
  const [gp, setGp] = useState<bigint | null>(null);
  useEffect(() => {
    publicClient()
      .getGasPrice()
      .then(setGp)
      .catch(() => setGp(null));
  }, [rpc.block]);
  const hype = (gas: bigint) => (gp === null ? "—" : `${Number(formatUnits(gas * gp, 18)).toFixed(6)} HYPE`);
  const tiles = [
    { v: "~175k", k: "gas per swap", s: hype(175_000n) },
    { v: "~46.9k", k: "of that is the hook", s: "two precompile reads + fee math" },
    { v: "≤ 3.1k", k: "per precompile read", s: "capped at 30k, never reverts" },
    { v: "~16", k: "Aven swaps per 3M-gas block", s: "HyperEVM small block" },
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-[28px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.k} data-reveal className="bg-surface p-7">
          <p className="num text-4xl tracking-[-0.04em] text-ink">{t.v}</p>
          <p className="mt-2 text-sm text-ink-2">{t.k}</p>
          <p className="num mt-1 text-[11px] text-muted">{t.s}</p>
        </div>
      ))}
    </div>
  );
}

function AddLiquidity() {
  const a = useArena();
  const d = a.deployments;
  const m = a.math;
  const lq = useAddLiquidity(d);
  const [pool, setPool] = useState<PoolName>("aven");
  const [range, setRange] = useState(10);
  const [amount, setAmount] = useState("1");
  const price = a.state?.pools[pool].price ?? 0;
  const plan = useMemo(() => (m ? planLiquidity(m, pool, price, range, Number(amount) || 0) : null), [m, pool, price, range, amount]);
  const live = a.mode === "LIVE" && !!d && d.liquidityRouter?.length === 42;
  const blocker = !live
    ? "Needs the live deployment"
    : !lq.wallet.enabled
      ? "Login is not configured"
      : !lq.wallet.authenticated
        ? null
        : lq.wallet.wrongChain
          ? null
          : !plan
            ? "Enter an amount"
            : null;

  return (
    <Card data-reveal>
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-[11px] text-muted">Pool</p>
            <div className="grid grid-cols-2 gap-2">
              {(["aven", "control"] as const).map((p) => (
                <button key={p} onClick={() => setPool(p)} aria-pressed={pool === p} className={`rounded-xl border px-4 py-3 text-left text-sm transition ${pool === p ? "border-mint/50 bg-raised text-ink" : "border-line text-ink-2 hover:border-line-strong"}`}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: p === "aven" ? "var(--color-aven)" : "var(--color-plain)" }} />
                    {p === "aven" ? "Aven" : "Plain 0.30%"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] text-muted">Range around the pool price</p>
            <div className="flex rounded-full border border-line p-0.5 text-xs" role="radiogroup" aria-label="Range">
              {[5, 10, 25, 50].map((r) => (
                <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={`flex-1 rounded-full py-2 transition ${range === r ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
                  ±{r}%
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[11px] text-muted">Deposit ({m?.tokens.baseSymbol ?? "base"})</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="num w-full rounded-xl border border-line bg-bg px-4 py-3 text-[15px] text-ink focus:border-mint/50 focus:outline-none"
            />
          </label>
        </div>
        <div className="flex flex-col rounded-2xl border border-line bg-bg/60 p-5">
          <dl className="space-y-3 text-sm">
            <Line k={`${m?.tokens.baseSymbol ?? "Base"} in`} v={plan ? num(plan.baseAmount, 4) : "—"} />
            <Line k={`${m?.tokens.quoteSymbol ?? "Quote"} in`} v={plan ? num(plan.quoteAmount, 2) : "—"} />
            <Line k="Price range" v={plan ? `${num(plan.priceLower, 2)} – ${num(plan.priceUpper, 2)}` : "—"} />
            <Line k="Ticks" v={plan ? `${plan.tickLower} → ${plan.tickUpper}` : "—"} />
          </dl>
          <p className="mt-4 text-[11px] text-muted">Demo tokens are open-mint: missing balance is minted first. Fees accrue to the position inside the PoolManager.</p>
          <div className="mt-auto pt-5">
            {lq.wallet.enabled && !lq.wallet.authenticated ? (
              <button onClick={lq.wallet.login} className="btn btn-primary w-full">
                Log in to add liquidity
              </button>
            ) : lq.wallet.wrongChain ? (
              <button onClick={() => void lq.wallet.switchChain()} className="btn btn-primary w-full">
                Switch network
              </button>
            ) : (
              <button onClick={() => plan && void lq.add(pool, plan)} disabled={!!blocker || !!lq.step} className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40">
                {lq.step ?? blocker ?? `Add liquidity to the ${pool === "aven" ? "Aven" : "plain"} pool`}
              </button>
            )}
            {lq.error && <p className="mt-2 text-[11px] text-crit">{lq.error}</p>}
            {lq.last && (
              <p className="mt-2 text-[11px] text-ink-2">
                Added: <TxLink hash={lq.last} />
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="num text-ink">{v}</dd>
    </div>
  );
}
