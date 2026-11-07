/**
 * Browser RPC load balancer over several HyperEVM endpoints (recon §F: 7 public mainnet RPCs, all checked for chain
 * 999, open CORS, HyperCore precompile reads, historical eth_getLogs, receipts and JSON-RPC batches).
 *
 * Why: the public endpoints rate-limit per IP (the official one allows 100 requests/min, recon §E.4), and a single
 * busy page (on-chain scan + block poller + verify) used to hit -32005 "Request exceeds defined limit", which showed
 * as "RPC down". Spreading calls over N endpoints gives N budgets; failing over on a throttle hides it from the user.
 *
 * Policy, per request:
 * - pick the healthy endpoint with the lowest  latencyEWMA × (1 + in-flight), skipping any that is ≥ 2 blocks behind
 *   the freshest head seen (so a lagging node never serves stale oracle/pool state) and any that already took its
 *   budget of calls in the last 60 s (90, under the official endpoint's 100/min), so load spreads before a throttle;
 * - throttled (429, -32005, "rate limit") → cool that endpoint down (4 s, doubling, ≤ 60 s) and try the next;
 *   network / timeout / 5xx / unsupported method → cool down 2 s (doubling) and try the next;
 *   anything else (a revert, bad params) is the answer and is thrown at once: every node would say the same.
 * - eth_blockNumber is hedged: asked of the two best endpoints at once, the higher block wins. A new block (with the
 *   oracle and mark HyperCore wrote into it) is therefore seen as soon as either node has it.
 */
import { custom, http, type Transport } from "viem";

export interface RpcArgs {
  method: string;
  params?: unknown;
}
export type RequestFn = (args: RpcArgs) => Promise<unknown>;
export interface Upstream {
  url: string;
  request: RequestFn;
}

export interface EndpointState {
  url: string;
  ewmaMs: number;
  inflight: number;
  cooldownUntil: number;
  strikes: number;
  head: bigint;
  ok: number;
  fail: number;
  lastError: string | null;
  /** Start times of the calls made in the last 60 s (budget window). */
  recent: number[];
}

export type ErrorKind = "throttled" | "transient" | "final";

const msgOf = (e: unknown) =>
  `${String((e as { details?: string })?.details ?? "")} ${String((e as Error)?.message ?? e)} ${String((e as { status?: number })?.status ?? "")} ${String((e as { code?: number })?.code ?? "")}`;

/** How a failed call should be treated. Exported for tests. */
export function classify(e: unknown): ErrorKind {
  const m = msgOf(e);
  if (/-32005|rate.?limit|exceeds defined limit|\b429\b|too many requests|quota|capacity exceeded/i.test(m)) return "throttled";
  if (
    /timed? ?out|timeout|fetch failed|failed to fetch|networkerror|network error|HTTP request failed|\b50[0-9]\b|bad gateway|service unavailable|ECONN|socket|aborted|-32601|method not found|not supported|unsupported method/i.test(
      m,
    )
  )
    return "transient";
  return "final";
}

const BASE_COOLDOWN = { throttled: 4_000, transient: 2_000 } as const;
const MAX_COOLDOWN = 60_000;
/** A node this many blocks behind the freshest head seen is skipped while fresher ones are healthy. */
const MAX_LAG = 2n;
/** Calls per endpoint per 60 s before it's treated as busy (the official RPC allows 100/min per IP, recon §E.4). */
export const PER_MIN_BUDGET = 90;

export interface Balancer {
  request: RequestFn;
  /** Hedged eth_blockNumber: the max of the two best endpoints' answers. */
  head(): Promise<bigint>;
  states(): readonly EndpointState[];
  healthy(): number;
}

export function createBalancer(upstreams: Upstream[], now: () => number = Date.now): Balancer {
  if (!upstreams.length) throw new Error("rpc: no endpoints");
  // Initial latency guess keeps the configured order until real measurements arrive.
  const states: EndpointState[] = upstreams.map((u, i) => ({
    url: u.url,
    ewmaMs: 300 + i * 50,
    inflight: 0,
    cooldownUntil: 0,
    strikes: 0,
    head: 0n,
    ok: 0,
    fail: 0,
    lastError: null,
    recent: [],
  }));
  const byUrl = new Map(upstreams.map((u) => [u.url, u]));
  const bestHead = () => states.reduce((m, s) => (s.head > m ? s.head : m), 0n);

  const score = (s: EndpointState, best: bigint) =>
    s.ewmaMs * (1 + s.inflight) + (best > 0n && s.head > 0n && s.head + MAX_LAG <= best ? 10_000 : 0);

  /** The next endpoint to try, never one in `exclude`. Cooling endpoints are used only when nothing else is left. */
  function pick(exclude: Set<string>): EndpointState | null {
    const t = now();
    const best = bestHead();
    const open = states.filter((s) => !exclude.has(s.url));
    if (!open.length) return null;
    for (const s of open) while (s.recent.length && s.recent[0]! <= t - 60_000) s.recent.shift();
    const ready = open.filter((s) => s.cooldownUntil <= t && s.recent.length < PER_MIN_BUDGET);
    if (ready.length) return ready.reduce((a, b) => (score(b, best) < score(a, best) ? b : a));
    // Everything is cooling or over budget: the one free soonest (budget first: it's a soft limit).
    const free = (s: EndpointState) => Math.max(s.cooldownUntil, s.recent.length >= PER_MIN_BUDGET ? s.recent[0]! + 60_000 : 0);
    return open.reduce((a, b) => (free(b) < free(a) ? b : a));
  }

  async function attempt(s: EndpointState, args: RpcArgs): Promise<unknown> {
    s.inflight++;
    const t0 = now();
    s.recent.push(t0);
    try {
      const r = await byUrl.get(s.url)!.request(args);
      s.ewmaMs = s.ewmaMs * 0.8 + (now() - t0) * 0.2;
      s.strikes = 0;
      s.ok++;
      if (args.method === "eth_blockNumber" && typeof r === "string") {
        const b = BigInt(r);
        if (b > s.head) s.head = b;
      }
      return r;
    } catch (e) {
      const kind = classify(e);
      if (kind !== "final") {
        s.strikes++;
        s.fail++;
        s.cooldownUntil = now() + Math.min(MAX_COOLDOWN, BASE_COOLDOWN[kind] * 2 ** (s.strikes - 1));
        s.lastError = msgOf(e).trim().split(/\r?\n/)[0]!.slice(0, 140);
      }
      throw e;
    } finally {
      s.inflight--;
    }
  }

  async function request(args: RpcArgs): Promise<unknown> {
    const tried = new Set<string>();
    let last: unknown = new Error("rpc: no endpoint answered");
    for (;;) {
      const s = pick(tried);
      if (!s) throw last;
      tried.add(s.url);
      try {
        return await attempt(s, args);
      } catch (e) {
        if (classify(e) === "final") throw e;
        last = e;
      }
    }
  }

  async function head(): Promise<bigint> {
    const first = pick(new Set());
    const second = first ? pick(new Set([first.url])) : null;
    const pair = [first, second].filter((s): s is EndpointState => !!s && s.cooldownUntil <= now());
    if (pair.length) {
      const res = await Promise.allSettled(pair.map((s) => attempt(s, { method: "eth_blockNumber", params: [] })));
      const got = res.flatMap((r) => (r.status === "fulfilled" && typeof r.value === "string" ? [BigInt(r.value)] : []));
      if (got.length) return got.reduce((m, b) => (b > m ? b : m));
    }
    return BigInt((await request({ method: "eth_blockNumber", params: [] })) as string);
  }

  return {
    request,
    head,
    states: () => states,
    healthy: () => states.filter((s) => s.cooldownUntil <= now()).length,
  };
}

let shared: Balancer | null = null;
/** The app's balancer (created with the first client), for status displays. */
export const rpcBalancer = () => shared;

/** viem transport over a balancer. Each upstream is a plain http transport with JSON-RPC batching and no own retries. */
export function balancedTransport(urls: string[], timeout = 10_000): Transport {
  return (opts) => {
    const upstreams = urls.map((url) => ({
      url,
      request: http(url, { batch: { wait: 8 }, retryCount: 0, timeout })({ ...opts, retryCount: 0, timeout }).request as RequestFn,
    }));
    const bal = createBalancer(upstreams);
    shared = bal;
    return custom(
      {
        request: ({ method, params }: RpcArgs) =>
          method === "eth_blockNumber" ? bal.head().then((b) => `0x${b.toString(16)}`) : bal.request({ method, params }),
      },
      { key: "balanced", name: "Balanced HTTP", retryCount: 0 },
    )(opts);
  };
}
