import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filterRpc, startReadOnlyRpc } from "../src/readOnlyRpc.ts";

describe("filterRpc", () => {
  it("allows reads and refuses sends and every cheat/debug method", () => {
    const { allowed, refused, batch } = filterRpc([
      { id: 1, method: "eth_getTransactionReceipt", params: [] },
      { id: 2, method: "eth_sendRawTransaction", params: [] },
      { id: 3, method: "anvil_setStorageAt", params: [] },
      { id: 4, method: "eth_sendTransaction", params: [] },
      { id: 5, method: "evm_mine", params: [] },
      { id: 6, method: "hardhat_setBalance", params: [] },
      { id: 7, method: "debug_traceTransaction", params: [] },
      { id: 8, method: "eth_call", params: [] },
      { id: 9 },
      null,
    ]);
    expect(batch).toBe(true);
    expect(allowed.map((r) => r.id)).toEqual([1, 8]);
    expect(refused.map((r) => r.id)).toEqual([2, 3, 4, 5, 6, 7, 9, null]);
    expect(refused.every((r) => r.error.code === -32601)).toBe(true);
  });
});

describe("startReadOnlyRpc (over HTTP)", () => {
  let upstream: Server;
  let proxy: Server;
  const seen: string[] = [];
  beforeAll(async () => {
    upstream = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        const reqs = JSON.parse(b) as Array<{ id: number; method: string }>;
        for (const r of reqs) seen.push(r.method);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reqs.map((r) => ({ jsonrpc: "2.0", id: r.id, result: "0x7a69" }))));
      });
    }).listen(18741, "127.0.0.1");
    proxy = startReadOnlyRpc({ upstream: "http://127.0.0.1:18741", port: 18742, corsOrigins: ["http://localhost:3000"] });
    await new Promise((r) => setTimeout(r, 100));
  });
  afterAll(() => {
    proxy.close();
    upstream.close();
  });
  const post = (body: unknown, origin?: string) =>
    fetch("http://127.0.0.1:18742", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });

  it("forwards a single read and never forwards a refused method", async () => {
    const ok = await post({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, "http://localhost:3000");
    expect(await ok.json()).toEqual({ jsonrpc: "2.0", id: 1, result: "0x7a69" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const bad = await post({ jsonrpc: "2.0", id: 2, method: "anvil_setStorageAt", params: [] }, "http://evil.example");
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32601);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect(seen).toEqual(["eth_chainId"]);
  });
  it("refuses non-POST and malformed JSON", async () => {
    expect((await fetch("http://127.0.0.1:18742")).status).toBe(405);
    const r = await fetch("http://127.0.0.1:18742", { method: "POST", body: "{nope" });
    expect(r.status).toBe(400);
  });
});
