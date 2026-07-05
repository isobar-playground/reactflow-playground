import { describe, it, expect } from "vitest";
import { computeActualCost, formatActualCost } from "./actual-cost";

// actual-cost (CONTEXT.md's Actual Cost / ADR-0009, issue #41): what one
// generation really cost — billable units × the Model's snapshotted unit
// price. Unlike Estimated Price (lib/price-estimate.ts), there is no naive
// unit guessing: FAL already reports the real billed unit count.

describe("computeActualCost", () => {
  it("multiplies the billable units by the Model's snapshotted unit price", () => {
    const amount = computeActualCost({
      pricing: { unitPrice: 0.05, unit: "megapixels", currency: "usd" },
      billableUnits: 2,
    });

    expect(amount).toBe(0.1);
  });

  it("returns undefined when there's no pricing snapshot", () => {
    const amount = computeActualCost({ pricing: null, billableUnits: 2 });

    expect(amount).toBeUndefined();
  });

  it("returns undefined when there's no billable-units figure", () => {
    const amount = computeActualCost({
      pricing: { unitPrice: 0.05, unit: "megapixels", currency: "usd" },
      billableUnits: undefined,
    });

    expect(amount).toBeUndefined();
  });
});

describe("formatActualCost", () => {
  it("formats a dollar amount to two decimal places", () => {
    expect(formatActualCost(0.1)).toBe("$0.10");
  });

  it("returns undefined (no display) when there's no amount", () => {
    expect(formatActualCost(undefined)).toBeUndefined();
  });
});
