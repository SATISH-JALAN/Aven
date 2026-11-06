"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Empty, MatchBadge, Notice, Skeleton, Src, TermChip, TxLink, UsdNote } from "@/components/ui";
import type { Deployments } from "@/config";
import { useArena } from "@/lib/arena";
import { int, pipsPct, timeUtc, units, usd } from "@/lib/format";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { feeSteps, inputsFromRecord, termsFired } from "@/lib/steps";
import type { Trade, VerifyResult } from "@/lib/types";

export function amountLabel(t: Trade, d: Deployments | null): string {
  if (!d) return t.amountIn;
  const c = d.config;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  // buyBase pays quote in; sellBase pays base in.
  return t.direction === "buyBase" ? `${units(t.amountIn, quoteDec, 2)} ${d.tokens.quoteSymbol}` : `${units(t.amountIn, baseDec, 4)} ${d.tokens.baseSymbol}`;
}

export function TradeTape({ extra = [] }: { extra?: Trade[] }) {
  const { trades, math: deployments, status } = useArena();
  const [filter, setFilter] = useState<"all" | "aven" | "control">("all");
  const [open, setOpen] = useState<Trade | null>(null);
  const list = useMemo(() => [...extra, ...trades].filter((t) => filter === "all" || t.pool === filter).slice(0, 100), [trades, extra, filter]);
  const body = useRef<HTMLTableSectionElement>(null);
  const seen = useRef(new Set<string>());
  const threshold = deployments?.params.stressThresholdBps ?? 50;

  // New rows slide in (after the first render).
  useGSAP(
    () => {
      const rows = Array.from(body.current?.querySelectorAll<HTMLTableRowElement>("tr[data-id]") ?? []);
      const fresh = rows.filter((r) => !seen.current.has(r.dataset.id!));
      const first = seen.current.size === 0;
      fresh.forEach((r) => seen.current.add(r.dataset.id!));
      if (first || !fresh.length) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(fresh, { autoAlpha: 0, x: -24, backgroundColor: "rgba(25,158,112,0.18)", duration: 1.1, ease: "expo.out", stagger: 0.05, clearProps: "backgroundColor" });
      });
    },
    { dependencies: [list.map((t) => t.id).join(",")], scope: body },
  );

  return (
    <Card data-reveal>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">Trade tape</p>
          <Src>Arena bot log + receipts (FeeComputed) · newest first · click a row for the fee proof</Src>
        </div>
        <div className="flex rounded-full border border-line p-0.5 text-xs" role="radiogroup" aria-label="Filter by pool">
          {(
            [
              ["all", "All"],
              ["aven", "Aven"],
              ["control", "Plain"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 transition ${filter === k ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {status === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : list.length === 0 ? (
        <Empty>No trades yet{filter !== "all" ? " for this pool" : ""}.</Empty>
      ) : (
        <div className="no-scrollbar -mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="text-xs text-muted">
              <tr>
                {["Time (UTC)", "Pool", "Side", "Size in", "Fee", "Terms fired", "Bot profit", "LP fee", "Tx", ""].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={body}>
              {list.map((t) => (
                <tr key={t.id} data-id={t.id} onClick={() => setOpen(t)} className="cursor-pointer border-t border-line/70 transition hover:bg-raised/70">
                  <td className="num py-2.5 pr-3 text-ink-2">{timeUtc(t.ts)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-1.5 text-ink">
                      <span className="h-2 w-2 rounded-full" style={{ background: t.pool === "aven" ? "var(--color-aven)" : "var(--color-plain)" }} />
                      {t.pool === "aven" ? "Aven" : "Plain"}
                      <span className="text-faint">{t.kind === "arb" ? "bot" : t.id.startsWith("you:") ? "you" : "shock"}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">{t.direction === "buyBase" ? "buy" : "sell"}</td>
                  <td className="num py-2.5 pr-3 text-ink-2">{amountLabel(t, deployments)}</td>
                  <td className="num py-2.5 pr-3 text-ink">{pipsPct(t.feePips)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {t.breakdown ? termsFired(t.breakdown, threshold).map((x) => <TermChip key={x} term={x} />) : <span className="text-faint">fixed</span>}
                    </span>
                  </td>
                  <td className="num py-2.5 pr-3 text-ink-2">{t.kind === "arb" ? usd(t.botProfitUsd) : "—"}</td>
                  <td className="num py-2.5 pr-3 text-ink-2">{usd(t.lpFeeIncomeUsd)}</td>
                  <td className="py-2.5 pr-3" onClick={(e) => e.stopPropagation()}>
                    <TxLink hash={t.txHash} />
                  </td>
                  <td className="py-2.5">{t.verify ? <MatchBadge ok={t.verify.checkA && t.verify.checkB} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UsdNote className="mt-3" />
      {open && <TradeDrawer trade={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ drawer

export function TradeDrawer({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const { verify, math: deployments } = useArena();
  const [v, setV] = useState<VerifyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const hooked = trade.pool === "aven";

  useEffect(() => {
    if (!hooked) return;
    let alive = true;
    verify(trade.txHash).then(
      (r) => alive && setV(r),
      (e: Error) => alive && setErr(e.message),
    );
    return () => {
      alive = false;
    };
  }, [trade.txHash, hooked, verify]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from(shade.current, { autoAlpha: 0, duration: 0.4 });
      gsap.from(panel.current, { xPercent: 100, duration: 0.7, ease: "expo.out" });
      gsap.from(panel.current!.querySelectorAll("[data-row]"), { autoAlpha: 0, y: 12, stagger: 0.04, delay: 0.25, duration: 0.6 });
    });
    return () => mm.revert();
  }, []);

  const close = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    gsap.to(panel.current, { xPercent: 100, duration: 0.4, ease: "power3.in" });
    gsap.to(shade.current, { autoAlpha: 0, duration: 0.4, onComplete: onClose });
  };

  const steps = v && deployments ? feeSteps(deployments.config, deployments.params, inputsFromRecord(v.inputs)) : null;
  const browserMatch = steps ? steps.fee === v!.onchainFee && steps.consistent : null;

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Trade detail">
      <div ref={shade} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div ref={panel} className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-bg p-6 shadow-2xl">
        <div data-row className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink">Trade detail</p>
          <button onClick={close} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink" aria-label="Close">
            Esc ✕
          </button>
        </div>
        <div data-row className="mt-5 grid grid-cols-2 gap-3 text-xs">
          <Kv k="Pool" v={hooked ? "Aven (hooked)" : "Plain 0.30%"} />
          <Kv k="Kind" v={trade.kind === "arb" ? "bot arbitrage" : "shock / retail"} />
          <Kv k="Side" v={trade.direction === "buyBase" ? "buy base" : "sell base"} />
          <Kv k="Size in" v={amountLabel(trade, deployments)} />
          <Kv k="Fee" v={`${pipsPct(trade.feePips)} · ${int(trade.feePips)} pips`} />
          <Kv k="LP fee" v={usd(trade.lpFeeIncomeUsd)} />
          <Kv k="Block" v={`#${int(trade.block)}`} />
          <Kv k="Tx" v={<TxLink hash={trade.txHash} />} />
        </div>

        {!hooked ? (
          <div data-row className="mt-6">
            <Notice title="No hook on this pool">The plain pool charges its static 3,000 pips on every swap; there is no FeeComputed event to recompute.</Notice>
          </div>
        ) : err ? (
          <div data-row className="mt-6">
            <Notice tone="warn" title="Could not load the fee inputs">
              {err}
            </Notice>
          </div>
        ) : !v ? (
          <Skeleton className="mt-6 h-64 w-full" />
        ) : (
          <>
            <p data-row className="mt-7 text-[13px] text-muted">
              Raw FeeComputed inputs
            </p>
            <div data-row className="mt-2 rounded-[20px] border border-line bg-surface p-4">
              {[
                ["oracleRaw", v.inputs.oracleRaw],
                ["markRaw", v.inputs.markRaw],
                ["anchorMarkRaw (previous mark anchor)", v.inputs.anchorMarkRaw],
                ["sqrtPriceX96", v.inputs.sqrtPriceX96],
                ["sqrtPriceTopX96 (top of block)", v.inputs.sqrtPriceTopX96],
                ["zeroForOne", v.inputs.zeroForOne],
                ["fallback used", v.inputs.reason && v.inputs.reason !== "OK" ? `yes (${v.inputs.reason})` : "no"],
              ].map(([k, val]) => (
                <div key={k} className="flex items-start justify-between gap-4 border-b border-line/60 py-1.5 last:border-0">
                  <span className="text-[11px] text-muted">{k}</span>
                  <span className="num break-all text-right text-[11px] text-ink">{val}</span>
                </div>
              ))}
            </div>
            <div data-row className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Fee label="On-chain (event)" v={v.onchainFee} />
              <Fee label="Recomputed in your browser" v={steps?.fee ?? null} />
              <Fee label="PoolManager Swap" v={v.swapEventFee} />
            </div>
            <div data-row className="mt-5 flex items-center justify-between">
              <MatchBadge ok={!!browserMatch && v.checkB} size="lg" />
              <Link href={`/verify/${trade.txHash}`} className="text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
                Full step-by-step proof →
              </Link>
            </div>
            <p data-row className="mt-3 text-[11px] text-faint">
              Recomputed with the exact BigInt port (@aven/core) from the logged inputs; checked against 10,000 Solidity vectors. Check B compares the fee the PoolManager
              actually charged.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/70 px-3 py-2">
      <p className="text-xs text-faint">{k}</p>
      <p className="num mt-0.5 text-ink">{v}</p>
    </div>
  );
}

function Fee({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="rounded-2xl border border-line px-3 py-3">
      <p className="num text-lg text-ink">{v === null ? "—" : int(v)}</p>
      <p className="mt-1 text-[10px] leading-tight text-muted">{label}</p>
    </div>
  );
}
