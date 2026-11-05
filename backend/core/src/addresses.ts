/**
 * Loader for contracts/deployments/<chainId>.json, the single source of addresses for backend and frontend.
 * Schema = ARCHITECTURE §8.3 (validated with zod; extra keys are rejected so drift is caught early).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config, Params } from "./fee.ts";
import type { PoolKey } from "./pool.ts";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32");
const u = (max: number) => z.number().int().min(0).max(max);

const poolKey = z
  .object({ currency0: address, currency1: address, fee: u(0xffffff), tickSpacing: z.number().int(), hooks: address })
  .strict();

export const deploymentsSchema = z
  .object({
    chainId: z.number().int().positive(),
    deployedAtBlock: z.number().int().min(0),
    explorer: z.string(),
    tokens: z.object({ base: address, quote: address, baseSymbol: z.string(), quoteSymbol: z.string() }).strict(),
    poolManager: address,
    swapRouter: address,
    liquidityRouter: address,
    hook: address,
    hookSalt: bytes32,
    pools: z
      .object({
        aven: z.object({ id: bytes32, key: poolKey }).strict(),
        control: z.object({ id: bytes32, key: poolKey }).strict(),
      })
      .strict(),
    config: z
      .object({ perpIndex: u(0xffffffff), szDecimals: u(6), baseIsToken0: z.boolean(), decimals0: u(18), decimals1: u(18) })
      .strict(),
    params: z
      .object({
        baseFee: u(0xffffff),
        minFee: u(0xffffff),
        maxFee: u(0xffffff),
        fallbackFee: u(0xffffff),
        gapWeight: u(0xffffffff),
        premiumWeight: u(0xffffffff),
        stressThresholdBps: u(0xffffffff),
        stressWeight: u(0xffffffff),
        stressTauSec: u(0xffffffff),
        maxGapBps: u(0xffffffff),
        precompileGas: u(0xffffffff),
      })
      .strict(),
  })
  .strict();

export type Deployments = z.infer<typeof deploymentsSchema> & {
  config: Config;
  params: Params;
  pools: { aven: { id: `0x${string}`; key: PoolKey }; control: { id: `0x${string}`; key: PoolKey } };
};

export const defaultDeploymentsDir = fileURLToPath(new URL("../../../contracts/deployments/", import.meta.url));

export function parseDeployments(json: unknown): Deployments {
  return deploymentsSchema.parse(json) as Deployments;
}

export function loadDeployments(chainId: number, dir: string = defaultDeploymentsDir): Deployments {
  const file = join(dir, `${chainId}.json`);
  return parseDeployments(JSON.parse(readFileSync(file, "utf8")));
}
