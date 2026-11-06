/**
 * Read-only JSON-RPC proxy in front of the live-mode anvil (docs/DEPLOYMENTS.md §A).
 *
 * anvil itself must never be exposed: anyone could call `anvil_setStorageAt` (rewrite the "oracle"), `anvil_setBalance`,
 * or sign transactions with anvil's public test keys (which include our deployer, bot and shock wallets). This proxy
 * forwards only the read methods the frontend (`/tx/<hash>`, charts) and `pnpm verify` need, and refuses everything
 * else, including every send and every `anvil_*` / `evm_*` / `hardhat_*` / `debug_*` method.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const READ_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "web3_clientVersion",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
]);

const MAX_BODY = 256 * 1024;

type RpcReq = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };
const refuse = (r: RpcReq, message: string) => ({ jsonrpc: "2.0", id: r?.id ?? null, error: { code: -32601, message } });

/** Split a request (single or batch) into allowed calls and refusals. Pure; exported for tests. */
export function filterRpc(body: unknown): { allowed: RpcReq[]; refused: Array<ReturnType<typeof refuse>>; batch: boolean } {
  const batch = Array.isArray(body);
  const reqs = (batch ? body : [body]) as RpcReq[];
  const allowed: RpcReq[] = [];
  const refused: Array<ReturnType<typeof refuse>> = [];
  for (const r of reqs) {
    if (r && typeof r === "object" && typeof r.method === "string" && READ_METHODS.has(r.method)) allowed.push(r);
    else refused.push(refuse(r, `method not allowed on the public read-only RPC: ${String(r?.method)}`));
  }
  return { allowed, refused, batch };
}

export interface ReadOnlyRpcOptions {
  upstream: string; // anvil URL (bound to 127.0.0.1)
  port: number;
  host?: string;
  corsOrigins: string[]; // exact origins; "*" allows any
}

export function startReadOnlyRpc(o: ReadOnlyRpcOptions): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && (o.corsOrigins.includes("*") || o.corsOrigins.includes(origin))) {
      res.setHeader("access-control-allow-origin", o.corsOrigins.includes("*") ? "*" : origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-methods", "POST, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
    }
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (req.method !== "POST") return void res.writeHead(405, { "content-type": "text/plain" }).end("POST JSON-RPC only");
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
      }
      const { allowed, refused, batch } = filterRpc(body);
      let answers: unknown[] = [];
      if (allowed.length > 0) {
        try {
          const up = await fetch(o.upstream, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(allowed), signal: AbortSignal.timeout(15_000) });
          const j = (await up.json()) as unknown;
          answers = Array.isArray(j) ? j : [j];
        } catch {
          answers = allowed.map((r) => ({ jsonrpc: "2.0", id: r.id ?? null, error: { code: -32603, message: "upstream unavailable" } }));
        }
      }
      const out = [...answers, ...refused];
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(batch ? out : out[0]));
    });
  });
  server.listen(o.port, o.host ?? "127.0.0.1");
  return server;
}
