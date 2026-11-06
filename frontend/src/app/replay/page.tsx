"use client";
/**
 * Replay: four pools over real Hyperliquid mainnet history (offline Foundry simulation, backend/data/replay/README.md).
 * Playback is a GSAP tween over the step index; the charts draw progressively. Share links encode scenario + settings.
 */
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, type Marker } from "@/components/LineChart";
import { CountUp, Magnetic, useReveal } from "@/components/motion";
import { UsePageMode } from "@/components/shell";
import { Card, CopyButton, Details, Notice, PageHero, Skeleton, Src, UsdNote } from "@/components/ui";
import { config } from "@/config";
import { dateUtc, int, num, signedUsd, usd } from "@/lib/format";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { POOLS, RETAIL_SEED, SCENARIOS, resultsCsv, type ReplayFile } from "@/lib/replay";

type Settings = { cap: "1" | "3"; premium: "on" | "off"; seed: "default" };
const DEFAULTS: Settings = { cap: "1", premium: "on", seed: "default" };
const SPEEDS = [1, 2, 4, 8];

export default function ReplayPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [scenario, setScenario] = useState("binance-halt");
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [file, setFile] = useState<ReplayFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [visible, setVisible] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [qr, setQr] = useState<string | null>(null);
  const play = useRef<{ i: number; tween: gsap.core.Tween | null }>({ i: 1, tween: null });
  useReveal(ref, [!!file]);

  // URL → state (share links).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("scenario");
    if (s && SCENARIOS.some((x) => x.id === s && x.available)) setScenario(s);
    setSettings({ cap: q.get("cap") === "3" ? "3" : "1", premium: q.get("premium") === "off" ? "off" : "on", seed: "default" });
  }, []);

  // Built after mount only (window.location), so server and client render the same HTML.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const shareUrl = useMemo(() => {
    if (!origin) return "";
    const u = new URL(origin + "/replay");
    u.searchParams.set("scenario", scenario);
    u.searchParams.set("cap", settings.cap);
    u.searchParams.set("premium", settings.premium);
    u.searchParams.set("seed", settings.seed);
    return u.toString();
  }, [origin, scenario, settings]);

  useEffect(() => {
    if (!shareUrl) return;
    window.history.replaceState(null, "", shareUrl.replace(origin, ""));
    QRCode.toDataURL(shareUrl, { margin: 1, width: 240, color: { dark: "#f3f6f4", light: "#0e1110" } }).then(setQr, () => setQr(null));
  }, [shareUrl, origin]);

  // Load the scenario.
  useEffect(() => {
    let alive = true;
    setFile(null);
    setErr(null);
    fetch(`/replay/${scenario}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`replay/${scenario}.json: HTTP ${r.status}`);
        return r.json() as Promise<ReplayFile>;
      })
      .then((f) => {
        if (!alive) return;
        setFile(f);
        play.current.tween?.kill();
        play.current.i = 1;
        setVisible(1);
        setPlaying(false);
      })
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [scenario]);

  const n = file?.series.timestamps.length ?? 0;

  const start = (from?: number) => {
    if (!file) return;
    play.current.tween?.kill();
    if (from !== undefined) play.current.i = from;
    if (play.current.i >= n) play.current.i = 1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      play.current.i = n;
      setVisible(n);
      return;
    }
    setPlaying(true);
    play.current.tween = gsap.to(play.current, {
      i: n,
      duration: (n - play.current.i) / (6 * speed),
      ease: "none",
      onUpdate: () => setVisible(Math.max(1, Math.round(play.current.i))),
      onComplete: () => setPlaying(false),
    });
  };
  const pause = () => {
    play.current.tween?.pause();
    setPlaying(false);
  };

  // Changing speed mid-run continues from where we are.
  useEffect(() => {
    if (playing) start(); // only on speed changes
  }, [speed]);

  // Auto-play when the chart first scrolls into view.
  const chartRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!file || !chartRef.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.timeline({ scrollTrigger: { trigger: chartRef.current, start: "top 70%", once: true, onEnter: () => start(1) } });
      });
      mm.add("(prefers-reduced-motion: reduce)", () => setVisible(n));
      return () => mm.revert();
    },
    { dependencies: [file] },
  );

  const meta = SCENARIOS.find((s) => s.id === scenario)!;
  const xs = useMemo(() => (file ? file.series.timestamps.map((t) => t * 1000) : []), [file]);
  const eventMarkers: Marker[] = useMemo(() => {
    if (!file) return [];
    return meta.events
      .map((e) => ({ e, i: xs.findIndex((x) => x >= e.at) }))
      .filter((x) => x.i >= 0)
      .map(({ e, i }) => ({ i, kind: "event" as const, label: e.label }));
  }, [file, meta, xs]);

  const lpSeries = file ? POOLS.map((p) => ({ id: p.id, label: p.label, color: p.color, dashed: p.dashed, values: file.series.pools[p.id].lvrUsd.map((v) => -v) })) : [];
  const priceSeries = file
    ? [
        { id: "oracle", label: "Oracle (proxy)", color: "var(--color-ink-2)", values: file.series.oracle },
        { id: "mark", label: "Mark (candle close)", color: "var(--color-neutral)", dashed: true, values: file.series.mark },
      ]
    : [];

  const at = Math.min(visible, n) - 1;
  const liveMinusDelayed = file ? Number(file.results.avenLive.lvrUsd) * -1 - Number(file.results.avenDelayed.lvrUsd) * -1 : 0;
  const nonDefault = settings.cap !== "1" || settings.premium !== "on";
  const repo = config.repoUrl;

  return (
    <div ref={ref}>
      <UsePageMode mode="REPLAY" />
      <PageHero eyebrow="Replay" title="Same market. Four pools." lede="Real Hyperliquid data through a real v4 PoolManager. Only the fee differs." />
      <div className="mx-auto max-w-7xl px-6 pb-10">

      {/* Setup */}
      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            data-reveal
            disabled={!s.available}
            onClick={() => setScenario(s.id)}
            className={`group relative flex flex-col items-start justify-start overflow-hidden rounded-[24px] border p-6 text-left transition ${
              scenario === s.id ? "border-mint/60 bg-raised" : "border-line bg-surface hover:border-line-strong"
            } disabled:cursor-not-allowed disabled:opacity-45`}
          >
            <p className="text-[17px] font-medium tracking-[-0.02em] text-ink">{s.label}</p>
            <p className="mt-1.5 text-sm text-muted">{s.why}</p>
            {s.id === scenario && file ? (
              <p className="num mt-auto pt-4 text-[11px] text-ink-2">
                {dateUtc(xs[0]!)} → {dateUtc(xs[xs.length - 1]!).slice(11)} · {file.interval} candles · {int(file.steps)} steps
              </p>
            ) : (
              <p className="mt-auto pt-4 text-[11px] text-faint">{s.available ? "Hyperliquid mainnet info API" : <span className="rounded-full border border-line px-2.5 py-1 text-muted">Soon</span>}</p>
            )}
          </button>
        ))}
      </div>

      <Card data-reveal className="mt-6">
        <div className="flex flex-wrap items-end gap-6">
          <Seg label="Fee ceiling" value={settings.cap} options={[["1", "1% (spec)"], ["3", "3%"]]} onChange={(v) => setSettings((s) => ({ ...s, cap: v as "1" | "3" }))} />
          <Seg label="Premium term" value={settings.premium} options={[["on", "On (spec)"], ["off", "Off"]]} onChange={(v) => setSettings((s) => ({ ...s, premium: v as "on" | "off" }))} />
          <div>
            <p className="mb-1.5 text-[11px] text-muted">Retail seed</p>
            <p className="num rounded-full border border-line px-3.5 py-1.5 text-xs text-ink-2">{RETAIL_SEED} (“RETAIL”)</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Magnetic>
              <button onClick={() => (playing ? pause() : start())} disabled={!file} className="btn btn-primary btn-sm disabled:opacity-40">
                {playing ? "❚❚ Pause" : visible >= n && n > 1 ? "▶ Replay" : visible > 1 ? "▶ Resume" : "▶ Run"}
              </button>
            </Magnetic>
            <button onClick={() => start(1)} disabled={!file} className="btn btn-ghost btn-sm disabled:opacity-40">
              ↺ Restart
            </button>
            <div className="flex rounded-full border border-line p-0.5 text-xs" role="radiogroup" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s} role="radio" aria-checked={speed === s} onClick={() => setSpeed(s)} className={`num rounded-full px-2.5 py-1 ${speed === s ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </div>
        {nonDefault && (
          <div className="mt-4">
            <Notice tone="warn" title="Only the spec defaults are precomputed">
              The replay runs offline in Foundry, and we publish only the untuned defaults (1% ceiling, premium on). Charts below still show the defaults. To try this variant, change the
              Params in contracts/test/replay/Replay.t.sol and run <span className="num">pnpm replay:{scenario}</span>.
            </Notice>
          </div>
        )}
      </Card>

      {err && (
        <div className="mt-6">
          <Notice tone="error" title="Could not load the replay">
            {err}
          </Notice>
        </div>
      )}

      {/* Results */}
      <div ref={chartRef} className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card data-reveal>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-ink">LP value minus holding (HODL)</p>
            <span className="num text-xs text-muted">
              step {Math.max(1, Math.min(visible, n))} / {n || "—"}
              {file && at >= 0 ? ` · ${dateUtc(xs[at]!)}` : ""}
            </span>
          </div>
          {!file ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <LineChart xs={xs} series={lpSeries} markers={eventMarkers} visible={visible} baseline={0} yFormat={(v) => usd(v, 0)} xFormat={(x) => dateUtc(x).slice(11)} ariaLabel="LP value minus HODL over time for four pools" yLabel="$ above HODL (higher = LPs better off)" />
          )}
          <div className="mt-2 flex flex-wrap justify-between gap-2">
            <Src>Replay.t.sol · LP value = principal + collected fees at the oracle proxy</Src>
            <UsdNote />
          </div>
        </Card>
        <Card data-reveal className="flex flex-col justify-between">
          <div>
            <p className="text-[13px] text-muted">The edge is read speed</p>
            <p className="mt-4 text-sm text-ink-2">Live hook vs. the same hook 60 s late</p>
            <p className="mt-3 text-[clamp(2.6rem,5vw,3.8rem)] font-medium leading-none tracking-[-0.05em] text-ink">
              {file ? <CountUp value={liveMinusDelayed} format={(v) => signedUsd(v)} /> : "—"}
            </p>
            <p className="mt-3 text-sm text-muted">Same formula, same trades. Only price freshness differs.</p>
          </div>
          {file && (
            <div className="mt-6 space-y-2">
              {POOLS.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-ink-2">
                    <svg width="16" height="6" aria-hidden>
                      <line x1="1" y1="3" x2="15" y2="3" stroke={p.color} strokeWidth="2" strokeDasharray={p.dashed ? "4 3" : undefined} />
                    </svg>
                    {p.label}
                  </span>
                  <span className="num text-ink">{signedUsd(-(file.series.pools[p.id].lvrUsd[at] ?? 0))}</span>
                </div>
              ))}
              <Src>value at the current playback step</Src>
            </div>
          )}
        </Card>
      </div>

      <Card data-reveal className="mt-6">
        <p className="mb-2 text-sm font-medium text-ink">The underlying price series</p>
        {!file ? (
          <Skeleton className="h-60 w-full" />
        ) : (
          <LineChart xs={xs} series={priceSeries} markers={eventMarkers} visible={visible} height={240} yFormat={(v) => num(v, 2)} xFormat={(x) => dateUtc(x).slice(11)} ariaLabel="HYPE oracle proxy and mark price over time" yLabel="HYPE price (USD)" />
        )}
        <Src>Hyperliquid info API · candleSnapshot {file?.interval ?? ""} + hourly fundingHistory · oracle proxy = close / (1 + premium)</Src>
      </Card>

      {file && (
        <Card data-reveal className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">Results per pool · final values</p>
            <div className="flex gap-2">
              <button
                onClick={() => download(`${file.scenario}-results.csv`, resultsCsv(file))}
                className="rounded-full border border-line-strong px-4 py-1.5 text-xs text-ink-2 hover:border-ink hover:text-ink"
              >
                ↓ Results CSV
              </button>
            </div>
          </div>
          <div className="no-scrollbar -mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  {["Pool", "LP value vs HODL", "LVR %", "Fees earned", "Arb profit", "LP share", "Arb trades", "Retail trades"].map((h) => (
                    <th key={h} className="pb-2 pr-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                {[...POOLS]
                  .sort((a, b) => Number(file.results[a.id].lvrUsd) - Number(file.results[b.id].lvrUsd))
                  .map((p) => {
                    const r = file.results[p.id];
                    return (
                      <tr key={p.id} className="border-t border-line/70">
                        <td className="py-3 pr-4 font-sans text-ink">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                            {p.label}
                          </span>
                        </td>
                        <td className={`py-3 pr-4 ${-Number(r.lvrUsd) >= 0 ? "text-ink" : "text-ink-2"}`}>{signedUsd(-Number(r.lvrUsd))}</td>
                        <td className="py-3 pr-4 text-ink-2">{num(Number(r.lvrPct), 3)}%</td>
                        <td className="py-3 pr-4 text-ink-2">{usd(Number(r.feesEarnedUsd))}</td>
                        <td className="py-3 pr-4 text-faint" title="The replay does not log arbitrage profit yet">n/r</td>
                        <td className="py-3 pr-4 text-faint" title="Needs arbitrage profit, which the replay does not log yet">n/r</td>
                        <td className="py-3 pr-4 text-ink-2">{int(r.arbTrades)}</td>
                        <td className="py-3 text-ink-2">{int(r.retailTrades)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            n/r = not recorded: the replay logs LP value, fees and trade counts, not the arbitrageur&apos;s profit, so arbitrage profit and LP share are left blank rather than estimated.
            LVR % is (HODL − LP value) / HODL; negative means LPs beat holding.
          </p>
        </Card>
      )}

      {/* Method and sharing */}
      <div className="mt-6 grid gap-6">
        <Card data-reveal className="flex flex-wrap items-center gap-6">
          <div className="shrink-0 rounded-2xl border border-line bg-surface p-2.5">{qr ? <img src={qr} alt="QR code for the share link" width={104} height={104} /> : <Skeleton className="h-[104px] w-[104px]" />}</div>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-medium tracking-[-0.02em] text-ink">Share this replay</p>
            <p className="mt-1 text-sm text-muted">The link keeps the scenario and settings.</p>
            <p className="num mt-3 truncate text-[11px] text-ink-2">{shareUrl}</p>
          </div>
          <CopyButton value={shareUrl} label="Copy link" />
        </Card>
        <Details summary="Method and limits">
          <dl className="space-y-3 text-xs leading-relaxed">
            {[
              ["Oracle", "Not the historical validator oracle: a proxy, candle close / (1 + hourly funding premium). The candle close stands in for the mark."],
              ["Delay", "The delayed hook reads a second mock perp fed the same prices about 60 s earlier, linearly interpolated between candles (1m candles aren't served for these dates)."],
              ["Arbitrage", "One attempt per pool per step, using the Arena bot's algorithm; profit is measured at the true (live) oracle and unprofitable trades are reverted."],
              ["Retail flow", `A seeded random swap of $100–$3,000 in a random direction each step, identical on every pool. Seed ${RETAIL_SEED}.`],
              ["Liquidity", "1,000 base tokens per pool, range about −50% / +50% around the start price."],
              ["Limits", file?.limits ?? "…"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[88px_1fr] gap-3 border-b border-line/50 pb-3 last:border-0">
                <dt className="text-muted">{k}</dt>
                <dd className="text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
          {file?.note && <p className="mt-4 text-xs text-ink-2">Context: {file.note}</p>}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {SCENARIOS.filter((s) => s.available).map((s) => (
              <a key={s.id} href={`${repo}/blob/main/backend/data/replay/${s.id}.csv`} target="_blank" rel="noreferrer" className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
                {s.id}.csv ↗
              </a>
            ))}
            <a href={`${repo}/blob/main/backend/data/replay/README.md`} target="_blank" rel="noreferrer" className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              Method README ↗
            </a>
          </div>
        </Details>
      </div>
      </div>
    </div>
  );
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] text-muted">{label}</p>
      <div className="flex rounded-full border border-line p-0.5 text-xs" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`rounded-full px-3.5 py-1.5 transition ${value === v ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function download(name: string, body: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
