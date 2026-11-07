"use client";
/**
 * Dashboard chart primitives in plain SVG (GSAP animates them on first view). Dataviz rules, as in LineChart:
 * thin marks (columns ≤ 24px, 4px rounded data-end, square at the baseline), 2px surface gaps between touching marks,
 * 2px surface ring on dots, hairline solid grid, one y-axis, a legend for ≥ 2 series, text in ink tokens only, hover
 * on every mark with a hit area larger than the mark, and a table view (or a legend that carries every value).
 *
 * Colours are validated (dataviz validate_palette.js, dark, surface #0e1110): aqua/orange/blue all-pairs PASS; the
 * fee-term ring aqua → blue → magenta → yellow passes every adjacent pair including the wrap-around.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CountUp } from "@/components/motion";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

export const COLORS = {
  aven: "var(--color-aven)",
  plain: "var(--color-plain)",
  delayed: "var(--color-delayed)",
  gap: "#199e70",
  premium: "#3987e5",
  base: "#d55181",
  stress: "#c98500",
};

function useWidth(min = 280): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(min, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function ticksFor(lo: number, hi: number, n = 4): { lo: number; hi: number; ticks: number[] } {
  if (hi - lo < 1e-9) hi = lo + 1;
  const step = niceStep((hi - lo) / n);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo: a, hi: b, ticks };
}

function TableToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button onClick={() => set(!on)} className="ml-auto text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
      {on ? "Show chart" : "Show table"}
    </button>
  );
}

function Swatch({ color, kind = "rect" }: { color: string; kind?: "rect" | "line" | "dot" }) {
  if (kind === "line")
    return (
      <svg width="18" height="8" aria-hidden>
        <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  if (kind === "dot")
    return (
      <svg width="10" height="10" aria-hidden>
        <circle cx="5" cy="5" r="4" fill={color} />
      </svg>
    );
  return <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />;
}

// ------------------------------------------------------------------------------------------------ stat tile

export function Stat({
  label,
  value,
  format,
  sub,
  src,
  big = false,
  className = "",
  children,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  sub?: ReactNode;
  src?: ReactNode;
  big?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div data-reveal className={`panel flex flex-col justify-between gap-3 p-5 ${className}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-medium tracking-[-0.03em] text-ink ${big ? "text-[clamp(2.6rem,5vw,3.6rem)] leading-none" : "text-[28px] leading-none"}`}>
        {value === null || !Number.isFinite(value) ? "—" : <CountUp value={value} format={format} mono={false} />}
      </p>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
      {children}
      {src && <p className="text-[11px] text-faint">{src}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ donut

export interface Part {
  id: string;
  label: string;
  value: number;
  color: string;
  icon?: string;
}

export function Donut({ parts, format, centerLabel, ariaLabel }: { parts: Part[]; format: (v: number) => string; centerLabel: string; ariaLabel: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const R = 78;
  const SW = 22;
  const C = 2 * Math.PI * R;
  const GAP = parts.filter((p) => p.value > 0).length > 1 ? 2.5 : 0;
  let acc = 0;
  const segs = parts.map((p) => {
    const len = total > 0 ? (Math.max(0, p.value) / total) * C : 0;
    const s = { ...p, len, start: acc };
    acc += len;
    return s;
  });
  const shown = segs.find((s) => s.id === active);

  // Sweep-in on first view: arcs grow from 12 o'clock. A progress value scales every arc (DrawSVG would overwrite
  // the dash pattern that defines each segment).
  const [prog, setProg] = useState(1);
  const swept = useRef(false);
  useGSAP(
    () => {
      if (swept.current || total <= 0 || !svg.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        swept.current = true;
        const o = { v: 0 };
        setProg(0);
        gsap.to(o, { v: 1, duration: 1.6, ease: "expo.out", onUpdate: () => setProg(o.v), scrollTrigger: { trigger: svg.current, start: "top 88%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: svg, dependencies: [total > 0] },
  );

  return (
    <div className="grid items-center gap-6 sm:grid-cols-[200px_1fr]">
      <div className="relative mx-auto h-[200px] w-[200px]">
        <svg ref={svg} viewBox="0 0 200 200" width="200" height="200" role="img" aria-label={ariaLabel}>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-line)" strokeWidth={SW} />
          {segs.map((s) =>
            s.len <= 0 ? null : (
              <circle
                key={s.id}
                data-seg
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={active === s.id ? SW + 6 : SW}
                strokeDasharray={`${Math.max(0.5, s.len * prog - GAP)} ${C}`}
                strokeDashoffset={-s.start * prog}
                transform="rotate(-90 100 100)"
                className="cursor-pointer transition-[stroke-width] duration-200"
                onPointerEnter={() => setActive(s.id)}
                onPointerLeave={() => setActive(null)}
              >
                <title>{`${s.label}: ${format(s.value)} (${((s.value / total) * 100).toFixed(1)}%)`}</title>
              </circle>
            ),
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[22px] font-medium leading-none tracking-[-0.03em] text-ink">{total > 0 ? (shown ? `${((shown.value / total) * 100).toFixed(0)}%` : format(total)) : "—"}</p>
          <p className="mt-1.5 max-w-[110px] text-[10px] leading-tight text-muted">{shown ? shown.label : centerLabel}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {segs.map((s) => (
          <li
            key={s.id}
            tabIndex={0}
            onPointerEnter={() => setActive(s.id)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(s.id)}
            onBlur={() => setActive(null)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-xs transition ${active === s.id ? "bg-raised" : ""}`}
          >
            <Swatch color={s.color} />
            <span className="flex-1 text-ink-2">
              {s.icon && <span className="mr-1" aria-hidden>{s.icon}</span>}
              {s.label}
            </span>
            <span className="num text-ink">{format(s.value)}</span>
            <span className="num w-12 text-right text-muted">{total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ grouped columns

export interface ColSeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

export function Columns({
  cats,
  series,
  height = 240,
  format,
  axisFormat,
  ariaLabel,
  yLabel,
}: {
  cats: string[];
  series: ColSeries[];
  height?: number;
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  ariaLabel: string;
  yLabel: string;
}) {
  const [wrap, w] = useWidth();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ c: number; s: number } | null>(null);
  const [table, setTable] = useState(false);
  const M = { top: 14, right: 12, bottom: 30, left: 56 };
  const iw = w - M.left - M.right;
  const ih = height - M.top - M.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const { hi, ticks } = ticksFor(0, max || 1);
  const y = (v: number) => M.top + ih - (v / hi) * ih;
  const slot = iw / Math.max(1, cats.length);
  const k = series.length;
  const bw = Math.max(3, Math.min(24, (slot * 0.72 - 2 * (k - 1)) / k));
  const groupW = bw * k + 2 * (k - 1);
  const labelEvery = Math.max(1, Math.ceil((cats.length * 64) / iw));

  // Grow from the baseline once, the first time there is data. fromTo + a guard: a second run of a plain from()
  // (when data arrives) tweens to the half-drawn state and freezes it.
  const grown = useRef(false);
  useGSAP(
    () => {
      if (grown.current || table || !svg.current || !(max > 0)) return;
      const bars = svg.current.querySelectorAll("[data-col]");
      if (!bars.length) return;
      grown.current = true;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(bars, { scaleY: 0 }, { scaleY: 1, transformOrigin: "50% 100%", duration: 1, ease: "expo.out", stagger: 0.02, clearProps: "transform", scrollTrigger: { trigger: svg.current, start: "top 88%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: svg, dependencies: [max > 0, table] },
  );

  const hv = hover ? { cat: cats[hover.c]!, s: series[hover.s]!, v: series[hover.s]!.values[hover.c]! } : null;
  const hx = hover ? M.left + hover.c * slot + slot / 2 : 0;

  return (
    <div ref={wrap} className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {series.length > 1 &&
          series.map((s) => (
            <span key={s.id} className="flex items-center gap-2 text-xs text-ink-2">
              <Swatch color={s.color} />
              {s.label}
            </span>
          ))}
        <TableToggle on={table} set={setTable} />
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="sticky top-0 bg-raised text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{yLabel}</th>
                {series.map((s) => (
                  <th key={s.id} className="px-3 py-2 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num text-ink-2">
              {cats.map((c, i) => (
                <tr key={c + i} className="border-t border-line/60">
                  <td className="px-3 py-1.5">{c}</td>
                  {series.map((s) => (
                    <td key={s.id} className="px-3 py-1.5">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg ref={svg} viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel} className="select-none overflow-visible" onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={M.left - 10} y={y(t) + 3} textAnchor="end" className="num fill-[var(--color-muted)] text-[10px]">
                {(axisFormat ?? format)(t)}
              </text>
            </g>
          ))}
          {cats.map((c, ci) => {
            const gx = M.left + ci * slot + (slot - groupW) / 2;
            return (
              <g key={c + ci}>
                {/* hit target: the whole slot height, per bar */}
                {series.map((s, si) => {
                  const v = s.values[ci] ?? 0;
                  const x0 = gx + si * (bw + 2);
                  const yt = v > 0 ? Math.min(y(v), M.top + ih - 2) : y(v); // a non-zero value never vanishes (≥ 2px)
                  const hgt = M.top + ih - yt;
                  const r = Math.min(4, hgt, bw / 2);
                  const d = hgt <= 0 ? "" : `M${x0},${M.top + ih}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + bw - r}Q${x0 + bw},${yt} ${x0 + bw},${yt + r}V${M.top + ih}Z`;
                  const on = hover?.c === ci && hover.s === si;
                  return (
                    <g key={s.id}>
                      {d && <path data-col d={d} fill={s.color} opacity={hover && !on ? 0.55 : 1} />}
                      <rect
                        x={x0 - 1}
                        y={M.top}
                        width={bw + 2}
                        height={ih}
                        fill="transparent"
                        onPointerEnter={() => setHover({ c: ci, s: si })}
                        tabIndex={0}
                        onFocus={() => setHover({ c: ci, s: si })}
                        aria-label={`${c}, ${s.label}: ${format(v)}`}
                      />
                    </g>
                  );
                })}
                {ci % labelEvery === 0 && (
                  <text x={M.left + ci * slot + slot / 2} y={height - 10} textAnchor="middle" className="num fill-[var(--color-muted)] text-[10px]">
                    {c}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={M.left} x2={w - M.right} y1={M.top + ih} y2={M.top + ih} stroke="var(--color-line-strong)" strokeWidth="1" />
        </svg>
      )}
      {hv && !table && (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-36 rounded-xl border border-line bg-bg/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
          style={{ left: hx, transform: `translateX(${hx > w * 0.6 ? "calc(-100% - 12px)" : "12px"})` }}
        >
          <p className="num text-[15px] text-ink">{format(hv.v)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-muted">
            <Swatch color={hv.s.color} kind="line" />
            {hv.s.label} · {hv.cat}
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ scatter

export interface ScatterSeries {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number; tip: string }>;
}

export function Scatter({
  series,
  line,
  height = 300,
  xFormat,
  yFormat,
  xLabel,
  yLabel,
  ariaLabel,
}: {
  series: ScatterSeries[];
  line?: { label: string; pts: Array<[number, number]> };
  height?: number;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  xLabel: string;
  yLabel: string;
  ariaLabel: string;
}) {
  const [wrap, w] = useWidth();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);
  const [table, setTable] = useState(false);
  const M = { top: 14, right: 16, bottom: 36, left: 60 };
  const iw = w - M.left - M.right;
  const ih = height - M.top - M.bottom;
  const all = series.flatMap((s) => s.points);
  const xs = [...all.map((p) => p.x), ...(line?.pts.map((p) => p[0]) ?? [])];
  const ys = [...all.map((p) => p.y), ...(line?.pts.map((p) => p[1]) ?? [])];
  const X = ticksFor(Math.min(0, ...xs), Math.max(1, ...xs), 5);
  const Y = ticksFor(0, Math.max(1, ...ys), 4);
  const x = (v: number) => M.left + ((v - X.lo) / (X.hi - X.lo)) * iw;
  const y = (v: number) => M.top + ih - ((v - Y.lo) / (Y.hi - Y.lo)) * ih;

  const pts = useMemo(() => series.flatMap((s, si) => s.points.map((p, i) => ({ si, i, px: 0, py: 0, p }))), [series]);

  const popped = useRef(false);
  useGSAP(
    () => {
      if (popped.current || table || !svg.current || all.length === 0) return;
      popped.current = true;
      const dots = svg.current.querySelectorAll("[data-dot]");
      const l = svg.current.querySelector("[data-fline]");
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const st = { trigger: svg.current, start: "top 88%", once: true };
        if (dots.length) gsap.fromTo(dots, { scale: 0 }, { scale: 1, transformOrigin: "50% 50%", duration: 0.6, ease: "back.out(2)", stagger: { amount: 0.8 }, clearProps: "transform", scrollTrigger: st });
        if (l) gsap.fromTo(l, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.6, ease: "power2.inOut", scrollTrigger: st, onComplete: () => l.removeAttribute("style") });
      });
      return () => mm.revert();
    },
    { scope: svg, dependencies: [all.length > 0, table] },
  );

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * w;
    const my = ((e.clientY - r.top) / r.height) * height;
    let best: { s: number; i: number; d: number } | null = null;
    for (const q of pts) {
      const d = (x(q.p.x) - mx) ** 2 + (y(q.p.y) - my) ** 2;
      if (!best || d < best.d) best = { s: q.si, i: q.i, d };
    }
    setHover(best && best.d < 40 ** 2 ? { s: best.s, i: best.i } : null);
  };
  const hp = hover ? series[hover.s]!.points[hover.i]! : null;

  return (
    <div ref={wrap} className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-2 text-xs text-ink-2">
            <Swatch color={s.color} kind="dot" />
            {s.label}
          </span>
        ))}
        {line && (
          <span className="flex items-center gap-2 text-xs text-ink-2">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke="var(--color-ink-2)" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            {line.label}
          </span>
        )}
        <TableToggle on={table} set={setTable} />
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="sticky top-0 bg-raised text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Series</th>
                <th className="px-3 py-2 font-medium">{xLabel}</th>
                <th className="px-3 py-2 font-medium">{yLabel}</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="num text-ink-2">
              {series.flatMap((s) =>
                s.points.map((p, i) => (
                  <tr key={s.id + i} className="border-t border-line/60">
                    <td className="px-3 py-1.5 font-sans">{s.label}</td>
                    <td className="px-3 py-1.5">{xFormat(p.x)}</td>
                    <td className="px-3 py-1.5">{yFormat(p.y)}</td>
                    <td className="px-3 py-1.5 font-sans text-muted">{p.tip}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <svg ref={svg} viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="select-none overflow-visible">
          {Y.ticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={M.left - 10} y={y(t) + 3} textAnchor="end" className="num fill-[var(--color-muted)] text-[10px]">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {X.ticks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={M.top + ih + 16} textAnchor="middle" className="num fill-[var(--color-muted)] text-[10px]">
              {xFormat(t)}
            </text>
          ))}
          <text x={M.left + iw} y={height - 4} textAnchor="end" className="fill-[var(--color-faint)] text-[10px]">
            {xLabel} →
          </text>
          <text x={12} y={M.top - 4} className="fill-[var(--color-faint)] text-[10px]">
            {yLabel}
          </text>
          {line && (
            <path data-fline d={line.pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("")} fill="none" stroke="var(--color-ink-2)" strokeWidth="1.5" strokeDasharray="5 4" />
          )}
          {series.map((s, si) =>
            s.points.map((p, i) => (
              <circle
                key={`${s.id}${i}`}
                data-dot
                cx={x(p.x)}
                cy={y(p.y)}
                r={hover?.s === si && hover.i === i ? 6.5 : 4.5}
                fill={s.color}
                stroke="var(--color-surface)"
                strokeWidth="2"
              />
            )),
          )}
          <rect x={M.left} y={M.top} width={iw} height={ih} fill="transparent" />
        </svg>
      )}
      {hp && hover && !table && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 rounded-xl border border-line bg-bg/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
          style={{ left: x(hp.x), top: Math.max(0, y(hp.y) - 10), transform: `translate(${x(hp.x) > w * 0.6 ? "calc(-100% - 14px)" : "14px"}, -50%)` }}
        >
          <p className="num text-[15px] text-ink">
            {yFormat(hp.y)} <span className="text-muted">at {xFormat(hp.x)}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-muted">
            <Swatch color={series[hover.s]!.color} kind="line" />
            {series[hover.s]!.label}
          </p>
          <p className="mt-1 text-ink-2">{hp.tip}</p>
        </div>
      )}
    </div>
  );
}
