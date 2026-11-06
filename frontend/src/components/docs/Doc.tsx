"use client";
/** GitBook-style building blocks for the docs: quiet type, clear sections, anchors on every heading. */
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui";

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

function text(n: ReactNode): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(text).join("");
  return "";
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  const a = id ?? slugify(text(children));
  return (
    <h2 id={a} data-toc="2" className="group mt-14 scroll-mt-28 border-t border-line pt-10 text-[1.5rem] font-medium tracking-[-0.025em] text-ink first:mt-0 first:border-0 first:pt-0">
      {children}
      <a href={`#${a}`} className="ml-2 text-faint opacity-0 transition group-hover:opacity-100" aria-label="Link to this section">
        #
      </a>
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  const a = id ?? slugify(text(children));
  return (
    <h3 id={a} data-toc="3" className="mt-9 scroll-mt-28 text-[1.125rem] font-medium tracking-[-0.015em] text-ink">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[15px] leading-[1.75] text-ink-2">{children}</p>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "text-mint underline decoration-mint/30 underline-offset-4 transition hover:decoration-mint";
  return href.startsWith("/") || href.startsWith("#") ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  );
}

export function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-4 space-y-2 text-[15px] leading-[1.7] text-ink-2">
      {items.map((x, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-muted" />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

const TONES = {
  info: { c: "border-[#3987e5]/35 bg-[#3987e5]/[0.06]", i: "i", ic: "bg-[#3987e5]/20 text-[#8fb9f2]" },
  tip: { c: "border-mint/30 bg-mint/[0.05]", i: "✓", ic: "bg-mint/15 text-mint" },
  warn: { c: "border-warn/35 bg-warn/[0.06]", i: "!", ic: "bg-warn/20 text-warn" },
} as const;

export function Callout({ tone = "info", title, children }: { tone?: keyof typeof TONES; title?: string; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <div className={`mt-6 flex gap-3.5 rounded-xl border px-4 py-3.5 ${t.c}`}>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${t.ic}`} aria-hidden>
        {t.i}
      </span>
      <div className="text-[14px] leading-[1.7] text-ink-2">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Code({ code, lang, title }: { code: string; lang: string; title?: string }) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-line bg-[#090b0a]">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="font-mono text-[12px] text-muted">{title ?? lang}</span>
        <CopyButton value={code} />
      </div>
      <pre className="no-scrollbar overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.75] text-ink-2">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="no-scrollbar mt-6 overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-[13.5px]">
        <thead className="bg-raised/60 text-[12px] text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? "text-ink" : "text-ink-2"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Steps({ items }: { items: Array<{ t: string; b: ReactNode }> }) {
  return (
    <ol className="relative mt-6 space-y-6 border-l border-line pl-7">
      {items.map((s, i) => (
        <li key={i} className="relative">
          <span className="num absolute -left-[41px] flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-[12px] text-ink">{i + 1}</span>
          <p className="text-[15px] font-medium text-ink">{s.t}</p>
          <div className="mt-1 text-[14.5px] leading-[1.7] text-ink-2">{s.b}</div>
        </li>
      ))}
    </ol>
  );
}

export function Cards({ items }: { items: Array<{ href: string; t: string; d: string }> }) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {items.map((c) => (
        <Link key={c.href} href={c.href} className="group rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong hover:bg-raised/60">
          <p className="flex items-center justify-between text-[15px] font-medium text-ink">
            {c.t}
            <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-mint">→</span>
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{c.d}</p>
        </Link>
      ))}
    </div>
  );
}
