import { describe, expect, it } from "vitest";
import { triggered, triggerProblem } from "../src/lib/orders";

describe("order triggers", () => {
  it("sell take-profit and limit sell fire at or above the trigger", () => {
    for (const kind of ["tp", "limit"] as const) {
      const o = { side: "sellBase" as const, kind, trigger: 2300 };
      expect(triggered(o, 2299.99)).toBe(false);
      expect(triggered(o, 2300)).toBe(true);
      expect(triggered(o, 2310)).toBe(true);
    }
  });

  it("sell stop-loss and stop sell fire at or below the trigger", () => {
    for (const kind of ["sl", "stop"] as const) {
      const o = { side: "sellBase" as const, kind, trigger: 2200 };
      expect(triggered(o, 2200.01)).toBe(false);
      expect(triggered(o, 2200)).toBe(true);
      expect(triggered(o, 2100)).toBe(true);
    }
  });

  it("limit buy fires at or below, stop buy (breakout) at or above", () => {
    expect(triggered({ side: "buyBase", kind: "limit", trigger: 2200 }, 2201)).toBe(false);
    expect(triggered({ side: "buyBase", kind: "limit", trigger: 2200 }, 2199)).toBe(true);
    expect(triggered({ side: "buyBase", kind: "stop", trigger: 2300 }, 2299)).toBe(false);
    expect(triggered({ side: "buyBase", kind: "stop", trigger: 2300 }, 2301)).toBe(true);
  });

  it("buy-side TP/SL (closing a short) mirror the sell side", () => {
    expect(triggered({ side: "buyBase", kind: "tp", trigger: 2300 }, 2301)).toBe(true);
    expect(triggered({ side: "buyBase", kind: "sl", trigger: 2200 }, 2199)).toBe(true);
  });

  it("never fires on a missing price or trigger", () => {
    expect(triggered({ side: "sellBase", kind: "sl", trigger: 2200 }, 0)).toBe(false);
    expect(triggered({ side: "sellBase", kind: "sl", trigger: 0 }, 100)).toBe(false);
  });

  it("flags a trigger that would fill at once, with the right direction", () => {
    expect(triggerProblem({ side: "sellBase", kind: "sl", trigger: 2300 }, 2240)).toMatch(/below the pool price/);
    expect(triggerProblem({ side: "sellBase", kind: "tp", trigger: 2200 }, 2240)).toMatch(/above the pool price/);
    expect(triggerProblem({ side: "buyBase", kind: "limit", trigger: 2300 }, 2240)).toMatch(/below the pool price/);
    expect(triggerProblem({ side: "sellBase", kind: "sl", trigger: 2200 }, 2240)).toBeNull();
    expect(triggerProblem({ side: "sellBase", kind: "sl", trigger: 0 }, 2240)).toMatch(/Enter a trigger/);
  });
});
