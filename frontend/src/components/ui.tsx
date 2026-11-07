"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { addressHref, config, txHref } from "@/config";
import { shortHex } from "@/lib/format";
import type { Term } from "@/lib/steps";
import { SplitReveal } from "./motion";

export type Mode = "LIVE" | "REPLAY" | "RECORDED";

const MODE_STYLE: Record<Mode, string> = {
  LIVE: "text-aven-glow bg-aven/10",
  REPLAY: "text-[#8dbcf5] bg-delayed/10",
  RECORDED: "text-warn bg-warn/10",
};
/** AGENTS.md §6: the live badge names the network. */
const liveLabel = config.chainId === 999 ? "Live mainnet" : config.chainId === 998 ? "Live testnet" : `Live · ${config.chainName}`;
const MODE_LABEL: Record<Mode, string> = { LIVE: liveLabel, REPLAY: "Replay", RECORDED: "Recorded run" };

export function ModeBadge({ mode, title }: { mode: Mode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${MODE_STYLE[mode]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${mode === "LIVE" ? "live-dot" : ""}`} />
      {MODE_LABEL[mode]}
    </span>
  );
}

/** Where a number comes from. Required next to every figure (FRONTEND.md). */
export function Src({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
      <span className="h-1 w-1 rounded-full bg-faint" aria-hidden />
      {children}
    </span>
  );
}

export function UsdNote({ className = "" }: { className?: string }) {
  return <p className={`text-[11px] text-faint ${className}`}>$ figures are valued at the HyperCore oracle price.</p>;
}

const TERM_STYLE: Record<Term, string> = {
  base: "border-line-strong text-ink-2",
  gap: "border-aven/60 text-aven-glow",
  premium: "border-delayed/60 text-[#8dbcf5]",
  stress: "border-warn/60 text-warn",
  fallback: "border-crit/60 text-[#f08a8a]",
};
const TERM_ICON: Record<Term, string> = { base: "·", gap: "◆", premium: "▲", stress: "⚡", fallback: "!" };

export function TermChip({ term, active = true }: { term: Term; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
        active ? TERM_STYLE[term] : "border-line text-faint/60 line-through decoration-faint/40"
      }`}
    >
      <span aria-hidden>{TERM_ICON[term]}</span>
      {term}
    </span>
  );
}

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`panel p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Small pill above a heading: a mint dot and a few words. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-ink-2 ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-mint" aria-hidden />
      {children}
    </p>
  );
}

/** Collapsible detail drawer: keeps method notes and fine print out of the way until asked for. */
export function Details({ summary, children, className = "" }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`group panel overflow-hidden ${className}`}>
      <summary className="flex items-center justify-between gap-4 px-6 py-5 text-[15px] font-medium text-ink transition hover:text-mint">
        {summary}
        <span data-chev className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-lg leading-none text-ink-2 transition-transform duration-300">
          +
        </span>
      </summary>
      <div className="border-t border-line px-6 py-5">{children}</div>
    </details>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted transition hover:border-line-strong hover:text-ink"
      aria-label={`${label} ${value}`}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function AddressRow({ label, value, kind = "address" }: { label: string; value: string | null | undefined; kind?: "address" | "id" }) {
  const href = value && kind === "address" ? addressHref(value) : null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/70 py-3 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      {value ? (
        <span className="flex items-center gap-2">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="num text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              {shortHex(value, 6)}
            </a>
          ) : (
            <span className="num text-xs text-ink-2" title={value}>
              {shortHex(value, 6)}
            </span>
          )}
          <CopyButton value={value} />
        </span>
      ) : (
        <span className="text-xs text-faint">pending deploy</span>
      )}
    </div>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  const t = txHref(hash);
  const cls = "num text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink";
  return t.external ? (
    <a href={t.href} target="_blank" rel="noreferrer" className={cls}>
      {children ?? shortHex(hash)}
    </a>
  ) : (
    <Link href={t.href} className={cls}>
      {children ?? shortHex(hash)}
    </Link>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-raised ${className}`} />;
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "error"; title: string; children?: ReactNode; action?: ReactNode }) {
  const c = tone === "error" ? "border-crit/40 bg-crit/5" : tone === "warn" ? "border-warn/30 bg-warn/5" : "border-line bg-raised/60";
  const icon = tone === "error" ? "✕" : tone === "warn" ? "⚠" : "i";
  const ic = tone === "error" ? "text-crit" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${c}`}>
      <span className={`mt-0.5 text-xs font-bold ${ic}`} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">{title}</p>
        {children && <div className="mt-0.5 text-xs text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

/** Match / mismatch badge, always icon + label (status colour never alone). */
export function MatchBadge({ ok, size = "sm" }: { ok: boolean; size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wider ${big ? "px-4 py-1.5 text-sm" : "px-2 py-0.5 text-[10px]"} ${
        ok ? "border-good/60 text-[#4cd44c]" : "border-crit/60 text-[#f08a8a]"
      }`}
    >
      <span aria-hidden>{ok ? "✓" : "✕"}</span>
      {ok ? "MATCH" : "MISMATCH"}
    </span>
  );
}

/**
 * Page header used by every inner page: an eyebrow pill, one short headline, one line of lede and an optional slot on
 * the right (live ticker, status). A soft mint glow sits behind it; nothing else.
 */
export function PageHero({ eyebrow, title, lede, aside, children }: { eyebrow: string; title: ReactNode; lede?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <header className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
      <div className="glow-mint pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 opacity-60" aria-hidden />
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_0%,black,transparent)]" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-6">
        <Eyebrow>{eyebrow}</Eyebrow>
        <div className="flex flex-wrap items-end justify-between gap-10">
          <div className="max-w-4xl">
            <SplitReveal as="h1" immediate className="h-section text-ink">
              {title}
            </SplitReveal>
            {lede && <p className="lede mt-6 max-w-xl">{lede}</p>}
          </div>
          {aside}
        </div>
        {children}
      </div>
    </header>
  );
}

/** Heading block for a section inside a page: short title, optional one-line lede. */
export function SectionHead({ eyebrow, title, lede, className = "" }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; className?: string }) {
  return (
    <div className={`mb-10 max-w-3xl ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <SplitReveal className="text-[clamp(1.9rem,3.4vw,3rem)] font-medium leading-[1.02] tracking-[-0.04em] text-ink">{title}</SplitReveal>
      {lede && <p className="lede mt-4 max-w-xl">{lede}</p>}
    </div>
  );
}
