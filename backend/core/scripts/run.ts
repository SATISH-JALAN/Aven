/** Small cross-platform helpers for core scripts: repo paths and running Foundry (which may not be on PATH). */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const contractsDir = join(repoRoot, "contracts");
export const coreDir = join(repoRoot, "backend", "core");

/** PATH with ~/.foundry/bin appended, so `forge` resolves even when Foundry isn't on PATH (AGENTS.md §7). */
export function envWithFoundry(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const foundryBin = join(homedir(), ".foundry", "bin");
  const path = process.env.PATH ?? process.env.Path ?? "";
  const withFoundry = existsSync(foundryBin) && !path.includes(foundryBin) ? `${path}${delimiter}${foundryBin}` : path;
  return { ...process.env, PATH: withFoundry, Path: withFoundry, ...extra };
}

/** Run a command, streaming output; throw on a non-zero exit. */
export function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = envWithFoundry()): void {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}
