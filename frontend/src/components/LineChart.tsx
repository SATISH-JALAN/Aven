"use client";
/**
 * Line chart in plain SVG so GSAP can draw it (DrawSVG on first view). Follows the dataviz rules:
 * one y-axis; 2px lines; legend for ≥ 2 series plus direct end labels (≤ 4 series); recessive grid; crosshair +
 * tooltip on hover with a hit area wider than the marks; markers ≥ 8px with a surface ring; a table view.
 * Text always uses ink tokens; only the marks and swatches carry series colour.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

export interface Series {
  id: string;
  label: string;
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
}

export interface Marker {
  /** Index into xs. */
  i: number;
  /** Series the marker sits on (dot), or none for a vertical event line. */
  seriesId?: string;
  kind: "shock" | "trade" | "event";
  label: string;
}

interface Props {
  xs: number[];
  series: Series[];
  markers?: Marker[];
  height?: number;
  /** Only the first `visible` points are drawn (replay playback). Default: all. */
  visible?: number;
  yFormat: (v: number) => string;
  xFormat: (x: number) => string;
  /** Draw a prominent baseline at this y (e.g. 0 for "LP value − HODL"). */
  baseline?: number;
  ariaLabel: string;
  yLabel: string;
}

const M = { top: 16, right: 132, bottom: 28, left: 64 }; // right: room for direct end labels

export function LineChart({ xs, series, markers = [], height = 320, visible, yFormat, xFormat, baseline, ariaLabel, yLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const n = Math.min(visible ?? xs.length, xs.length);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(320, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const iw = w - M.left - M.right;
  const ih = height - M.top - M.bottom;

  const { y0, y1, ticks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series)
      for (let i = 0; i < xs.length; i++) {
        const v = s.values[i];
        if (v == null || !Number.isFinite(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    if (baseline !== undefined) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (hi - lo < 1e-9) {
      hi += Math.abs(hi) * 0.01 || 1;
      lo -= Math.abs(lo) * 0.01 || 1;
    }
    const pad = (hi - lo) * 0.08;
    const a = lo - pad;
    const b = hi + pad;
    const step = niceStep((b - a) / 4);
    const t: number[] = [];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) t.push(v);
    return { y0: a, y1: b, ticks: t };
  }, [series, xs.length, baseline]);

  const x = (i: number) => M.left + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * iw);
  const y = (v: number) => M.top + (1 - (v - y0) / (y1 - y0)) * ih;

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  });

  // Direct end labels with a 14px minimum gap.
  const ends = series
    .map((s, k) => {
      let i = n - 1;
      while (i >= 0 && (s.values[i] == null || !Number.isFinite(s.values[i]!))) i--;
      return i < 0 ? null : { k, i, yy: y(s.values[i]!), label: s.label };
    })
    .filter(Boolean) as Array<{ k: number; i: number; yy: number; label: string }>;
  ends.sort((a, b) => a.yy - b.yy);
  for (let j = 1; j < ends.length; j++) if (ends[j]!.yy - ends[j - 1]!.yy < 14) ends[j]!.yy = ends[j - 1]!.yy + 14;

  // Draw-in on first view.
  const drawn = useRef(false);
  useGSAP(
    () => {
      if (drawn.current || !svg.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const lines = svg.current!.querySelectorAll("[data-line]");
        if (!lines.length) return;
        drawn.current = true;
        gsap.from(lines, {
          drawSVG: "0%",
          duration: 1.8,
          ease: "power2.inOut",
          stagger: 0.15,
          scrollTrigger: { trigger: svg.current, start: "top 85%", once: true },
          onComplete: () => lines.forEach((l) => l.removeAttribute("style")),
        });
        const marks = svg.current!.querySelectorAll("[data-mark]");
        if (marks.length) gsap.from(marks, {
          scale: 0,
          transformOrigin: "50% 50%",
          duration: 0.6,
          ease: "back.out(2)",
          stagger: 0.05,
          delay: 1.2,
          scrollTrigger: { trigger: svg.current, start: "top 85%", once: true },
        });
      });
      return () => mm.revert();
    },
    { scope: svg, dependencies: [paths.join("").length > 0] },
  );

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    if (xs.length < 1) return;
    const i = Math.round(((px - M.left) / iw) * (xs.length - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hv = hover !== null && hover < n ? hover : null;
  const tipLeft = hv !== null ? (x(hv) / w) * 100 : 0;

  return (
    <div ref={wrap} className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-2 text-xs text-ink-2">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinecap="round" />
            </svg>
            {s.label}
          </span>
        ))}
        {markers.some((m) => m.kind === "shock") && <LegendGlyph kind="shock" label="shock" />}
        {markers.some((m) => m.kind === "trade") && <LegendGlyph kind="trade" label="bot trade" />}
        <button onClick={() => setTable((t) => !t)} className="ml-auto text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {table ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="sticky top-0 bg-raised text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                {series.map((s) => (
                  <th key={s.id} className="px-3 py-2 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num text-ink-2">
              {xs.slice(0, n).map((xv, i) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="px-3 py-1.5">{xFormat(xv)}</td>
                  {series.map((s) => (
                    <td key={s.id} className="px-3 py-1.5">
                      {s.values[i] == null ? "—" : yFormat(s.values[i]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            ref={svg}
            viewBox={`0 0 ${w} ${height}`}
            width="100%"
            height={height}
            role="img"
            aria-label={ariaLabel}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            className="touch-pan-y select-none overflow-visible"
          >
            <text x={12} y={M.top - 4} className="fill-[var(--color-faint)] text-[10px]">
              {yLabel}
            </text>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
                <text x={M.left - 10} y={y(t) + 3} textAnchor="end" className="num fill-[var(--color-muted)] text-[10px]">
                  {yFormat(t)}
                </text>
              </g>
            ))}
            {baseline !== undefined && <line x1={M.left} x2={w - M.right} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-line-strong)" strokeWidth="1.5" />}
            {[0, Math.floor((xs.length - 1) / 2), xs.length - 1].filter((v, i, a) => a.indexOf(v) === i && xs[v] !== undefined).map((i) => (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === xs.length - 1 ? "end" : "middle"} className="num fill-[var(--color-muted)] text-[10px]">
                {xFormat(xs[i]!)}
              </text>
            ))}

            {markers
              .filter((m) => m.kind === "event" && m.i < n)
              .map((m, k) => (
                <g key={`e${k}`}>
                  <line x1={x(m.i)} x2={x(m.i)} y1={M.top} y2={M.top + ih} stroke="var(--color-warn)" strokeWidth="1" strokeDasharray="3 4" opacity="0.8" />
                  <text x={x(m.i) + 6} y={M.top + 12} className="fill-[var(--color-ink-2)] text-[10px]">
                    ⚠ {m.label}
                  </text>
                </g>
              ))}

            {series.map((s, k) => (
              <path
                key={s.id}
                data-line
                d={paths[k]}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "5 4" : undefined}
              />
            ))}

            {markers
              .filter((m) => m.kind !== "event" && m.i < n)
              .map((m, k) => {
                const s = series.find((q) => q.id === m.seriesId);
                const v = s?.values[m.i];
                if (!s || v == null) return null;
                const cx = x(m.i);
                const cy = y(v);
                return m.kind === "shock" ? (
                  <rect key={`m${k}`} data-mark x={cx - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx} ${cy})`} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2}>
                    <title>{m.label}</title>
                  </rect>
                ) : (
                  <circle key={`m${k}`} data-mark cx={cx} cy={cy} r={4.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2}>
                    <title>{m.label}</title>
                  </circle>
                );
              })}

            {series.length <= 4 &&
              ends.map((e) => (
                <text key={e.k} x={x(e.i) + 8} y={e.yy + 3} className="fill-[var(--color-ink-2)] text-[10px]">
                  {e.label}
                </text>
              ))}

            {hv !== null && (
              <g pointerEvents="none">
                <line x1={x(hv)} x2={x(hv)} y1={M.top} y2={M.top + ih} stroke="var(--color-muted)" strokeWidth="1" />
                {series.map((s) =>
                  s.values[hv] == null ? null : <circle key={s.id} cx={x(hv)} cy={y(s.values[hv]!)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />,
                )}
              </g>
            )}
            <rect x={M.left} y={M.top} width={iw} height={ih} fill="transparent" />
          </svg>
          {hv !== null && (
            <div
              className="pointer-events-none absolute top-10 z-10 min-w-44 rounded-xl border border-line bg-bg/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
              style={{ left: `${tipLeft}%`, transform: `translateX(${tipLeft > 60 ? "calc(-100% - 12px)" : "12px"})` }}
            >
              <p className="num mb-1.5 text-muted">{xFormat(xs[hv]!)}</p>
              {series.map((s) => (
                <p key={s.id} className="flex items-center justify-between gap-4 py-0.5">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="num text-ink">{s.values[hv] == null ? "—" : yFormat(s.values[hv]!)}</span>
                </p>
              ))}
              {markers
                .filter((m) => m.i === hv)
                .map((m, k) => (
                  <p key={k} className="mt-1 border-t border-line pt-1 text-ink-2">
                    {m.kind === "shock" ? "◆" : m.kind === "event" ? "⚠" : "●"} {m.label}
                  </p>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LegendGlyph({ kind, label }: { kind: "shock" | "trade"; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-2">
      <svg width="12" height="12" aria-hidden>
        {kind === "shock" ? <rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" fill="var(--color-ink)" /> : <circle cx="6" cy="6" r="4" fill="var(--color-muted)" />}
      </svg>
      {label}
    </span>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
