/** `pnpm --filter @aven/arena test:e2e`: runs test/e2e.test.ts with E2E=1 (starts a local anvil chain, ~3 min). */
import { spawnSync } from "node:child_process";

const r = spawnSync("pnpm", ["exec", "vitest", "run", "test/e2e.test.ts"], {
  env: { ...process.env, E2E: "1" },
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
