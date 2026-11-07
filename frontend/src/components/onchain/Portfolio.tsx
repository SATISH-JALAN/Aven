"use client";
/**
 * Portfolio: one address's on-chain activity with our tokens and pools, read straight from HyperEVM
 * (src/lib/onchain.ts useWalletActivity: Transfer logs → receipts). The connected wallet by default; any address can
 * be looked up (?address=0x…). Nothing is stored server-side.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, type Address } from "viem";
import { feeParts } from "@/lib/dashboard";
import { COLORS, Columns, Donut, Stat } from "@/components/dashboard/viz";
import { useWallet } from "@/components/wallet";
import { Card, CopyButton, Empty, MatchBadge, Src, TermChip, TxLink } from "@/components/ui";
import type { Deployments } from "@/config";
import { useArena } from "@/lib/arena";
import { int, num, pipsPct, shortHex, timeUtc, units, usd } from "@/lib/format";
import { ledgerRows, type LedgerRow } from "@/lib/ledger";

/** Native amounts that can be tiny (local gas): fixed decimals above 0.001, 3 significant digits below. */
const hype = (wei: bigint) => {
  const x = Number(formatUnits(wei, 18));
  return x === 0 ? "0" : x >= 0.001 ? num(x, 6) : x.toPrecision(3);
};
import { swapUsd, useLedger, useWalletActivity, viewSwap, type ChainEvent, type WalletTx } from "@/lib/onchain";
import { termsFired } from "@/lib/steps";
import { useBalances } from "@/lib/swap";
import { ScanBar, swapLabel } from "./Ledger";

/** The address to show: ?address= (any wallet), else the connected one. */
export function usePortfolioAddress(): { address: Address | null; source: "query" | "wallet" | null; set: (a: string | null) => void } {
  const w = useWallet();
  const [q, setQ] = useState<Address | null>(null);
  useEffect(() => {
    const v = new URL(window.location.href).searchParams.get("address");
    if (v && isAddress(v)) setQ(v);
  }, []);
  const set = (a: string | null) => {
    const url = new URL(window.location.href);
    if (a && isAddress(a)) {
      url.searchParams.set("address", a);
      setQ(a);
    } else {
      url.searchParams.delete("address");
      setQ(null);
    }
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  };
  if (q) return { address: q, source: "query", set };
  return { address: w.address, source: w.address ? "wallet" : null, set };
}

interface SwapRow {
  tx: WalletTx;
  r: LedgerRow;
  inUsd: number | null;
  feeUsd: number | null;
  plainFeeUsd: number | null;
}

function rowsFor(txs: WalletTx[], ledger: ChainEvent[], d: Deployments, latestOracle: number | null): SwapRow[] {
  const all = ledgerRows(ledger, d);
  const byId = new Map(all.map((r) => [r.e.id, r]));
  const out: SwapRow[] = [];
  for (const tx of txs) {
    for (const e of tx.swaps) {
      const r: LedgerRow = byId.get(e.id) ?? {
        e,
        v: viewSwap(e, d, latestOracle),
        oracleFrom: e.fc ? "own" : null,
        oracleBlock: e.fc ? e.block : null,
        priceBefore: null,
        gapBefore: null,
        sinceSwap: null,
        oracleMoveBps: null,
      };
      const v = r.v.oracle === null && latestOracle ? viewSwap(e, d, latestOracle) : r.v;
      const u = swapUsd(e, v, d);
      out.push({ tx, r: { ...r, v }, inUsd: u.inUsd, feeUsd: u.feeUsd, plainFeeUsd: u.inUsd === null ? null : (u.inUsd * 3000) / 1e6 });
    }
  }
  return out;
}

function AddressBar({ address, source, set }: ReturnType<typeof usePortfolioAddress>) {
  const w = useWallet();
  const [draft, setDraft] = useState("");
  const valid = isAddress(draft.trim());
  return (
    <div data-reveal className="panel flex flex-wrap items-center gap-3 px-5 py-4">
      {address ? (
        <>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${source === "wallet" ? "bg-aven/10 text-aven-glow" : "bg-raised text-ink-2"}`}>{source === "wallet" ? "Connected wallet" : "Viewing address"}</span>
          <span className="num text-sm text-ink" title={address}>
            {shortHex(address, 6)}
          </span>
          <CopyButton value={address} />
          {source === "query" && (
            <button onClick={() => set(null)} className="text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
              {w.address ? "Back to my wallet" : "Clear"}
            </button>
          )}
        </>
      ) : w.enabled ? (
        <button onClick={w.login} className="btn btn-primary btn-sm">
          Connect wallet
        </button>
      ) : (
        <span className="text-xs text-muted">Wallet login is off on this build. Look up any address instead.</span>
      )}
      <form
        className="ml-auto flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            set(draft.trim());
            setDraft("");
          }
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Look up any address 0x…"
          spellCheck={false}
          className="num w-[340px] max-w-[60vw] rounded-full border border-line bg-bg px-4 py-2 text-xs text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <button disabled={!valid} className="btn btn-ghost btn-sm disabled:opacity-40">
          View
        </button>
      </form>
    </div>
  );
}

function SwapDetail({ s, d }: { s: SwapRow; d: Deployments }) {
  const { r } = s;
  const b = r.e.breakdown;
  const parts = b ? feeParts(b, d.params) : null;
  const io = swapLabel(r, d);
  return (
    <div className="grid gap-4 rounded-[20px] border border-line bg-surface/70 p-4 text-xs md:grid-cols-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <dt className="text-muted">You paid</dt>
        <dd className="num text-right text-ink">{io.inA}</dd>
        <dt className="text-muted">You got</dt>
        <dd className="num text-right text-ink">{io.outA}</dd>
        <dt className="text-muted">Pool before → after</dt>
        <dd className="num text-right text-ink">
          {r.priceBefore !== null ? num(r.priceBefore, 2) : "—"} → {num(r.v.priceAfter, 2)}
        </dd>
        <dt className="text-muted">Gap before → after</dt>
        <dd className="num text-right text-ink">
          {r.gapBefore !== null ? `${Math.round(r.gapBefore)}` : "—"} → {r.v.gapAfter !== null ? `${Math.round(r.v.gapAfter)} bp` : "—"}
        </dd>
      </dl>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <dt className="text-muted">Oracle 0x807</dt>
        <dd className="num text-right text-ink">
          {r.v.oracle !== null ? `$${num(r.v.oracle, 2)}` : "—"}
          <span className="ml-1 font-sans text-[10px] text-faint">{r.oracleFrom === "own" ? "this swap" : r.oracleFrom ? r.oracleFrom : r.v.oracle !== null ? "≈ latest" : ""}</span>
        </dd>
        <dt className="text-muted">Perp mark 0x806</dt>
        <dd className="num text-right text-ink">{r.v.mark !== null ? `$${num(r.v.mark, 2)}` : "—"}</dd>
        <dt className="text-muted">Premium</dt>
        <dd className="num text-right text-ink">{r.v.premiumBps !== null ? `${Math.round(r.v.premiumBps)} bp` : "—"}</dd>
        <dt className="text-muted">Gas</dt>
        <dd className="num text-right text-ink">
          {int(BigInt(s.tx.gasUsed))} · {hype(BigInt(s.tx.gasUsed) * BigInt(s.tx.gasPrice))} HYPE
        </dd>
      </dl>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted">Fee {pipsPct(r.e.fee)}</span>
          {b ? termsFired(b, d.params.stressThresholdBps).map((t) => <TermChip key={t} term={t} />) : <span className="text-faint">static 0.30%</span>}
        </div>
        {parts && (
          <p className="num text-[11px] text-ink-2">
            base {pipsPct(parts.base)}
            {parts.gap > 0 && ` + gap ${pipsPct(parts.gap)}`}
            {parts.premium > 0 && ` + premium ${pipsPct(parts.premium)}`}
            {parts.stress > 0 && ` + stress ${pipsPct(parts.stress)}`}
            {parts.regime === "capped" && " (capped)"}
          </p>
        )}
        {r.e.verify && (
          <div className="flex items-center gap-2">
            <MatchBadge ok={r.e.verify.a && r.e.verify.b} />
            <span className="text-[11px] text-muted">A {r.e.verify.a ? "✓" : "✕"} · B {r.e.verify.b ? "✓" : "✕"}, checked in this browser</span>
          </div>
        )}
        <Link href={`/verify/${r.e.tx}`} className="inline-block text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
          Full step-by-step proof →
        </Link>
      </div>
    </div>
  );
}

function ActivityList({ txs, swapRows, d }: { txs: WalletTx[]; swapRows: SwapRow[]; d: Deployments }) {
  const [open, setOpen] = useState<string | null>(null);
  const [n, setN] = useState(25);
  const c = d.config;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  if (!txs.length) return <Empty>No activity with aETH, aUSD or the Aven pools in the scanned range yet.</Empty>;
  const summary = (tx: WalletTx): string => {
    if (tx.kind === "swap") {
      const s = swapRows.filter((x) => x.tx.id === tx.id);
      return s
        .map((x) => {
          const io = swapLabel(x.r, d);
          return `${x.r.v.dir === "buyBase" ? "Bought" : "Sold"} on ${x.r.e.pool === "aven" ? "Aven" : "the plain pool"}: ${io.inA} → ${io.outA} at ${pipsPct(x.r.e.fee)}`;
        })
        .join(" · ");
    }
    const amt = (t: WalletTx["transfers"][number]) => `${units(t.value, t.token === "base" ? baseDec : quoteDec, t.token === "base" ? 4 : 2)} ${t.token === "base" ? d.tokens.baseSymbol : d.tokens.quoteSymbol}`;
    if (tx.kind === "liquidity") return `Liquidity ${tx.liquidity.some((l) => BigInt(l.liquidityDelta ?? "0") < 0n) ? "removed" : "added"} on ${tx.liquidity[0]?.pool === "aven" ? "Aven" : "the plain pool"}: ${tx.transfers.map(amt).join(" + ")}`;
    if (tx.kind === "mint") return `Faucet mint: ${tx.transfers.map(amt).join(" + ")}`;
    return `Transfer: ${tx.transfers.map(amt).join(" · ")}`;
  };
  const KIND: Record<WalletTx["kind"], { label: string; color: string }> = {
    swap: { label: "Swap", color: COLORS.aven },
    liquidity: { label: "Liquidity", color: COLORS.premium },
    mint: { label: "Mint", color: COLORS.stress },
    transfer: { label: "Transfer", color: COLORS.stress },
  };
  return (
    <div className="space-y-2">
      {txs.slice(0, n).map((tx) => {
        const k = KIND[tx.kind];
        const color = tx.kind === "swap" && tx.swaps[0]?.pool === "control" ? COLORS.plain : k.color;
        const isOpen = open === tx.id;
        const mine = swapRows.filter((x) => x.tx.id === tx.id);
        return (
          <div key={tx.id} className="rounded-[20px] border border-line">
            <button onClick={() => setOpen(isOpen ? null : tx.id)} className="grid w-full grid-cols-[110px_90px_1fr_auto] items-center gap-3 px-4 py-3 text-left text-xs hover:bg-raised/40">
              <span className="num text-muted">
                #{int(tx.block)}
                <span className="block text-[10px] text-faint">{tx.ts ? timeUtc(tx.ts) : ""}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                {k.label}
              </span>
              <span className="truncate text-ink-2">{summary(tx)}</span>
              <span className="flex items-center gap-3">
                {tx.status !== "success" && <span className="text-[#f08a8a]">✕ reverted</span>}
                {mine.some((x) => x.r.e.verify) && <MatchBadge ok={mine.every((x) => !x.r.e.verify || (x.r.e.verify.a && x.r.e.verify.b))} />}
                <span className="text-muted">{isOpen ? "−" : "+"}</span>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-line px-4 py-4">
                {mine.map((s) => (
                  <SwapDetail key={s.r.e.id} s={s} d={d} />
                ))}
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
                  <TxLink hash={tx.tx} />
                  <span className="num">gas {int(BigInt(tx.gasUsed))}</span>
                  <span>from {shortHex(tx.from, 4)}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {n < txs.length && (
        <button onClick={() => setN((x) => x + 25)} className="btn btn-ghost btn-sm">
          Show more
        </button>
      )}
    </div>
  );
}

export function Portfolio() {
  const a = useArena();
  const d = a.math;
  const pa = usePortfolioAddress();
  const s = useWalletActivity(d, pa.address);
  const ledger = useLedger(d);
  const latestOracle = a.state?.oracle.price ?? null;
  const [tick, setTick] = useState(0);
  useEffect(() => setTick((x) => x + 1), [s?.items.length]);
  const bal = useBalances(d, pa.address, tick);
  const txs = useMemo(() => s?.items ?? [], [s]);
  const swapRows = useMemo(() => (d ? rowsFor(txs, ledger?.items ?? [], d, latestOracle) : []), [txs, ledger, d, latestOracle]);

  if (!d) return <Empty>Waiting for the deployment config…</Empty>;
  const c = d.config;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  const aven = swapRows.filter((x) => x.r.e.pool === "aven");
  const vol = swapRows.reduce((t, x) => t + (x.inUsd ?? 0), 0);
  const fees = swapRows.reduce((t, x) => t + (x.feeUsd ?? 0), 0);
  const plainFees = swapRows.reduce((t, x) => t + (x.plainFeeUsd ?? 0), 0);
  const gas = txs.reduce((t, x) => t + BigInt(x.gasUsed) * BigInt(x.gasPrice), 0n);
  const verified = aven.filter((x) => x.r.e.verify);
  const ok = verified.filter((x) => x.r.e.verify!.a && x.r.e.verify!.b).length;
  const recent = swapRows.slice(0, 24).reverse();
  const mix = {
    aven: aven.length,
    plain: swapRows.length - aven.length,
    liq: txs.filter((x) => x.kind === "liquidity").length,
    other: txs.filter((x) => x.kind === "mint" || x.kind === "transfer").length,
  };

  return (
    <div className="space-y-6">
      <AddressBar {...pa} />
      {!pa.address ? (
        <Empty>Connect a wallet, or look up any address, to see its swaps, liquidity and mints straight from the chain.</Empty>
      ) : (
        <>
          <Card data-reveal>
            <ScanBar s={s} what="This address" />
          </Card>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label={`${d.tokens.baseSymbol} balance`} value={bal ? Number(formatUnits(bal.base, baseDec)) : null} format={(v) => num(v, 4)} sub={bal && latestOracle ? `≈ ${usd(Number(formatUnits(bal.base, baseDec)) * latestOracle)} at the oracle` : undefined} src="balanceOf, latest block" />
            <Stat label={`${d.tokens.quoteSymbol} balance`} value={bal ? Number(formatUnits(bal.quote, quoteDec)) : null} format={(v) => num(v, 2)} src="balanceOf, latest block" />
            <Stat label="HYPE for gas" value={bal ? Number(formatUnits(bal.native, 18)) : null} format={(v) => num(v, 5)} sub={`gas spent here: ${hype(gas)} HYPE`} src="eth_getBalance · receipts" />
            <Stat label="Swaps" value={swapRows.length} format={(v) => int(v)} sub={`${int(aven.length)} on Aven · ${int(swapRows.length - aven.length)} on the plain pool`} src="PoolManager Swap events in your txs" />
            <Stat label="Volume" value={vol} format={(v) => usd(v)} sub="your swap inputs, base at the oracle" src="Swap events · FeeComputed oracle" />
            <Stat label="Fees you paid" value={fees} format={(v) => usd(v)} sub={plainFees ? `at a flat 0.30% the same swaps would cost ${usd(plainFees)}` : undefined} src="Swap.fee × input" />
            <Stat label="Your Aven swaps verified" value={verified.length ? (ok / verified.length) * 100 : null} format={(v) => `${v.toFixed(0)}%`} sub={`${int(ok)} of ${int(verified.length)} · A and B in this browser`} src="@aven/core verifyLogs" />
            <Stat label="Transactions" value={txs.length} format={(v) => int(v)} sub={`${int(mix.liq)} liquidity · ${int(mix.other)} mints and transfers`} src="Transfer logs → receipts" />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card data-reveal>
              <p className="mb-1 text-sm font-medium text-ink">Fee you paid on each swap</p>
              <p className="mb-4 text-xs text-muted">Your last {recent.length} swaps, oldest left, vs the same swap at a flat 0.30%. $ of the input at the oracle.</p>
              {recent.length ? (
                <Columns
                  cats={recent.map((x) => `#${x.r.e.block}`)}
                  series={[
                    { id: "paid", label: "You paid", color: COLORS.aven, values: recent.map((x) => x.feeUsd ?? 0) },
                    { id: "plain", label: "At 0.30%", color: COLORS.plain, values: recent.map((x) => x.plainFeeUsd ?? 0) },
                  ]}
                  format={(v) => usd(v)}
                  ariaLabel="Fee paid per swap vs a flat 0.30% fee"
                  yLabel="Swap (block)"
                />
              ) : (
                <Empty>No swaps yet.</Empty>
              )}
            </Card>
            <Card data-reveal>
              <p className="mb-1 text-sm font-medium text-ink">What this address did</p>
              <p className="mb-5 text-xs text-muted">Transactions by kind, from the chain.</p>
              <Donut
                parts={[
                  { id: "aven", label: "Swaps on Aven", value: mix.aven, color: COLORS.aven },
                  { id: "plain", label: "Swaps on the plain pool", value: mix.plain, color: COLORS.plain },
                  { id: "liq", label: "Liquidity", value: mix.liq, color: COLORS.premium },
                  { id: "other", label: "Mints and transfers", value: mix.other, color: COLORS.stress },
                ]}
                format={(v) => int(v)}
                centerLabel="transactions"
                ariaLabel="This address's transactions by kind"
              />
            </Card>
          </div>
          <Card data-reveal className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink">Activity</p>
              <Src>aETH / aUSD Transfer logs for this address, then each receipt</Src>
            </div>
            <ActivityList txs={txs} swapRows={swapRows} d={d} />
          </Card>
        </>
      )}
    </div>
  );
}

/** Compact card for the dashboard: the connected wallet's swaps at a glance, with a link to the portfolio. */
export function WalletCard() {
  const a = useArena();
  const d = a.math;
  const w = useWallet();
  const s = useWalletActivity(d, w.address);
  const ledger = useLedger(d);
  const rows = useMemo(() => (d ? rowsFor(s?.items ?? [], ledger?.items ?? [], d, a.state?.oracle.price ?? null) : []), [s, ledger, d, a.state?.oracle.price]);
  const fees = rows.reduce((t, x) => t + (x.feeUsd ?? 0), 0);
  return (
    <div data-reveal className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 text-xs">
      <p className="text-[10px] uppercase tracking-[0.14em] text-faint">Your wallet</p>
      {w.address ? (
        <>
          <span className="num text-ink">{shortHex(w.address, 4)}</span>
          <span className="text-ink-2">
            {int(rows.length)} swaps · fees {usd(fees)} · {s?.done ? "full history" : "scanning history…"}
          </span>
          {rows[0] && (
            <span className="text-muted">
              last: {rows[0].r.v.dir === "buyBase" ? "buy" : "sell"} on {rows[0].r.e.pool === "aven" ? "Aven" : "plain"} at {pipsPct(rows[0].r.e.fee)}, block #{int(rows[0].r.e.block)}
            </span>
          )}
        </>
      ) : (
        <span className="text-ink-2">Connect a wallet to see your own swaps here, straight from the chain.</span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {!w.address && w.enabled && (
          <button onClick={w.login} className="btn btn-ghost btn-sm">
            Connect
          </button>
        )}
        <Link href="/portfolio" className="text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
          Portfolio →
        </Link>
      </span>
    </div>
  );
}
