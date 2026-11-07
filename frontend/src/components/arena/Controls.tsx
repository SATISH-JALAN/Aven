"use client";
import { useMemo, useState } from "react";
import { LineChart, type Marker } from "@/components/LineChart";
import { Magnetic } from "@/components/motion";
import { Card, Empty, Notice, Src } from "@/components/ui";
import { useArena, type AdminPath } from "@/lib/arena";
import { int, num, timeUtc } from "@/lib/format";

// ------------------------------------------------------------------------------------------------ controls

export function Controls() {
  const a = useArena();
  const [size, setSize] = useState("");
  const [dir, setDir] = useState<"buyBase" | "sellBase">("buyBase");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const live = a.mode === "LIVE";
  const can = live && !!a.adminToken;
  const lastTrade = a.trades[0];
  const sym = a.math?.tokens.baseSymbol ?? "base";

  const run = async (label: string, path: AdminPath, body?: unknown) => {
    setBusy(label);
    setMsg(null);
    try {
      await a.post(path, body);
      setMsg({ tone: "info", text: `${label}: done.` });
    } catch (e) {
      setMsg({ tone: "error", text: `${label} failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const btn = "rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <Card data-reveal className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Controls</p>
          <p className="text-xs text-muted">Admin only. The bot and shock wallets belong to the Arena service.</p>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-line px-4 py-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${a.bot?.enabled ? "live-dot bg-aven-glow text-aven-glow" : "bg-faint"}`} />
          <span className="text-ink">{a.bot?.enabled ? "Bot running" : "Bot idle"}</span>
          <span className="text-faint">·</span>
          <span className="num text-ink-2">last block #{a.bot?.lastRunBlock ? int(a.bot.lastRunBlock) : "—"}</span>
          <span className="text-faint">·</span>
          <span className="num text-ink-2">last trade {lastTrade ? timeUtc(lastTrade.ts) : "—"}</span>
        </div>
      </div>

      {!live && <Notice tone="warn" title="Controls need the live Arena service">This page is showing a recorded run, so shocks and the bot are switched off.</Notice>}
      {live && !a.adminToken && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder="Admin token"
            className="w-56 rounded-full border border-line bg-bg px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
          <button className={`${btn} border border-line-strong text-ink hover:border-ink`} onClick={() => a.setAdminToken(tokenDraft.trim())} disabled={!tokenDraft.trim()}>
            Unlock controls
          </button>
          <span className="text-[11px] text-faint">or open the page with ?admin=&lt;token&gt;. Kept in this tab only.</span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
        <div className="rounded-[22px] border border-line p-5">
          <p className="mb-3 text-xs text-muted">Shock both pools: the same swap on each, from the shock wallet</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-muted">
              Size ({sym})
              <input
                inputMode="decimal"
                value={size}
                onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="default"
                className="num mt-1 block w-36 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
              />
            </label>
            <div className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Shock direction">
              {(["buyBase", "sellBase"] as const).map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={dir === d}
                  onClick={() => setDir(d)}
                  className={`rounded-md px-3 py-1.5 transition ${dir === d ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
                >
                  {d === "buyBase" ? `Buy ${sym}` : `Sell ${sym}`}
                </button>
              ))}
            </div>
            <Magnetic>
              <button
                className={`${btn} bg-warn text-bg hover:brightness-110`}
                disabled={!can || !!busy || (size !== "" && !(Number(size) > 0))}
                onClick={() => run("Shock", "/shock", { ...(size ? { sizeBase: size } : {}), direction: dir })}
              >
                {busy === "Shock" ? "Shocking…" : "⚡ Shock both pools"}
              </button>
            </Magnetic>
          </div>
          <p className="mt-2 text-[11px] text-faint">Tip: buying {sym} pushes both pools above fair, so the bot&apos;s arb is a sell and shows the pure gap fee.</p>
        </div>
        <div className="flex flex-wrap content-start gap-3 rounded-[22px] border border-line p-5">
          <p className="w-full text-xs text-muted">Bot and counters</p>
          <button className={`${btn} bg-ink text-bg hover:bg-white`} disabled={!can || !!busy || a.bot?.enabled === true} onClick={() => run("Start bot", "/bot/start")}>
            Start bot
          </button>
          <button className={`${btn} border border-line-strong text-ink hover:border-ink`} disabled={!can || !!busy || a.bot?.enabled === false} onClick={() => run("Stop bot", "/bot/stop")}>
            Stop bot
          </button>
          <button className={`${btn} text-muted hover:text-ink`} disabled={!can || !!busy} onClick={() => run("Reset counters", "/reset-stats")}>
            Reset counters
          </button>
        </div>
      </div>

      {a.bot?.lastError && <Notice tone="warn" title="Bot reported an error">{a.bot.lastError}</Notice>}
      {msg && <Notice tone={msg.tone === "error" ? "error" : "info"} title={msg.text} />}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ chart

export function ArenaChart() {
  const { history, trades, shocks, mode } = useArena();
  const { xs, series, markers } = useMemo(() => {
    const xs = history.map((h) => h.ts);
    const near = (ts: number) => {
      let best = 0;
      for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i]! - ts) < Math.abs(xs[best]! - ts)) best = i;
      return best;
    };
    const markers: Marker[] = [];
    if (xs.length) {
      for (const s of shocks) if (s.ts >= xs[0]! - 5_000) markers.push({ i: near(s.ts), seriesId: "aven", kind: "shock", label: `Shock · ${s.direction} ${num(Number(s.sizeBase), 3)}` });
      for (const t of trades)
        if (t.kind === "arb" && t.ts >= xs[0]! - 5_000)
          markers.push({ i: near(t.ts), seriesId: t.pool, kind: "trade", label: `Bot ${t.direction} on ${t.pool === "aven" ? "Aven" : "plain"} · fee ${t.feePips} pips` });
    }
    return {
      xs,
      markers,
      series: [
        { id: "control", label: "Plain 0.30%", color: "var(--color-plain)", values: history.map((h) => h.control) },
        { id: "aven", label: "Aven", color: "var(--color-aven)", values: history.map((h) => h.aven) },
        { id: "oracle", label: "Oracle (fair)", color: "var(--color-ink-2)", dashed: true, values: history.map((h) => h.oracle) },
      ],
    };
  }, [history, trades, shocks]);

  return (
    <Card data-reveal>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Pool prices vs the oracle</p>
        <Src>{mode === "RECORDED" ? "recorded /state snapshots: before, after shock, after arbs" : "/state stream, one point per block"}</Src>
      </div>
      {xs.length < 2 ? (
        <Empty>Waiting for a second block of data…</Empty>
      ) : (
        <LineChart xs={xs} series={series} markers={markers} yFormat={(v) => num(v, 2)} xFormat={(x) => timeUtc(x)} ariaLabel="Plain pool price, Aven pool price and oracle price over time" yLabel="price (quote per base)" />
      )}
    </Card>
  );
}
