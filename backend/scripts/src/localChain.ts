/**
 * Local chain for end-to-end proofs (PLAN 3.2): anvil (chain 31337) + MockHyperCorePx etched at the HyperCore
 * precompile addresses (0x806 mark, 0x807 oracle, 0x80a perpAssetInfo) + the five real deploy scripts.
 * Used by `pnpm local:up` / `local:once`, the Arena e2e tests and the load tests.
 * Accounts are derived at runtime from anvil's public test mnemonic (no key literals in the repo).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadDeployments, mockHyperCorePxAbi, verifyTx, type Deployments } from "@aven/core";
import { contractsDir, envWithFoundry, run } from "../../core/scripts/run.ts";

export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public default
export const MARK_PX = "0x0000000000000000000000000000000000000806" as const;
export const ORACLE_PX = "0x0000000000000000000000000000000000000807" as const;
export const PERP_ASSET_INFO = "0x000000000000000000000000000000000000080a" as const;

export interface LocalChainOptions {
  port?: number;
  host?: string; // anvil --host (default 127.0.0.1; 0.0.0.0 to serve other machines, e.g. on a VM)
  blockTimeSec?: number; // HyperEVM small blocks are 1 s
  perpIndex?: number;
  coin?: string;
  szDecimals?: number;
  oracleRaw?: bigint; // default 2240.02 (testnet ETH sample, recon C.6)
  markRaw?: bigint;
  quiet?: boolean;
}

export interface LocalChain {
  rpcUrl: string;
  chainId: number;
  publicClient: PublicClient;
  deployer: HDAccount;
  bot: HDAccount;
  shock: HDAccount;
  deployments: Deployments;
  keyOf(account: HDAccount): Hex;
  setPrices(oracleRaw: bigint, markRaw: bigint): Promise<void>;
  /**
   * Live mode: write oracle + mark straight into the mocks' storage (anvil_setStorageAt). No transaction, so both
   * change together between blocks and never mid-block, like the real precompiles (one HyperCore state per block).
   */
  writePrices(oracleRaw: bigint, markRaw: bigint): Promise<void>;
  /** Live mode: make both price precompiles revert (on) or answer again (off), via storage, between blocks. */
  setReadFailure(on: boolean): Promise<void>;
  setMockMode(target: "oracle" | "mark", mode: "fail" | "burn" | "empty" | "overflow", on: boolean): Promise<void>;
  wallet(account: HDAccount): WalletClient;
  stop(): Promise<void>;
}

export const accountAt = (i: number) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i });
export const privateKeyOf = (a: HDAccount): Hex => toHex(a.getHdKey().privateKey!);

async function waitForRpc(url: string, timeoutMs = 20_000): Promise<void> {
  const client = createPublicClient({ transport: http(url) });
  const t0 = Date.now();
  for (;;) {
    try {
      await client.getChainId();
      return;
    } catch {
      if (Date.now() - t0 > timeoutMs) throw new Error(`anvil did not start at ${url}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function runtimeCode(file: string, contract: string): Hex {
  const art = JSON.parse(readFileSync(join(contractsDir, "out", file, `${contract}.json`), "utf8"));
  return art.deployedBytecode.object as Hex;
}

export async function startLocalChain(opts: LocalChainOptions = {}): Promise<LocalChain> {
  const port = opts.port ?? 8545;
  const rpcUrl = `http://127.0.0.1:${port}`;
  const hostArgs = opts.host ? ["--host", opts.host] : [];
  const env = envWithFoundry();
  const log = (...a: unknown[]) => (opts.quiet ? undefined : console.log("[local-chain]", ...a));

  log(`starting anvil on ${rpcUrl} (block time ${opts.blockTimeSec ?? 1}s)`);
  const anvil: ChildProcess = spawn(
    "anvil",
    ["--port", String(port), ...hostArgs, "--chain-id", "31337", "--block-time", String(opts.blockTimeSec ?? 1), "--silent"],
    // No shell: on Windows a cmd.exe wrapper would leave anvil orphaned when we kill the wrapper's pid.
    { env, stdio: "ignore", shell: false, windowsHide: true },
  );
  const stop = async () => {
    if (anvil.exitCode !== null) return;
    const exited = new Promise<void>((r) => anvil.once("exit", () => r()));
    anvil.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3_000))]);
  };
  try {
    await waitForRpc(rpcUrl);
    const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl), cacheTime: 0 }) as PublicClient;
    const [deployer, bot, shock] = [accountAt(0), accountAt(1), accountAt(2)];
    const wallet = (a: HDAccount) => createWalletClient({ account: a, chain: foundry, transport: http(rpcUrl) });

    // 1. Mock precompiles (Foundry artifacts must be built).
    log("building contracts + the v4core PoolManager artifact");
    run("forge", ["build"], contractsDir, env);
    run("forge", ["build", "lib/v4-core/src/PoolManager.sol"], contractsDir, { ...env, FOUNDRY_PROFILE: "v4core" });
    const mockCode = runtimeCode("MockHyperCorePx.sol", "MockHyperCorePx");
    for (const a of [MARK_PX, ORACLE_PX, PERP_ASSET_INFO]) {
      await publicClient.request({ method: "anvil_setCode" as never, params: [a, mockCode] as never });
    }
    const perpIndex = opts.perpIndex ?? 4;
    const w = wallet(deployer);
    const send = async (address: Address, functionName: string, args: unknown[]) => {
      const hash = await w.writeContract({ address, abi: mockHyperCorePxAbi, functionName: functionName as never, args: args as never, chain: foundry, account: deployer });
      await publicClient.waitForTransactionReceipt({ hash });
    };
    await send(PERP_ASSET_INFO, "setInfo", [perpIndex, opts.coin ?? "ETH", opts.szDecimals ?? 4]);
    const setPrices = async (o: bigint, m: bigint) => {
      await send(ORACLE_PX, "set", [perpIndex, o]);
      await send(MARK_PX, "set", [perpIndex, m]);
    };
    await setPrices(opts.oracleRaw ?? 224_002n, opts.markRaw ?? opts.oracleRaw ?? 224_002n);

    // MockHyperCorePx storage (forge inspect ... storageLayout): slot 0 = mapping(uint32 => uint64) price,
    // slot 2 = packed bools [infoMode | fail<<8 | burn<<16 | empty<<24 | overflow<<32].
    const priceSlot = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(perpIndex), 0n]));
    const FLAGS_SLOT = pad("0x02", { size: 32 });
    const FAIL_BIT = 1n << 8n;
    const setStorage = (address: Address, slot: Hex, value: bigint) =>
      publicClient.request({ method: "anvil_setStorageAt" as never, params: [address, slot, pad(toHex(value), { size: 32 })] as never });
    const writePrices = async (o: bigint, m: bigint) => {
      if (o <= 0n || m <= 0n || o >= 2n ** 64n || m >= 2n ** 64n) throw new Error(`price out of uint64 range: ${o} / ${m}`);
      await Promise.all([setStorage(ORACLE_PX, priceSlot, o), setStorage(MARK_PX, priceSlot, m)]);
    };
    const setReadFailure = async (on: boolean) => {
      for (const a of [ORACLE_PX, MARK_PX]) {
        const cur = BigInt((await publicClient.getStorageAt({ address: a, slot: FLAGS_SLOT })) ?? "0x0");
        await setStorage(a, FLAGS_SLOT, on ? cur | FAIL_BIT : cur & ~FAIL_BIT);
      }
    };

    // 2. The real deploy scripts, in §11.3 order.
    const scriptEnv = {
      ...env,
      DEPLOYER_PK: privateKeyOf(deployer),
      BOT_ADDRESS: bot.address,
      SHOCK_ADDRESS: shock.address,
      PERP_INDEX: String(perpIndex),
      EXPECT_COIN: opts.coin ?? "ETH",
    };
    for (const s of ["DeployCore", "DeployTokens", "DeployAven", "CreatePools", "Smoke"]) {
      log(`forge script ${s}`);
      run("forge", ["script", `script/${s}.s.sol:${s}`, "--rpc-url", rpcUrl, "--broadcast", "--slow", ...(opts.quiet ? ["-q"] : [])], contractsDir, scriptEnv);
    }
    const deployments = loadDeployments(31337);

    const setMockMode = async (target: "oracle" | "mark", mode: "fail" | "burn" | "empty" | "overflow", on: boolean) => {
      const fn = { fail: "setFail", burn: "setBurn", empty: "setEmpty", overflow: "setOverflow" }[mode];
      await send(target === "oracle" ? ORACLE_PX : MARK_PX, fn, [on]);
    };
    return {
      rpcUrl,
      chainId: 31337,
      publicClient,
      deployer,
      bot,
      shock,
      deployments,
      keyOf: privateKeyOf,
      setPrices,
      writePrices,
      setReadFailure,
      setMockMode,
      wallet,
      stop,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}

/** Tx hashes of the Smoke script's swaps (from Foundry's broadcast log). */
export function smokeTxHashes(chainId = 31337): Hex[] {
  const file = join(contractsDir, "broadcast", "Smoke.s.sol", String(chainId), "run-latest.json");
  const j = JSON.parse(readFileSync(file, "utf8")) as { transactions: Array<{ hash: Hex }> };
  return j.transactions.map((t) => t.hash);
}

/** Verify every Aven smoke swap (control swaps have no FeeComputed and are skipped). */
export async function verifySmoke(chain: LocalChain): Promise<Array<{ tx: Hex; match: boolean; fee: number }>> {
  const d = chain.deployments;
  const target = { hook: d.hook as Address, poolManager: d.poolManager as Address, avenPoolId: d.pools.aven.id, config: d.config, params: d.params };
  const out: Array<{ tx: Hex; match: boolean; fee: number }> = [];
  for (const tx of smokeTxHashes(chain.chainId)) {
    const r = await verifyTx(chain.publicClient, tx, target);
    if (r.results.length === 0) continue;
    out.push({ tx, match: r.match, fee: r.results[0]!.onchainFee });
  }
  return out;
}
