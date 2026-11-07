/**
 * The chain as the database: no indexer, no server, no DB. Everything here is read from HyperEVM logs and receipts.
 *
 * - Ledger: every Swap / ModifyLiquidity on our two pools (PoolManager) and every FeeComputed (AvenHook), for every
 *   wallet. One eth_getLogs per chunk: address [PoolManager, hook], topic0 [Swap, ModifyLiquidity, FeeComputed],
 *   topic1 [aven pool id, plain pool id] (Swap and FeeComputed both index the pool id first).
 * - Wallet: aETH / aUSD Transfer logs from or to one address (2 calls per chunk), then each transaction's receipt
 *   (1 call, once): swaps, liquidity, faucet mints and transfers, with gas and status.
 *
 * Every Aven swap is verified in the browser with @aven/core/verify `verifyLogs` on its own logs (check A: the fee is
 * §6.3 of the FeeComputed inputs; check B: the PoolManager Swap event charged it; protocol fee 0, our deployment never
 * sets one), at no extra RPC cost.
 *
 * Range limits (docs/recon.md): HyperEVM documents a 50-block eth_getLogs range; the mainnet public RPC served filtered
 * 500-block ranges and refused 999 (2026-11-06). The chunk shrinks by itself on a refusal. Calls are spaced so a tab
 * stays well under the public RPC's 100 requests/min per IP. Scanned ranges are cached in localStorage (a cache, not a
 * database: clear it and the chain gives the same answer back).
 */
import { useEffect, useSyncExternalStore } from "react";
import { decodeEventLog, encodeEventTopics, isAddressEqual, numberToHex, type Address, type Hex } from "viem";
import { avenHookAbi, mockErc20Abi, poolManagerAbi } from "@aven/core/abi";
import { poolWad } from "@aven/core/fee";
import { rawToPrice, wadToNumber } from "@aven/core/price";
import { verifyLogs } from "@aven/core/verify";
import { config, type Deployments } from "@/config";
import { publicClient, verifyTarget } from "@/lib/chain";
import type { Breakdown, Direction, PoolName } from "@/lib/types";

// ------------------------------------------------------------------------------------------------ limits

export const LOG_CHUNK = config.chainId === 999 ? 500 : config.chainId === 998 ? 50 : 5_000;
/** Gap between our RPC calls. The mainnet public RPC throttles eth_getLogs well below its 100 requests/min (measured
 *  2026-11-06: refusals after a handful of quick calls, ~25 s to recover), so pace at 24/min and back off on refusals. */
const CALL_GAP_MS = config.chainId === 31337 ? 0 : 2_500;
const LIVE_MS = config.chainId === 31337 ? 1_500 : 5_000;
const LEDGER_CAP = 5_000;

const T_SWAP = encodeEventTopics({ abi: poolManagerAbi, eventName: "Swap" } as never)[0] as Hex;
const T_LIQ = encodeEventTopics({ abi: poolManagerAbi, eventName: "ModifyLiquidity" } as never)[0] as Hex;
const T_FEE = encodeEventTopics({ abi: avenHookAbi, eventName: "FeeComputed" } as never)[0] as Hex;
const T_XFER = encodeEventTopics({ abi: mockErc20Abi, eventName: "Transfer" } as never)[0] as Hex;
const ZERO = "0x0000000000000000000000000000000000000000";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();
/** Every RPC call of this module goes through one queue, spaced by CALL_GAP_MS. */
function gated<T>(f: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + CALL_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return f();
  });
  queue = run.catch(() => undefined);
  return run;
}

interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

const topicOf = (a: Address) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;

async function getLogs(filter: { address: Address[]; topics: Array<Hex | Hex[] | null> }, from: number, to: number): Promise<RpcLog[]> {
  return gated(() =>
    publicClient().request({
      method: "eth_getLogs",
      params: [{ address: filter.address, topics: filter.topics, fromBlock: numberToHex(from), toBlock: numberToHex(to) }],
    } as never) as Promise<RpcLog[]>,
  );
}

const msgOf = (e: unknown) => String((e as { details?: string })?.details ?? "") + " " + String((e as Error)?.message ?? e);
/** The response was too large for one call: a smaller range helps. */
const tooBig = (e: unknown) => /-32008|too big|response size|block range|range is too/i.test(msgOf(e));
/** Throttled: the mainnet public RPC answers -32005 "Request exceeds defined limit" / "rate limited" even for a
 *  15-block query once its budget is spent (measured 2026-11-06), and recovers after ~25 s. Wait; don't shrink. */
const throttled = (e: unknown) => /-32005|rate limit|exceeds defined limit|429|too many requests|HTTP request failed/i.test(msgOf(e));

// ------------------------------------------------------------------------------------------------ records

export interface FeeInputs {
  fee: number;
  reason: string;
  zeroForOne: boolean;
  oracleRaw: string;
  markRaw: string;
  anchorMarkRaw: string;
  sqrtBefore: string;
  sqrtTop: string;
}

/** One pool event from the chain (strings for bigints, so it can be cached as JSON). */
export interface ChainEvent {
  id: string;
  kind: "swap" | "liquidity";
  tx: Hex;
  block: number;
  logIndex: number;
  pool: PoolName;
  /** Swap: the swapper's deltas (negative = paid in), the price after, the fee charged (pips). */
  amount0: string;
  amount1: string;
  sqrtAfter: string;
  fee: number;
  /** Aven swaps: the FeeComputed inputs, the recomputed breakdown and checks A / B. */
  fc: FeeInputs | null;
  breakdown: Breakdown | null;
  verify: { a: boolean; b: boolean } | null;
  /** Liquidity: the liquidity delta (> 0 add, < 0 remove). */
  liquidityDelta?: string;
}

function decodePoolLogs(logs: Array<Pick<RpcLog, "address" | "topics" | "data" | "transactionHash" | "logIndex"> & { blockNumber: Hex | bigint | number }>, d: Deployments): ChainEvent[] {
  const ids = { aven: d.pools.aven.id.toLowerCase(), control: d.pools.control.id.toLowerCase() };
  const poolOf = (id: string): PoolName | null => (id.toLowerCase() === ids.aven ? "aven" : id.toLowerCase() === ids.control ? "control" : null);
  const byTx = new Map<string, typeof logs>();
  for (const l of logs) {
    const k = l.transactionHash.toLowerCase();
    if (!byTx.has(k)) byTx.set(k, []);
    byTx.get(k)!.push(l);
  }
  const out: ChainEvent[] = [];
  for (const group of byTx.values()) {
    group.sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
    const verified = verifyLogs(group.map((l) => ({ ...l, topics: l.topics as [Hex, ...Hex[]], logIndex: Number(l.logIndex) })), { ...verifyTarget(d), protocolFee: 0 });
    let vi = 0;
    for (const l of group) {
      if (!isAddressEqual(l.address, d.poolManager)) continue;
      try {
        const ev = decodeEventLog({ abi: poolManagerAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        const a = ev.args as unknown as Record<string, unknown>;
        const pool = poolOf(String(a.id));
        if (!pool) continue;
        const base = { tx: l.transactionHash, block: Number(l.blockNumber), logIndex: Number(l.logIndex), pool, id: `${l.transactionHash}:${Number(l.logIndex)}` };
        if (ev.eventName === "Swap") {
          const r = pool === "aven" ? verified[vi++] : undefined;
          out.push({
            ...base,
            kind: "swap",
            amount0: String(a.amount0),
            amount1: String(a.amount1),
            sqrtAfter: String(a.sqrtPriceX96),
            fee: Number(a.fee),
            fc: r
              ? {
                  fee: r.onchainFee,
                  reason: r.inputs.reason!,
                  zeroForOne: r.inputs.zeroForOne === "true",
                  oracleRaw: r.inputs.oracleRaw!,
                  markRaw: r.inputs.markRaw!,
                  anchorMarkRaw: r.inputs.anchorMarkRaw!,
                  sqrtBefore: r.inputs.sqrtPriceX96!,
                  sqrtTop: r.inputs.sqrtPriceTopX96!,
                }
              : null,
            breakdown: r ? (r.breakdown as Breakdown) : null,
            verify: r ? { a: r.checkA, b: r.checkB } : null,
          });
        } else if (ev.eventName === "ModifyLiquidity") {
          out.push({ ...base, kind: "liquidity", amount0: "0", amount1: "0", sqrtAfter: "0", fee: 0, fc: null, breakdown: null, verify: null, liquidityDelta: String(a.liquidityDelta) });
        }
      } catch {
        /* not a PoolManager event we decode */
      }
    }
  }
  return out;
}

/** Human view of a swap: direction, amounts, prices before/after, the HyperCore inputs and the gaps. */
export interface SwapView {
  dir: Direction;
  baseAmt: bigint;
  quoteAmt: bigint;
  priceAfter: number;
  priceBefore: number | null;
  oracle: number | null;
  mark: number | null;
  premiumBps: number | null;
  gapBefore: number | null;
  gapAfter: number | null;
}

export function viewSwap(e: ChainEvent, d: Deployments, oracleHint?: number | null, markHint?: number | null): SwapView {
  const c = d.config;
  const a0 = BigInt(e.amount0);
  const a1 = BigInt(e.amount1);
  const base = c.baseIsToken0 ? a0 : a1;
  const quote = c.baseIsToken0 ? a1 : a0;
  const abs = (x: bigint) => (x < 0n ? -x : x);
  const priceAfter = wadToNumber(poolWad(c, BigInt(e.sqrtAfter)));
  const priceBefore = e.fc ? wadToNumber(poolWad(c, BigInt(e.fc.sqrtBefore))) : null;
  const oracle = e.fc ? rawToPrice(BigInt(e.fc.oracleRaw), c.szDecimals) : (oracleHint ?? null);
  const mark = e.fc ? rawToPrice(BigInt(e.fc.markRaw), c.szDecimals) : (markHint ?? null);
  const bp = (p: number | null) => (p !== null && oracle ? ((p - oracle) / oracle) * 10_000 : null);
  return {
    dir: base > 0n ? "buyBase" : "sellBase",
    baseAmt: abs(base),
    quoteAmt: abs(quote),
    priceAfter,
    priceBefore,
    oracle,
    mark,
    premiumBps: mark !== null && oracle ? ((mark - oracle) / oracle) * 10_000 : null,
    gapBefore: bp(priceBefore),
    gapAfter: bp(priceAfter),
  };
}

/** $ value of a swap's input (quote valued at $1, base at the oracle) and its fee. */
export function swapUsd(e: ChainEvent, v: SwapView, d: Deployments): { inUsd: number | null; feeUsd: number | null } {
  const c = d.config;
  const baseDec = c.baseIsToken0 ? c.decimals0 : c.decimals1;
  const quoteDec = c.baseIsToken0 ? c.decimals1 : c.decimals0;
  const inUsd = v.dir === "buyBase" ? Number(v.quoteAmt) / 10 ** quoteDec : v.oracle ? (Number(v.baseAmt) / 10 ** baseDec) * v.oracle : null;
  return { inUsd, feeUsd: inUsd === null ? null : (inUsd * e.fee) / 1e6 };
}

// ------------------------------------------------------------------------------------------------ scanner

export interface ScanState<T> {
  items: T[];
  /** Lowest and highest scanned block (inclusive), null before the first chunk. */
  from: number | null;
  to: number | null;
  start: number;
  head: number | null;
  chunk: number;
  busy: boolean;
  error: string | null;
  done: boolean;
  /** Older history was dropped from the cache (cap); scan stops there. */
  truncated: boolean;
}

class Scanner<T extends { id: string; block: number }> {
  state: ScanState<T>;
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private okStreak = 0;
  private backoff = 0;

  constructor(
    private readonly key: string,
    start: number,
    private readonly fetchRange: (from: number, to: number) => Promise<T[]>,
    private readonly cap: number,
  ) {
    this.state = { items: [], from: null, to: null, start, head: null, chunk: LOG_CHUNK, busy: false, error: null, done: false, truncated: false };
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) {
        const c = JSON.parse(raw) as Pick<ScanState<T>, "items" | "from" | "to" | "truncated">;
        this.state = { ...this.state, ...c, done: c.from !== null && c.from <= start };
      }
    } catch {
      /* a bad cache is just a cold start */
    }
  }

  subscribe = (f: () => void) => {
    this.subs.add(f);
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), LIVE_MS);
      void this.tick();
    }
    return () => {
      this.subs.delete(f);
      if (!this.subs.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };
  get = () => this.state;

  private set(p: Partial<ScanState<T>>) {
    this.state = { ...this.state, ...p };
    this.subs.forEach((f) => f());
  }
  private persist() {
    try {
      const { items, from, to, truncated } = this.state;
      localStorage.setItem(this.key, JSON.stringify({ items, from, to, truncated }));
    } catch {
      /* quota: keep going in memory */
    }
  }
  private merge(add: T[]) {
    if (!add.length) return;
    const seen = new Set(this.state.items.map((x) => x.id));
    const items = [...this.state.items, ...add.filter((x) => !seen.has(x.id))].sort((a, b) => b.block - a.block || (b.id < a.id ? -1 : 1));
    if (items.length > this.cap) {
      const kept = items.slice(0, this.cap);
      this.set({ items: kept, truncated: true, from: kept[kept.length - 1]!.block, done: true });
    } else this.set({ items });
  }
  private async range(from: number, to: number): Promise<void> {
    for (let a = from; a <= to; ) {
      const b = Math.min(to, a + this.state.chunk - 1);
      try {
        this.merge(await this.fetchRange(a, b));
        a = b + 1;
        this.backoff = 0;
        if (this.state.error?.startsWith("RPC busy")) this.set({ error: null });
        // A chunk shrunk for one heavy stretch grows back after 3 clean chunks.
        if (++this.okStreak >= 3 && this.state.chunk < LOG_CHUNK) {
          this.okStreak = 0;
          this.set({ chunk: Math.min(LOG_CHUNK, this.state.chunk * 2) });
        }
      } catch (e) {
        this.okStreak = 0;
        if (tooBig(e) && this.state.chunk > 25) {
          this.set({ chunk: Math.max(25, Math.floor(this.state.chunk / 2)) });
          await sleep(1_000);
          continue;
        }
        if (throttled(e) && this.backoff < 6) {
          const wait = Math.min(60_000, 5_000 * 2 ** this.backoff++);
          this.set({ error: `RPC busy (rate limit): waiting ${Math.round(wait / 1000)} s, then continuing` });
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
  }

  async tick(): Promise<void> {
    if (this.running || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
    this.running = true;
    this.set({ busy: true });
    try {
      const head = Number(await gated(() => publicClient().getBlockNumber({ cacheTime: 0 })));
      this.set({ head });
      // A restarted chain (local anvil redeploys to the same addresses) is behind the cache: start over.
      if (this.state.to !== null && head < this.state.to) this.set({ items: [], from: null, to: null, done: false, truncated: false });
      // New blocks first (live), then one slice of history (newest first), so recent activity shows at once.
      if (this.state.to === null) this.set({ to: head, from: head + 1 });
      if (head > this.state.to!) {
        const from = this.state.to! + 1;
        await this.range(from, head);
        this.set({ to: head });
      }
      if (!this.state.done && this.state.from! > this.state.start) {
        const to = this.state.from! - 1;
        const from = Math.max(this.state.start, to - this.state.chunk * 4 + 1);
        await this.range(from, to);
        if (!this.state.truncated) this.set({ from, done: from <= this.state.start });
        if (!this.state.done) setTimeout(() => void this.tick(), 0);
      }
      this.set({ error: null });
      this.persist();
    } catch (e) {
      this.set({ error: (e as Error).message.split("\n")[0]!.slice(0, 160) });
    } finally {
      this.running = false;
      this.set({ busy: false });
    }
  }
}

function useScanner<T extends { id: string; block: number }>(s: Scanner<T> | null): ScanState<T> | null {
  return useSyncExternalStore(
    (f) => (s ? s.subscribe(f) : () => {}),
    () => (s ? s.get() : null),
    () => null,
  );
}

// ------------------------------------------------------------------------------------------------ ledger

const ledgers = new Map<string, Scanner<ChainEvent>>();
function ledgerFor(d: Deployments): Scanner<ChainEvent> {
  const key = `aven:ledger:v1:${d.chainId}:${d.hook.toLowerCase()}`;
  let s = ledgers.get(key);
  if (!s) {
    const filter = { address: [d.poolManager, d.hook] as Address[], topics: [[T_SWAP, T_LIQ, T_FEE], [d.pools.aven.id, d.pools.control.id]] as Array<Hex | Hex[] | null> };
    s = new Scanner<ChainEvent>(key, d.deployedAtBlock || 0, async (a, b) => decodePoolLogs(await getLogs(filter, a, b), d), LEDGER_CAP);
    ledgers.set(key, s);
  }
  return s;
}

/** Every swap and liquidity change on both pools, newest first, live. */
export function useLedger(d: Deployments | null): ScanState<ChainEvent> | null {
  const ok = !!d && d.hook.length === 42 && d.poolManager.length === 42;
  return useScanner(typeof window !== "undefined" && ok ? ledgerFor(d!) : null);
}

// ------------------------------------------------------------------------------------------------ wallet

export interface WalletTx {
  id: string;
  tx: Hex;
  block: number;
  ts: number | null;
  status: "success" | "reverted";
  from: Address;
  gasUsed: string;
  gasPrice: string;
  kind: "swap" | "liquidity" | "mint" | "transfer";
  swaps: ChainEvent[];
  liquidity: ChainEvent[];
  /** Token transfers that touch the address, in raw units. */
  transfers: Array<{ token: "base" | "quote"; from: Address; to: Address; value: string }>;
}

async function walletTx(hash: Hex, address: Address, d: Deployments): Promise<WalletTx> {
  const c = publicClient();
  const r = await gated(() => c.getTransactionReceipt({ hash }));
  const blk = await gated(() => c.getBlock({ blockNumber: r.blockNumber }));
  const pool = decodePoolLogs(
    r.logs.filter((l) => isAddressEqual(l.address, d.poolManager) || isAddressEqual(l.address, d.hook)).map((l) => ({ ...l, blockNumber: r.blockNumber, logIndex: numberToHex(l.logIndex) })) as never,
    d,
  );
  const transfers: WalletTx["transfers"] = [];
  for (const l of r.logs) {
    const token = isAddressEqual(l.address, d.tokens.base) ? "base" : isAddressEqual(l.address, d.tokens.quote) ? "quote" : null;
    if (!token || l.topics[0] !== T_XFER) continue;
    try {
      const ev = decodeEventLog({ abi: mockErc20Abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      // MockERC20 names the amount `amount` (solmate); a standard ERC-20 ABI says `value`.
      const a = ev.args as unknown as { from: Address; to: Address; amount?: bigint; value?: bigint };
      const v = a.amount ?? a.value ?? 0n;
      if (isAddressEqual(a.from, address) || isAddressEqual(a.to, address)) transfers.push({ token, from: a.from, to: a.to, value: v.toString() });
    } catch {
      /* not a Transfer */
    }
  }
  const swaps = pool.filter((p) => p.kind === "swap");
  const liquidity = pool.filter((p) => p.kind === "liquidity");
  const kind: WalletTx["kind"] = swaps.length ? "swap" : liquidity.length ? "liquidity" : transfers.some((t) => isAddressEqual(t.from, ZERO)) ? "mint" : "transfer";
  return {
    id: hash.toLowerCase(),
    tx: hash,
    block: Number(r.blockNumber),
    ts: Number(blk.timestamp) * 1000,
    status: r.status,
    from: r.from,
    gasUsed: r.gasUsed.toString(),
    gasPrice: (r.effectiveGasPrice ?? 0n).toString(),
    kind,
    swaps,
    liquidity,
    transfers,
  };
}

const wallets = new Map<string, Scanner<WalletTx>>();
function walletFor(d: Deployments, address: Address): Scanner<WalletTx> {
  const key = `aven:wallet:v2:${d.chainId}:${d.hook.toLowerCase()}:${address.toLowerCase()}`;
  let s = wallets.get(key);
  if (!s) {
    const tokens = [d.tokens.base, d.tokens.quote] as Address[];
    const t = topicOf(address);
    const known = new Set<string>();
    s = new Scanner<WalletTx>(
      key,
      d.deployedAtBlock || 0,
      async (a, b) => {
        const [out, inn] = [await getLogs({ address: tokens, topics: [T_XFER, t] }, a, b), await getLogs({ address: tokens, topics: [T_XFER, null, t] }, a, b)];
        const hashes = [...new Set([...out, ...inn].map((l) => l.transactionHash.toLowerCase()))].filter((h) => !known.has(h));
        const txs: WalletTx[] = [];
        for (const h of hashes) {
          txs.push(await walletTx(h as Hex, address, d));
          known.add(h);
        }
        return txs;
      },
      2_000,
    );
    for (const x of s.state.items) known.add(x.id);
    wallets.set(key, s);
  }
  return s;
}

/** One address's on-chain activity with our tokens and pools, newest first, live. */
export function useWalletActivity(d: Deployments | null, address: Address | null): ScanState<WalletTx> | null {
  const ok = !!d && !!address && d.tokens.base.length === 42;
  return useScanner(typeof window !== "undefined" && ok ? walletFor(d!, address!) : null);
}

// ------------------------------------------------------------------------------------------------ block times

const times = new Map<number, number>();
const timeSubs = new Set<() => void>();
let timeVersion = 0;
const pendingTimes = new Set<number>();

/** Block timestamps (ms) for the given blocks, fetched once each (eth_getBlockByNumber) and kept in memory. */
export function useBlockTimes(blocks: number[]): Map<number, number> {
  useSyncExternalStore(
    (f) => (timeSubs.add(f), () => timeSubs.delete(f)),
    () => timeVersion,
    () => 0,
  );
  const key = blocks.join(",");
  useEffect(() => {
    for (const b of blocks) {
      if (times.has(b) || pendingTimes.has(b)) continue;
      pendingTimes.add(b);
      gated(() => publicClient().getBlock({ blockNumber: BigInt(b) }))
        .then((blk) => {
          times.set(b, Number(blk.timestamp) * 1000);
          timeVersion++;
          timeSubs.forEach((f) => f());
        })
        .catch(() => undefined)
        .finally(() => pendingTimes.delete(b));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return times;
}

/** Exposed for tests only (fixtures of real logs). */
export const decodePoolLogsForTest = decodePoolLogs;
