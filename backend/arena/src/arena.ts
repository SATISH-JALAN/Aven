/**
 * The Arena service (ARCHITECTURE §7.2): one process, three loops (block poller, bot, SSE broadcaster), plus shock,
 * stats, persistence and verify. The loop never throws: every iteration is caught and recorded as lastError.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEventLog, formatUnits, type Address, type Hex, type TransactionReceipt } from "viem";
import {
  oracleWad,
  poolManagerAbi,
  poolSwapTestAbi,
  poolWad,
  rawToPrice,
  verifyLogs,
  verifyTx,
  wadToNumber,
  type VerifyResult as CoreVerifyResult,
} from "@aven/core";
import type { ArenaConfig } from "./config.ts";
import {
  balances,
  ensureApprovals,
  hookPoolState,
  previewFee,
  readLiquidity,
  readOracle,
  readPool,
  simulateSwap,
  swapArgs,
  withRetry,
  writeWithMargin,
  checkGasCap,
  GasPriceTooHigh,
  gweiToWei,
  type Chain,
} from "./chain.ts";
import {
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  arbDirection,
  botProfitUsd,
  computeStats,
  decodeBalanceDelta,
  gapBps,
  planArb,
  valueSwap,
  zeroForOneOf,
} from "./math.ts";
import type { Direction, PoolName, PoolState, Shock, StateResponse, Stats, Trade, VerifyResult } from "./types.ts";

export type ArenaEvent = "state" | "trade" | "shock" | "bot";
type Listener = (event: ArenaEvent, data: unknown) => void;

export interface ArenaApi {
  health(): { ok: boolean; chainId: number; block: number; botEnabled: boolean; version: string };
  config(): unknown;
  state(): Promise<StateResponse>;
  stats(): Stats;
  trades(limit: number, pool?: PoolName): Trade[];
  botStatus(): Promise<{ enabled: boolean; lastRunBlock: number; lastError: string | null; balances: Record<string, string> }>;
  verify(tx: Hex): Promise<VerifyResult | null>;
  shock(opts: { sizeBase?: string; direction?: string }): Promise<Shock>;
  setBot(enabled: boolean): { enabled: boolean };
  resetStats(): { since: number };
  subscribe(l: Listener): () => void;
}

export const VERSION = "0.1.0";

export class Arena implements ArenaApi {
  private records: Array<Trade | Shock> = [];
  private since = 0;
  private botEnabled = false;
  private running = false;
  private lastBlock = 0n;
  private lastRunBlock = 0;
  private lastError: string | null = null;
  private listeners = new Set<Listener>();
  private poller: NodeJS.Timeout | null = null;
  /** One in-flight /state computation per block, shared by every caller (avoids a thundering herd on each new block). */
  private stateCache: { block: bigint; value: Promise<StateResponse> } | null = null;
  /**
   * Newest block seen in our OWN receipts (shock, bot). The poller only refreshes lastBlock every POLL_MS, so right
   * after a shock /state could serve the cached pre-shock block (found while recording the live-mode demo: "0 bp off
   * fair" right after a shock). state() uses max(lastBlock, ownTxBlock); the poller and its SSE emits are unchanged.
   */
  private ownTxBlock = 0n;
  /** MAX_GAS_PRICE_GWEI in wei; 0 = no cap. */
  private get gasCapWei(): bigint {
    return gweiToWei(this.cfg.MAX_GAS_PRICE_GWEI ?? 0);
  }
  /** GET /bot/status reads 6 balances over RPC: computed at most once per block (single-flight, like state()). */
  private balanceCache: { block: bigint; value: Promise<[Awaited<ReturnType<typeof balances>>, Awaited<ReturnType<typeof balances>>]> } | null = null;
  /** GET /verify/:tx: a mined tx's verification never changes, so cache it (bounded; failures are not cached). */
  private verifyCache = new Map<string, VerifyResult | null>();
  private static readonly VERIFY_CACHE_MAX = 1_000;
  private noteOwnTxBlock(b: bigint): void {
    if (b > this.ownTxBlock) this.ownTxBlock = b;
  }
  private readonly file: string;
  readonly stats_ = { iterations: 0, iterationErrors: 0, pollErrors: 0 };

  constructor(
    private readonly cfg: ArenaConfig,
    private readonly c: Chain,
  ) {
    this.file = join(cfg.DATA_DIR, "trades.jsonl");
  }

  // ------------------------------------------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    mkdirSync(this.cfg.DATA_DIR, { recursive: true });
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          this.records.push(JSON.parse(line));
        } catch {
          /* skip a torn last line */
        }
      }
    }
    await withRetry(() => ensureApprovals(this.c, this.c.bot));
    await withRetry(() => ensureApprovals(this.c, this.c.shock));
    this.lastBlock = await this.c.publicClient.getBlockNumber();
    this.poller = setInterval(() => void this.poll(), this.cfg.POLL_MS);
  }

  stop(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    this.botEnabled = false;
  }

  /** Block poller (~500 ms; HyperEVM RPC has no websockets, recon B.2). */
  private async poll(): Promise<void> {
    let b: bigint;
    try {
      b = await this.c.publicClient.getBlockNumber();
    } catch (e) {
      this.stats_.pollErrors++;
      this.lastError = `poll: ${msg(e)}`;
      return;
    }
    if (b <= this.lastBlock) return;
    this.lastBlock = b;
    if (this.listeners.size > 0) {
      this.state()
        .then((s) => this.emit("state", s))
        .catch(() => undefined);
    }
    if (this.botEnabled && !this.running) void this.botIteration(b);
  }

  // ------------------------------------------------------------------------------------------------ bot

  /** One bot pass over both pools for block `b` (§7.2 steps 1-7). Never throws. */
  async botIteration(b: bigint): Promise<Trade[]> {
    if (this.running) return [];
    this.running = true;
    const made: Trade[] = [];
    try {
      this.stats_.iterations++;
      // Mainnet gas guard first: during a spike the bot spends neither gas nor RPC reads, and resumes by itself.
      const gasPrice = await this.c.publicClient.getGasPrice();
      if (this.gasCapWei > 0n && gasPrice > this.gasCapWei) {
        this.lastError = `${new GasPriceTooHigh(gasPrice, this.gasCapWei).message} (bot waits)`;
        return made;
      }
      const bal = await balances(this.c, this.c.bot.account.address);
      if (Number(formatUnits(bal.native, 18)) < this.cfg.MIN_NATIVE_BALANCE) {
        this.botEnabled = false;
        this.lastError = `auto-paused: bot native balance ${formatUnits(bal.native, 18)} < ${this.cfg.MIN_NATIVE_BALANCE}`;
        this.emit("bot", { enabled: false, reason: this.lastError });
        return made;
      }
      const px = await withRetry(() => readOracle(this.c));
      if (!px.readOk) {
        this.lastError = "oracle read failed; skipping block";
        return made;
      }
      for (const pool of ["control", "aven"] as const) {
        const t = await this.tryArb(pool, px.oracleRaw, b, gasPrice);
        if (t) made.push(t);
      }
      this.lastRunBlock = Number(b);
    } catch (e) {
      this.stats_.iterationErrors++;
      this.lastError = `bot: ${msg(e)}`;
    } finally {
      this.running = false;
    }
    return made;
  }

  private async tryArb(pool: PoolName, oracleRaw: bigint, b: bigint, gasPrice: bigint): Promise<Trade | null> {
    const cfg = this.c.d.config;
    const slot0 = await withRetry(() => readPool(this.c, pool));
    // Quote: control is a fixed 3000; Aven asks the hook (the same fee beforeSwap will charge, I6).
    const oW = oracleWad(cfg, oracleRaw);
    const pW = poolWad(cfg, slot0.sqrtPriceX96);
    const dir: Direction | null = arbDirection(pW, oW); // |gap| < 1 bp -> no trade (§7.2 step 2)
    if (!dir) return null;
    const feePips = pool === "control" ? 3000 : (await withRetry(() => previewFee(this.c, zeroForOneOf(cfg, dir)))).fee;
    const plan = planArb({
      cfg,
      oracleRaw,
      sqrtPriceX96: slot0.sqrtPriceX96,
      feePips,
      maxTradeBase: toUnits(this.cfg.MAX_TRADE_BASE, cfg.baseIsToken0 ? cfg.decimals0 : cfg.decimals1),
      maxTradeQuote: toUnits(this.cfg.MAX_TRADE_QUOTE, cfg.baseIsToken0 ? cfg.decimals1 : cfg.decimals0),
    });
    if (!plan) return null;

    const key = this.c.keys[pool];
    const sim = await simulateSwap(this.c, this.c.bot, key, plan.zeroForOne, plan.amountIn, plan.sqrtPriceLimitX96);
    const oraclePrice = rawToPrice(oracleRaw, cfg.szDecimals);
    const v = valueSwap(cfg, decodeBalanceDelta(sim.delta), oraclePrice, feePips);
    const gasEstUsd = (Number(formatUnits(250_000n * gasPrice, 18)) * this.cfg.NATIVE_USD) || 0;
    if (botProfitUsd(v, gasEstUsd) <= 0) return null;

    const hash = await writeWithMargin(this.c, this.c.bot, sim.request as never, this.gasCapWei); // margin + fee cap: chain.ts
    const receipt = await this.c.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    this.noteOwnTxBlock(receipt.blockNumber);
    if (receipt.status !== "success") throw new Error(`swap reverted: ${hash}`);
    const t = this.tradeFromReceipt(receipt, pool, "arb", plan.direction, oraclePrice, b);
    this.record(t);
    return t;
  }

  /** Build a Trade from the mined receipt: amounts from the PoolManager Swap event, fee from FeeComputed (Aven). */
  private tradeFromReceipt(r: TransactionReceipt, pool: PoolName, kind: Trade["kind"], dir: Direction, oraclePrice: number, b: bigint): Trade {
    const cfg = this.c.d.config;
    const id = this.c.d.pools[pool].id.toLowerCase();
    let amount0 = 0n;
    let amount1 = 0n;
    let swapFee = pool === "control" ? 3000 : 0;
    for (const l of r.logs) {
      if (l.address.toLowerCase() !== this.c.d.poolManager.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: poolManagerAbi, data: l.data, topics: l.topics });
        if (ev.eventName !== "Swap") continue;
        const a = ev.args as unknown as { id: Hex; amount0: bigint; amount1: bigint; fee: number };
        if (a.id.toLowerCase() !== id) continue;
        // Swap event amounts are the swapper's deltas (negative = paid in), same convention as BalanceDelta.
        amount0 = a.amount0;
        amount1 = a.amount1;
        swapFee = Number(a.fee);
      } catch {
        /* not a PoolManager event we know */
      }
    }
    let breakdown: Trade["breakdown"];
    let verify: Trade["verify"];
    if (pool === "aven") {
      const [res] = verifyLogs(r.logs, {
        hook: this.c.d.hook as Address,
        poolManager: this.c.d.poolManager as Address,
        config: cfg,
        params: this.c.d.params,
      });
      if (res) {
        breakdown = res.breakdown;
        verify = { checkA: res.checkA, checkB: res.checkB };
      }
    }
    const v = valueSwap(cfg, { amount0, amount1 }, oraclePrice, swapFee);
    const gasUsd = Number(formatUnits(r.gasUsed * r.effectiveGasPrice, 18)) * this.cfg.NATIVE_USD;
    return {
      id: `${r.transactionHash}:${pool}`,
      ts: Date.now(),
      block: Number(r.blockNumber ?? b),
      pool,
      kind,
      direction: dir,
      amountIn: v.amountIn.toString(),
      amountOut: v.amountOut.toString(),
      feePips: swapFee,
      feeUsd: v.feeUsd,
      botProfitUsd: kind === "arb" ? botProfitUsd(v, gasUsd) : 0,
      lpFeeIncomeUsd: v.feeUsd,
      txHash: r.transactionHash,
      ...(breakdown ? { breakdown } : {}),
      ...(verify ? { verify } : {}),
    };
  }

  // ------------------------------------------------------------------------------------------------ shock

  /** One identical exact-input swap of the same size and direction on both pools, from the shock wallet. */
  async shock(opts: { sizeBase?: string; direction?: string } = {}): Promise<Shock> {
    const cfg = this.c.d.config;
    const dir: Direction = opts.direction === "sellBase" ? "sellBase" : "buyBase";
    const px = await withRetry(() => readOracle(this.c));
    if (!px.readOk) throw new Error("oracle read failed");
    const oraclePrice = rawToPrice(px.oracleRaw, cfg.szDecimals);
    const sizeBase = opts.sizeBase !== undefined ? Number(opts.sizeBase) : dir === "sellBase" ? this.cfg.SHOCK_BASE : this.cfg.SHOCK_QUOTE / oraclePrice;
    if (!(sizeBase > 0) || !Number.isFinite(sizeBase)) throw new Error("sizeBase must be a positive number");
    const baseDec = cfg.baseIsToken0 ? cfg.decimals0 : cfg.decimals1;
    const quoteDec = cfg.baseIsToken0 ? cfg.decimals1 : cfg.decimals0;
    const amountIn = dir === "sellBase" ? toUnits(sizeBase, baseDec) : toUnits(sizeBase * oraclePrice, quoteDec);
    const zeroForOne = zeroForOneOf(cfg, dir);
    const limit = zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
    // Check the cap BEFORE the first swap, so a spike can't leave a half-sent shock (one pool moved, the other not).
    checkGasCap(await this.c.publicClient.getGasPrice(), this.gasCapWei);
    const hashes: Hex[] = [];
    for (const pool of ["control", "aven"] as const) {
      hashes.push(
        await writeWithMargin(this.c, this.c.shock, {
          address: this.c.d.swapRouter as Address,
          abi: poolSwapTestAbi,
          functionName: "swap",
          args: swapArgs(this.c.keys[pool], zeroForOne, amountIn, limit),
        } as never, this.gasCapWei),
      );
    }
    const b = await this.c.publicClient.getBlockNumber();
    for (const [i, pool] of (["control", "aven"] as const).entries()) {
      const r = await this.c.publicClient.waitForTransactionReceipt({ hash: hashes[i]!, timeout: 60_000 });
      this.noteOwnTxBlock(r.blockNumber);
      if (r.status !== "success") throw new Error(`shock swap reverted on ${pool}: ${hashes[i]}`);
      this.record(this.tradeFromReceipt(r, pool, "retail", dir, oraclePrice, b));
    }
    const s: Shock = { id: `shock:${hashes[0]}`, ts: Date.now(), sizeBase: String(sizeBase), direction: dir, txHashes: hashes };
    this.record(s);
    return s;
  }

  // ------------------------------------------------------------------------------------------------ reads

  health() {
    return { ok: true, chainId: this.c.d.chainId, block: Number(this.lastBlock), botEnabled: this.botEnabled, version: VERSION };
  }

  config() {
    const d = this.c.d;
    return { chainId: d.chainId, hook: d.hook, poolManager: d.poolManager, pools: d.pools, config: d.config, params: d.params, explorer: d.explorer };
  }

  async state(): Promise<StateResponse> {
    const seen = this.lastBlock > this.ownTxBlock ? this.lastBlock : this.ownTxBlock;
    const block = seen || (await this.c.publicClient.getBlockNumber());
    if (this.stateCache && this.stateCache.block === block) return this.stateCache.value;
    const value = this.computeState(block);
    this.stateCache = { block, value };
    value.catch(() => {
      if (this.stateCache?.value === value) this.stateCache = null; // don't cache a failure
    });
    return value;
  }

  private async computeState(block: bigint): Promise<StateResponse> {
    const cfg = this.c.d.config;
    const px = await withRetry(() => readOracle(this.c));
    const oW = oracleWad(cfg, px.oracleRaw || 1n);
    const pools = {} as { control: PoolState; aven: PoolState };
    for (const pool of ["control", "aven"] as const) {
      const [s0, liq] = await Promise.all([readPool(this.c, pool), readLiquidity(this.c, pool)]);
      const pW = poolWad(cfg, s0.sqrtPriceX96);
      const base: PoolState = {
        poolId: this.c.d.pools[pool].id,
        price: wadToNumber(pW),
        gapBps: px.readOk ? Number(gapBps(pW, oW)) : 0,
        liquidity: liq.toString(),
        feePreview: { fixedPips: 3000 },
      };
      if (pool === "aven") {
        const [buyBase, sellBase, hs] = await Promise.all([
          previewFee(this.c, zeroForOneOf(cfg, "buyBase")),
          previewFee(this.c, zeroForOneOf(cfg, "sellBase")),
          hookPoolState(this.c),
        ]);
        base.feePreview = { buyBase, sellBase };
        base.hookState = { topBlock: Number(hs.topBlock), sqrtPriceTopX96: hs.sqrtPriceTopX96.toString(), anchorMark: hs.anchorMark.toString(), anchorTime: Number(hs.anchorTime) };
      }
      pools[pool] = base;
    }
    const value: StateResponse = {
      block: Number(block),
      ts: Date.now(),
      oracle: { raw: px.oracleRaw.toString(), price: rawToPrice(px.oracleRaw, cfg.szDecimals) },
      mark: { raw: px.markRaw.toString(), price: rawToPrice(px.markRaw, cfg.szDecimals) },
      pools,
    };
    return value;
  }

  stats(): Stats {
    return computeStats(this.tradeList(), this.since);
  }

  trades(limit: number, pool?: PoolName): Trade[] {
    const list = this.tradeList().filter((t) => !pool || t.pool === pool);
    return list.slice(-Math.max(0, limit)).reverse();
  }

  async botStatus() {
    const seen = this.lastBlock > this.ownTxBlock ? this.lastBlock : this.ownTxBlock;
    const block = seen || (await this.c.publicClient.getBlockNumber());
    if (!this.balanceCache || this.balanceCache.block !== block) {
      const value = Promise.all([balances(this.c, this.c.bot.account.address), balances(this.c, this.c.shock.account.address)]);
      this.balanceCache = { block, value };
      value.catch(() => {
        if (this.balanceCache?.value === value) this.balanceCache = null; // don't cache a failure
      });
    }
    const [b, s] = await this.balanceCache.value;
    const fmt = (x: { native: bigint; base: bigint; quote: bigint }) => {
      const cfg = this.c.d.config;
      return { native: formatUnits(x.native, 18), base: formatUnits(x.base, cfg.baseIsToken0 ? cfg.decimals0 : cfg.decimals1), quote: formatUnits(x.quote, cfg.baseIsToken0 ? cfg.decimals1 : cfg.decimals0) };
    };
    const fb = fmt(b);
    const fs = fmt(s);
    return {
      enabled: this.botEnabled,
      lastRunBlock: this.lastRunBlock,
      lastError: this.lastError,
      balances: { botNative: fb.native, botBase: fb.base, botQuote: fb.quote, shockNative: fs.native, shockBase: fs.base, shockQuote: fs.quote },
    };
  }

  async verify(tx: Hex): Promise<VerifyResult | null> {
    const key = tx.toLowerCase();
    if (this.verifyCache.has(key)) return this.verifyCache.get(key)!;
    const d = this.c.d;
    // Throws (and is not cached) if the tx isn't mined yet.
    const r = await verifyTx(this.c.publicClient, tx, { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params });
    const first: CoreVerifyResult | undefined = r.results[0];
    const out: VerifyResult | null = first
      ? { match: r.match, checkA: first.checkA, checkB: first.checkB, onchainFee: first.onchainFee, recomputedFee: first.recomputedFee, swapEventFee: first.swapEventFee ?? -1, inputs: first.inputs, breakdown: first.breakdown }
      : null;
    if (this.verifyCache.size >= Arena.VERIFY_CACHE_MAX) this.verifyCache.delete(this.verifyCache.keys().next().value!);
    this.verifyCache.set(key, out);
    return out;
  }

  setBot(enabled: boolean) {
    this.botEnabled = enabled;
    if (enabled) this.lastError = null;
    this.emit("bot", { enabled });
    return { enabled };
  }

  resetStats() {
    this.since = Date.now();
    return { since: this.since };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  // ------------------------------------------------------------------------------------------------ internals

  private tradeList(): Trade[] {
    return this.records.filter((r): r is Trade => "txHash" in r);
  }

  private record(r: Trade | Shock): void {
    this.records.push(r);
    try {
      appendFileSync(this.file, `${JSON.stringify(r)}\n`);
    } catch (e) {
      this.lastError = `persist: ${msg(e)}`;
    }
    this.emit("txHash" in r ? "trade" : "shock", r);
  }

  private emit(event: ArenaEvent, data: unknown): void {
    for (const l of this.listeners) {
      try {
        l(event, data);
      } catch {
        /* a broken subscriber must not break the loop */
      }
    }
  }
}

export function toUnits(x: number, decimals: number): bigint {
  const [i, f = ""] = x.toFixed(Math.min(decimals, 12)).split(".");
  return BigInt(i!) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

const msg = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));
