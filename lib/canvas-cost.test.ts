import { describe, it, expect } from "vitest";
import { totalActualCost } from "./canvas-cost";

// canvas-cost (CONTEXT.md's Actual Cost: "a canvas also shows the running
// sum of all its nodes' Actual Costs", issue #42): a pure module summing
// Actual Cost across every History entry of every node on the canvas.
// Mirrors actual-cost.ts's own convention of returning undefined rather
// than 0 when there's nothing to show.

describe("totalActualCost", () => {
  it("sums Actual Cost across every History entry of every node", () => {
    const total = totalActualCost([
      {
        data: {
          history: {
            entries: [{ actualCost: 0.1 }, { actualCost: 0.2 }],
          },
        },
      },
      {
        data: {
          history: {
            entries: [{ actualCost: 0.05 }],
          },
        },
      },
    ]);

    expect(total).toBeCloseTo(0.35);
  });

  it("ignores entries with no recorded cost (old placeholders, missing pricing)", () => {
    const total = totalActualCost([
      {
        data: {
          history: {
            entries: [{ actualCost: 0.1 }, { actualCost: undefined }, {}],
          },
        },
      },
    ]);

    expect(total).toBeCloseTo(0.1);
  });

  it("returns undefined for an empty canvas", () => {
    expect(totalActualCost([])).toBeUndefined();
  });

  it("returns undefined when nodes exist but none has a costed entry", () => {
    const total = totalActualCost([
      { data: { history: { entries: [] } } },
      { data: {} },
      {},
    ]);

    expect(total).toBeUndefined();
  });
});
