"use client";
/**
 * Arena data: LIVE from the Arena service (REST + SSE, docs/spec/API.md) or RECORDED from
 * public/arena-fallback.json. LIVE falls back to RECORDED when the service is unreachable, and says so.
 * One provider per page so every panel shares the same snapshot.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { config, type Deployments } from "@/config";
import type { ArenaConfigResponse, BotStatus, RecordedRun, Shock, StateResponse, Stats, Trade, VerifyResult } from "@/lib/types";

export interface HistoryPoint {
  ts: number;
  block: number;
  oracle: number;
  mark: number;
  control: number;
  aven: number;
}

export interface ArenaData {
  mode: "LIVE" | "RECORDED";
  status: "loading" | "ok" | "error";
  /** Why we are in RECORDED mode, or the last LIVE error. */
  note: string | null;
  /** Addresses for the configured chain (null until known). Never filled from a recording of another chain. */
  deployments: Deployments | null;
  /** For fee math and labels only (config, params, token symbols): the real deployment, else the recorded run's. */
  math: Deployments | null;
  state: StateResponse | null;
  stats: Stats | null;
  trades: Trade[];
  shocks: Shock[];
  bot: BotStatus | null;
  history: HistoryPoint[];
  /** Block at which the oracle raw value last changed (for "blocks since the oracle changed"). */
  oracleChangedAt: number | null;
  lastBlock: number | null;
  streaming: boolean;
  recorded: RecordedRun | null;
  adminToken: string;
  setAdminToken: (t: string) => void;
  post: (path: "/shock" | "/bot/start" | "/bot/stop" | "/reset-stats", body?: unknown) => Promise<unknown>;
  verify: (tx: string) => Promise<VerifyResult>;
  refresh: () => void;
}

const Ctx = createContext<ArenaData | null>(null);

export function useArena(): ArenaData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useArena outside <ArenaProvider>");
  return v;
}

const HISTORY_MAX = 600;
const api = (p: string) => `${config.arenaApi}${p}`;

async function getJson<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(api(path), { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}${await r.text().then((x) => (x ? ` ${x.slice(0, 120)}` : ""), () => "")}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export function toDeployments(c: ArenaConfigResponse, base?: Deployments | null): Deployments {
  return {
    chainId: c.chainId,
    deployedAtBlock: base?.deployedAtBlock ?? 0,
    explorer: c.explorer ?? base?.explorer,
    tokens: base?.tokens ?? { base: c.pools.aven.key.currency0, quote: c.pools.aven.key.currency1, baseSymbol: "aETH", quoteSymbol: "aUSD" },
    poolManager: c.poolManager as `0x${string}`,
    swapRouter: base?.swapRouter ?? ("0x" as `0x${string}`),
    liquidityRouter: base?.liquidityRouter ?? ("0x" as `0x${string}`),
    hook: c.hook as `0x${string}`,
    pools: c.pools,
    config: c.config,
    params: c.params,
  };
}

function pointOf(s: StateResponse): HistoryPoint {
  return { ts: s.ts, block: s.block, oracle: s.oracle.price, mark: s.mark.price, control: s.pools.control.price, aven: s.pools.aven.price };
}

export function ArenaProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"LIVE" | "RECORDED">(config.mode === "recorded" ? "RECORDED" : "LIVE");
  const [status, setStatus] = useState<ArenaData["status"]>("loading");
  const [note, setNote] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployments | null>(config.deployments);
  const [state, setState] = useState<StateResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [shocks, setShocks] = useState<Shock[]>([]);
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [oracleChangedAt, setOracleChangedAt] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [recorded, setRecorded] = useState<RecordedRun | null>(null);
  const [recordedDeployments, setRecordedDeployments] = useState<Deployments | null>(null);
  const [adminToken, setAdminTokenState] = useState("");
  const [nonce, setNonce] = useState(0);
  const lastOracle = useRef<string | null>(null);

  // Admin token: ?admin=<token> (FRONTEND.md B6) or the session.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("admin");
    const t = q ?? sessionStorage.getItem("aven-admin") ?? "";
    if (q) sessionStorage.setItem("aven-admin", q);
    setAdminTokenState(t);
  }, []);
  const setAdminToken = useCallback((t: string) => {
    setAdminTokenState(t);
    if (t) sessionStorage.setItem("aven-admin", t);
    else sessionStorage.removeItem("aven-admin");
  }, []);

  const ingestState = useCallback((s: StateResponse) => {
    setState(s);
    if (lastOracle.current !== s.oracle.raw) {
      if (lastOracle.current !== null) setOracleChangedAt(s.block);
      else setOracleChangedAt((p) => p ?? s.block);
      lastOracle.current = s.oracle.raw;
    }
    setHistory((h) => {
      if (h.length && h[h.length - 1]!.block === s.block) return [...h.slice(0, -1), pointOf(s)];
      const next = [...h, pointOf(s)];
      return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next;
    });
  }, []);

  const loadRecorded = useCallback(async (why: string | null) => {
    setMode("RECORDED");
    setNote(why);
    try {
      const r = (await fetch("/arena-fallback.json", { cache: "no-store" }).then((x) => x.json())) as RecordedRun;
      setRecorded(r);
      const rd = toDeployments(r.config);
      setRecordedDeployments(rd);
      // A recording from another chain (e.g. the local anvil run) must not pose as this chain's addresses.
      if (r.chainId === config.chainId) setDeployments((d) => d ?? rd);
      const states = [r.state.before, r.state.afterShock, r.state.after];
      setState(r.state.after);
      setHistory(states.map(pointOf));
      setOracleChangedAt(r.state.before.block);
      setStats(r.stats);
      setTrades([...r.trades].sort((a, b) => b.ts - a.ts));
      setShocks([r.shock]);
      setBot({ enabled: false, lastRunBlock: r.state.after.block, lastError: null, balances: {} });
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setNote(`Recorded run could not be loaded: ${(e as Error).message}`);
    }
  }, []);

  // LIVE bootstrap + SSE, or RECORDED.
  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let slow: ReturnType<typeof setInterval> | null = null;

    if (config.mode === "recorded" || !config.arenaApi) {
      void loadRecorded(config.mode === "recorded" ? "Recorded mode is set for this deployment." : "No Arena service is configured.");
      return;
    }

    const refreshSlow = async () => {
      try {
        const [st, b] = await Promise.all([getJson<Stats>("/stats"), getJson<BotStatus>("/bot/status")]);
        if (!alive) return;
        setStats(st);
        setBot(b);
      } catch (e) {
        if (alive) setNote((e as Error).message);
      }
    };

    (async () => {
      try {
        await getJson("/health", 4_000);
        const [cfg, st, tr, b] = await Promise.all([
          getJson<ArenaConfigResponse>("/config"),
          getJson<Stats>("/stats"),
          getJson<Trade[]>("/trades?limit=200"),
          getJson<BotStatus>("/bot/status"),
        ]);
        if (!alive) return;
        setMode("LIVE");
        setDeployments((d) => toDeployments(cfg, d ?? config.deployments));
        setStats(st);
        setTrades(tr);
        setBot(b);
        setStatus("ok");
        setNote(null);
        try {
          ingestState(await getJson<StateResponse>("/state"));
        } catch {
          /* SSE sends a state first anyway */
        }

        es = new EventSource(api("/stream"));
        es.addEventListener("open", () => alive && setStreaming(true));
        es.addEventListener("state", (ev) => alive && ingestState(JSON.parse((ev as MessageEvent).data) as StateResponse));
        es.addEventListener("trade", (ev) => {
          if (!alive) return;
          const t = JSON.parse((ev as MessageEvent).data) as Trade;
          setTrades((p) => [t, ...p.filter((x) => x.id !== t.id)].slice(0, 500));
          void refreshSlow();
        });
        es.addEventListener("shock", (ev) => alive && setShocks((p) => [JSON.parse((ev as MessageEvent).data) as Shock, ...p].slice(0, 50)));
        es.addEventListener("bot", (ev) => {
          const d = JSON.parse((ev as MessageEvent).data) as { enabled?: boolean; reason?: string; ping?: number };
          if (alive && typeof d.enabled === "boolean") setBot((b0) => (b0 ? { ...b0, enabled: d.enabled!, lastError: d.reason ?? b0.lastError } : b0));
        });
        es.onerror = () => {
          if (!alive) return;
          setStreaming(false);
          // Fallback: poll /state while the stream reconnects (EventSource retries by itself).
          if (!poll)
            poll = setInterval(async () => {
              try {
                const s = await getJson<StateResponse>("/state");
                if (alive) {
                  ingestState(s);
                  setNote(null);
                }
              } catch (e) {
                if (alive) setNote(`Arena service: ${(e as Error).message}`);
              }
            }, config.pollMs);
        };
        es.addEventListener("open", () => {
          if (poll) {
            clearInterval(poll);
            poll = null;
          }
        });
        slow = setInterval(refreshSlow, config.pollMs * 3);
      } catch (e) {
        if (alive) void loadRecorded(`Arena service unreachable (${(e as Error).message}). Showing the recorded run.`);
      }
    })();

    return () => {
      alive = false;
      es?.close();
      if (poll) clearInterval(poll);
      if (slow) clearInterval(slow);
    };
  }, [ingestState, loadRecorded, nonce]);

  const post = useCallback(
    async (path: "/shock" | "/bot/start" | "/bot/stop" | "/reset-stats", body?: unknown) => {
      if (mode !== "LIVE") throw new Error("Controls need the live Arena service.");
      const r = await fetch(api(path), {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify(body ?? {}),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (path === "/reset-stats") setStats(await getJson<Stats>("/stats"));
      if (path === "/bot/start" || path === "/bot/stop") setBot((b) => (b ? { ...b, enabled: path === "/bot/start" } : b));
      return j;
    },
    [mode, adminToken],
  );

  const verify = useCallback(
    async (tx: string): Promise<VerifyResult> => {
      if (mode === "RECORDED") {
        const v = recorded?.highlight.verify;
        if (v && recorded?.highlight.avenArb.txHash.toLowerCase() === tx.toLowerCase()) return v;
        throw new Error("This recorded run only kept the verify result of its highlighted Aven trade.");
      }
      return getJson<VerifyResult>(`/verify/${tx}`, 15_000);
    },
    [mode, recorded],
  );

  const value = useMemo<ArenaData>(
    () => ({
      mode,
      status,
      note,
      deployments,
      math: deployments ?? recordedDeployments,
      state,
      stats,
      trades,
      shocks,
      bot,
      history,
      oracleChangedAt,
      lastBlock: state?.block ?? null,
      streaming,
      recorded,
      adminToken,
      setAdminToken,
      post,
      verify,
      refresh: () => setNonce((n) => n + 1),
    }),
    [mode, status, note, deployments, recordedDeployments, state, stats, trades, shocks, bot, history, oracleChangedAt, streaming, recorded, adminToken, setAdminToken, post, verify],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
