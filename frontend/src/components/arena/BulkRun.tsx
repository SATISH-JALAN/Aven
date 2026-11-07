"use client";
/**
 * Bulk run (Arena POST /burst): N rounds of "shock both pools, then the bot's pass in a later block", run by the Arena
 * service with its own wallet on the live chain. It shows, round by round, which block each shock landed in, which
 * block each arb landed in, and the fee each pool charged for it. The hooked pool prices the gap the shock opened, in
 * that block, from HyperCore's oracle and mark; the plain pool charges its flat 0.30% whatever happened.
 *
 * Progress comes from GET /burst (public), so anyone watching the dashboard sees a run an operator started. Starting
 * or stopping one needs the admin token, like every other control.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Empty, Notice, Src, TxLink } from "@/components/ui";
import { config } from "@/config";
import { arenaGet, useArena } from "@/lib/arena";
import { int, num, pipsPct } from "@/lib/format";

type Arb = { pool: "aven" | "control"; txHash: string; block: number; feePips: number };
type Round = { round: number; direction: "buyBase" | "sellBase"; sizeBase: string; shockBlock: number; oracleRaw: string; shockTxs: string[]; arbs: Arb[] };
type Burst = { id: string; status: "idle" | "running" | "done" | "stopped" | "error"; startedAt?: number; endedAt?: number | null; rounds?: number; error?: string | null; results?: Round[] };

const MAX_ROUNDS = 20;

export function BulkRun() {
  const a = useArena();
  const live = a.mode === "LIVE";
  const can = live && !!a.adminToken;
  const [b, setB] = useState<Burst | null>(null);
  const [rounds, setRounds] = useState("6");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const running = b?.status === "running";

  // Poll the run: every 1.5 s while it runs, every 10 s otherwise (someone else may start one).
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await arenaGet<Burst>("/burst");
        if (alive) setB(r);
      } catch {
        /* the Arena's own banner reports outages */
      }
    };
    void tick();
    const t = setInterval(tick, running ? 1_500 : 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [live, running]);

  const sz = a.math?.config.szDecimals ?? 4;
  const sym = a.math?.tokens.baseSymbol ?? "base";
  const results = useMemo(() => b?.results ?? [], [b]);
  const summary = useMemo(() => {
    const aven = results.flatMap((r) => r.arbs.filter((x) => x.pool === "aven").map((x) => ({ ...x, after: x.block - r.shockBlock })));
    const plain = results.flatMap((r) => r.arbs.filter((x) => x.pool === "control"));
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    return { aven, plain, avenFee: avg(aven.map((x) => x.feePips)), avenAfter: avg(aven.map((x) => x.after)) };
  }, [results]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = (await a.post("/burst", { rounds: Number(rounds) })) as Burst;
      setB(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await a.post("/burst/stop");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const n = Number(rounds);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_ROUNDS;
  const btn = "rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <Card data-reveal className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Bulk run</p>
          <p className="text-xs text-muted">
            Each round shocks both pools by the same swap (alternating buy and sell), then the bot arbs them back in a later block. Real swaps on {config.chainName} ({config.chainId}), paid in HYPE gas by the Arena&apos;s wallet.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-muted">
            Rounds (1–{MAX_ROUNDS})
            <input
              inputMode="numeric"
              value={rounds}
              onChange={(e) => setRounds(e.target.value.replace(/[^0-9]/g, ""))}
              className="num mt-1 block w-24 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none"
              aria-label="Number of rounds"
            />
          </label>
          {running ? (
            <button className={`${btn} border border-line-strong text-ink hover:border-ink`} disabled={!can || busy} onClick={() => void stop()}>
              Stop after this round
            </button>
          ) : (
            <button className={`${btn} bg-warn text-bg hover:brightness-110`} disabled={!can || busy || !valid} onClick={() => void start()}>
              {busy ? "Starting…" : `Run ${valid ? n : ""} rounds`}
            </button>
          )}
        </div>
      </div>

      {!live && <Notice tone="warn" title="Needs the live Arena service">This page is showing a recorded run, so bulk runs are off.</Notice>}
      {live && !a.adminToken && <p className="text-[11px] text-faint">Starting a run needs the admin token (Operator controls below). Anyone can watch a run here.</p>}
      {err && <Notice tone="error" title={`Bulk run: ${err}`} />}
      {b?.status === "error" && b.error && <Notice tone="error" title="The run stopped on an error">{b.error}</Notice>}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <Stat k="Rounds" v={`${int(results.length)}${b?.rounds ? ` / ${int(b.rounds)}` : ""}${running ? " · running" : b?.status === "stopped" ? " · stopped" : ""}`} />
          <Stat k="Aven arb fee (avg)" v={summary.avenFee !== null ? `${int(Math.round(summary.avenFee))} pips` : "—"} sub={`${int(summary.aven.length)} arbs, each priced from the oracle + mark in its block`} />
          <Stat k="Plain arb fee" v="3,000 pips" sub={`${int(summary.plain.length)} arbs; flat 0.30%, blind to the feed`} />
          <Stat k="Shock → Aven arb" v={summary.avenAfter !== null ? `${num(summary.avenAfter, 1)} blocks` : "—"} sub="the bot's next pass; the fee itself reprices in the shock's block" />
        </div>
      )}

      {results.length === 0 ? (
        <Empty>{running ? "First round in flight…" : "No bulk run yet. An operator can start one above; it shows here for everyone."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-faint">
              <tr>
                <th className="py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Shock</th>
                <th className="py-2 pr-3 font-normal">Oracle</th>
                <th className="py-2 pr-3 font-normal">Shock block</th>
                <th className="py-2 pr-3 font-normal">Aven arb</th>
                <th className="py-2 pr-3 font-normal">Plain arb</th>
              </tr>
            </thead>
            <tbody className="num">
              {[...results].reverse().map((r) => {
                const av = r.arbs.find((x) => x.pool === "aven");
                const pl = r.arbs.find((x) => x.pool === "control");
                return (
                  <tr key={r.round} className="border-t border-line text-ink-2">
                    <td className="py-2 pr-3 text-faint">{r.round}</td>
                    <td className="py-2 pr-3">
                      {r.direction === "buyBase" ? "buy" : "sell"} {num(Number(r.sizeBase), 3)} {sym}
                    </td>
                    <td className="py-2 pr-3">${num(Number(r.oracleRaw) / 10 ** (6 - sz), 2)}</td>
                    <td className="py-2 pr-3">
                      {r.shockTxs[1] ? <TxLink hash={r.shockTxs[1]}>#{int(r.shockBlock)}</TxLink> : `#${int(r.shockBlock)}`}
                    </td>
                    <td className="py-2 pr-3">
                      {av ? (
                        <TxLink hash={av.txHash}>
                          {pipsPct(av.feePips)} · +{av.block - r.shockBlock} blk
                        </TxLink>
                      ) : (
                        <span className="text-faint">no arb (gap ≤ fee)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {pl ? (
                        <TxLink hash={pl.txHash}>
                          {pipsPct(pl.feePips)} · +{pl.block - r.shockBlock} blk
                        </TxLink>
                      ) : (
                        <span className="text-faint">no arb (gap ≤ 0.30%)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Src>Arena GET /burst · every swap is also on the trade tape below and verifiable on /verify/&lt;tx&gt;</Src>
    </Card>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-faint">{k}</p>
      <p className="mt-1 text-sm text-ink">{v}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-faint">{sub}</p>}
    </div>
  );
}
