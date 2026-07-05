import { describe, it, expect } from "vitest";
import { estimatePrice, formatEstimatedPrice } from "./price-estimate";

// price-estimate (CONTEXT.md's Estimated Price / issue #37): a pure module —
// unit price × naively estimated units (1 for images/megapixels/units, the
// schema's default duration for seconds) × variant count. Never a quote.

describe("estimatePrice", () => {
  it("is the unit price for a single variant of a per-image-priced Model", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 0.08, unit: "images", currency: "USD" },
      variantCount: 1,
    });

    expect(amount).toBe(0.08);
  });

  it("is the unit price for a single variant of a per-megapixel-priced Model (1 naive unit)", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 0.003, unit: "megapixels", currency: "USD" },
      variantCount: 1,
    });

    expect(amount).toBe(0.003);
  });

  it("multiplies by the schema's default duration for a per-second-priced Model", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" },
      variantCount: 1,
      defaultDurationSeconds: 5,
    });

    expect(amount).toBeCloseTo(0.7);
  });

  it("multiplies by the variant count", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 0.08, unit: "images", currency: "USD" },
      variantCount: 4,
    });

    expect(amount).toBeCloseTo(0.32);
  });

  it("is undefined when there is no pricing entry", () => {
    expect(estimatePrice({ pricing: null, variantCount: 1 })).toBeUndefined();
    expect(estimatePrice({ variantCount: 1 })).toBeUndefined();
  });

  it("is undefined for a per-second-priced Model with no resolvable default duration", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" },
      variantCount: 1,
    });

    expect(amount).toBeUndefined();
  });

  it("is the unit price for a single variant of a per-unit-priced Model (1 naive unit)", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 1, unit: "units", currency: "USD" },
      variantCount: 1,
    });

    expect(amount).toBe(1);
  });

  it("is undefined for a pricing unit this naive estimation doesn't cover", () => {
    const amount = estimatePrice({
      pricing: { unitPrice: 1, unit: "requests", currency: "USD" },
      variantCount: 1,
    });

    expect(amount).toBeUndefined();
  });
});

describe("formatEstimatedPrice", () => {
  it("labels the amount as an estimate, never a bare number", () => {
    expect(formatEstimatedPrice(0.28)).toBe("Est. ~$0.28");
  });

  it("returns undefined when there is no amount to show", () => {
    expect(formatEstimatedPrice(undefined)).toBeUndefined();
  });
});
