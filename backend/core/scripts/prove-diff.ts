/**
 * `pnpm prove:diff`: regenerate the 10,000 fee + 2,000 anchor vectors from the Solidity library (Foundry), then
 * require the TypeScript port to match every one (I7). Strict: missing files fail instead of skipping.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { contractsDir, coreDir, envWithFoundry, repoRoot, run } from "./run.ts";

mkdirSync(join(repoRoot, "backend", "data", "vectors"), { recursive: true }); // Foundry fs_permissions needs it to exist
console.log("1/2 generating vectors with forge (GEN_VECTORS=1) ...");
run("forge", ["test", "--match-path", "test/vectors/GenVectors.t.sol", "-vv"], contractsDir, envWithFoundry({ GEN_VECTORS: "1" }));
console.log("2/2 checking the TypeScript port against every vector ...");
run("pnpm", ["exec", "vitest", "run", "test/differential.test.ts"], coreDir, envWithFoundry({ PROVE_DIFF: "1" }));
console.log("prove:diff OK — Solidity and TypeScript agree on every vector.");
