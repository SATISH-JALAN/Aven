// Copies contracts/deployments/<chainId>.json (ARCHITECTURE §8.3, the frozen cross-team file) into
// src/config/deployments.json, keyed by chainId, so the static site knows every address without the Arena service.
// Usage: node scripts/sync-deployments.mjs [chainId ...]   (default: every <chainId>.json found)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "contracts", "deployments");
const out = join(here, "..", "src", "config", "deployments.json");
const wanted = process.argv.slice(2);
const files = readdirSync(src).filter((f) => /^\d+\.json$/.test(f) && (wanted.length === 0 || wanted.includes(f.slice(0, -5))));
const all = {};
for (const f of files) all[f.slice(0, -5)] = JSON.parse(readFileSync(join(src, f), "utf8"));
writeFileSync(out, JSON.stringify(all, null, 2) + "\n");
console.log(`wrote ${out}: chains ${Object.keys(all).join(", ") || "(none)"}`);
