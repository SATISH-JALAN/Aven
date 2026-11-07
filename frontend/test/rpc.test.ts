import { describe, expect, it } from "vitest";
import { classify, createBalancer, PER_MIN_BUDGET, type RpcArgs, type Upstream } from "../src/lib/rpc";

/** A fake endpoint: `answer` decides each call; every call is logged as "<url>:<method>". */
function fake(url: string, answer: (a: RpcArgs) => unknown | Promise<unknown>, log: string[]): Upstream {
  return {
    url,
    request: async (a) => {
      log.push(`${url}:${a.method}`);
      const r = await answer(a);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const throttle = () => Object.assign(new Error("Request exceeds defined limit"), { code: -32005 });
const revert = () => new Error("execution reverted: GAP_TOO_LARGE");

describe("classify", () => {
  it("separates throttles, transient failures and real answers", () => {
    expect(classify(throttle())).toBe("throttled");
    expect(classify(Object.assign(new Error("HTTP request failed."), { status: 429 }))).toBe("throttled");
    expect(classify(new Error("rate limit exceeded"))).toBe("throttled");
    expect(classify(new Error("The request took too long to respond. timed out"))).toBe("transient");
    expect(classify(Object.assign(new Error("HTTP request failed."), { status: 502 }))).toBe("transient");
    expect(classify(new Error("Failed to fetch"))).toBe("transient");
    expect(classify(new Error("the method eth_foo does not exist/is not available -32601"))).toBe("transient");
    expect(classify(revert())).toBe("final");
    expect(classify(new Error("invalid argument 0: hex string has odd length"))).toBe("final");
  });
});

describe("createBalancer", () => {
  it("fails over on a throttle and cools the throttled endpoint down", async () => {
    const log: string[] = [];
    let t = 0;
    const b = createBalancer([fake("a", () => throttle(), log), fake("b", () => "0x1", log)], () => t);
    expect(await b.request({ method: "eth_chainId" })).toBe("0x1");
    expect(log).toEqual(["a:eth_chainId", "b:eth_chainId"]);
    expect(b.healthy()).toBe(1);
    // While "a" cools down, calls go straight to "b".
    log.length = 0;
    t = 1_000;
    await b.request({ method: "eth_chainId" });
    expect(log).toEqual(["b:eth_chainId"]);
    // After the 4 s cooldown "a" is healthy again.
    t = 5_000;
    expect(b.healthy()).toBe(2);
  });

  it("doubles the cooldown on repeated throttles, capped at 60 s", async () => {
    const log: string[] = [];
    let t = 0;
    const b = createBalancer([fake("a", () => throttle(), log), fake("b", () => "0x1", log)], () => t);
    const cooldowns: number[] = [];
    for (let i = 0; i < 6; i++) {
      t = b.states()[0]!.cooldownUntil; // wait until "a" is due again, so it's tried first
      b.states()[1]!.ewmaMs = 1e9; // make "b" unattractive so "a" is always picked first when healthy
      await b.request({ method: "eth_chainId" });
      cooldowns.push(b.states()[0]!.cooldownUntil - t);
    }
    expect(cooldowns).toEqual([4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  it("throws a revert at once without trying other endpoints", async () => {
    const log: string[] = [];
    const b = createBalancer([fake("a", () => revert(), log), fake("b", () => "0x1", log)]);
    await expect(b.request({ method: "eth_call" })).rejects.toThrow(/GAP_TOO_LARGE/);
    expect(log).toEqual(["a:eth_call"]);
    expect(b.healthy()).toBe(2); // a revert is an answer, not an endpoint failure
  });

  it("throws the last error when every endpoint fails", async () => {
    const log: string[] = [];
    const b = createBalancer([fake("a", () => throttle(), log), fake("b", () => new Error("Failed to fetch"), log)]);
    await expect(b.request({ method: "eth_chainId" })).rejects.toThrow(/Failed to fetch/);
    expect(log).toEqual(["a:eth_chainId", "b:eth_chainId"]);
    expect(b.healthy()).toBe(0);
  });

  it("spreads concurrent calls by in-flight load", async () => {
    const log: string[] = [];
    const slow = () => new Promise((r) => setTimeout(() => r("0x1"), 5));
    const b = createBalancer([fake("a", slow, log), fake("b", slow, log), fake("c", slow, log)]);
    await Promise.all(Array.from({ length: 6 }, () => b.request({ method: "eth_getLogs" })));
    const per = (u: string) => log.filter((l) => l.startsWith(`${u}:`)).length;
    expect([per("a"), per("b"), per("c")]).toEqual([2, 2, 2]);
  });

  it("hedges eth_blockNumber over the two best endpoints and returns the higher block", async () => {
    const log: string[] = [];
    const b = createBalancer(
      [fake("a", () => "0x64", log), fake("b", () => "0x65", log), fake("c", () => "0x66", log)], // 100, 101, 102
    );
    expect(await b.head()).toBe(101n); // "c" is third by initial ranking and isn't asked
    expect(log.sort()).toEqual(["a:eth_blockNumber", "b:eth_blockNumber"]);
  });

  it("skips an endpoint two or more blocks behind the freshest head", async () => {
    const log: string[] = [];
    const b = createBalancer([fake("a", () => "0x64", log), fake("b", () => "0x6e", log)]); // 100 vs 110
    await b.head();
    log.length = 0;
    await b.request({ method: "eth_call" });
    expect(log).toEqual(["b:eth_call"]); // "a" ranks first by latency but is 10 blocks behind
  });

  it("uses a cooling endpoint only when nothing else is left", async () => {
    const log: string[] = [];
    let t = 0;
    let n = 0;
    const flaky = () => (n++ === 0 ? throttle() : "0x2");
    const b = createBalancer([fake("a", flaky, log)], () => t);
    await expect(b.request({ method: "eth_chainId" })).rejects.toThrow(/exceeds defined limit/);
    t = 100; // still cooling, but it's the only endpoint: try it rather than fail without asking
    expect(await b.request({ method: "eth_chainId" })).toBe("0x2");
  });

  it("moves to the next endpoint once one has used its per-minute budget, and back after the window", async () => {
    const log: string[] = [];
    let t = 0;
    const b = createBalancer([fake("a", () => "0x1", log), fake("b", () => "0x1", log)], () => t);
    b.states()[1]!.ewmaMs = 5_000; // "a" is much faster, so it gets everything while it has budget
    for (let i = 0; i < PER_MIN_BUDGET + 10; i++) {
      t = i * 100;
      b.states()[0]!.ewmaMs = 300; // keep "a" fast regardless of measured fake latency
      await b.request({ method: "eth_call" });
    }
    const per = (u: string) => log.filter((l) => l.startsWith(`${u}:`)).length;
    expect(per("a")).toBe(PER_MIN_BUDGET);
    expect(per("b")).toBe(10);
    log.length = 0;
    t = 70_000; // a's oldest calls left the 60 s window
    await b.request({ method: "eth_call" });
    expect(log).toEqual(["a:eth_call"]);
  });
});
