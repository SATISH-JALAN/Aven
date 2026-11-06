/**
 * `pnpm demo` (root) / `pnpm --filter @aven/scripts demo`: run the demo against a running Arena service and save the
 * run as frontend/public/arena-fallback.json ("Recorded run", ARCHITECTURE §12 fallback).
 * Env: ARENA_URL (default NEXT_PUBLIC_ARENA_API or http://localhost:8787), ARENA_ADMIN_TOKEN (required).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runDemo, summarize } from "./src/demo.ts";

const baseUrl = process.env.ARENA_URL ?? process.env.NEXT_PUBLIC_ARENA_API ?? "http://localhost:8787";
const adminToken = process.env.ARENA_ADMIN_TOKEN;
if (!adminToken) throw new Error("set ARENA_ADMIN_TOKEN");
const rec = await runDemo({ baseUrl, adminToken, log: (s) => console.log(`[demo] ${s}`) });
const out = fileURLToPath(new URL("../../frontend/public/arena-fallback.json", import.meta.url));
mkdirSync(fileURLToPath(new URL("../../frontend/public/", import.meta.url)), { recursive: true });
writeFileSync(out, `${JSON.stringify({ ...rec, source: `Arena service ${baseUrl}` }, null, 1)}\n`);
console.log(summarize(rec));
console.log(`[demo] saved frontend/public/arena-fallback.json`);
