// price-estimate (CONTEXT.md's Estimated Price / issue #37): a pure module,
// independent of real generation — the Estimated Price for one Generate
// click, before it happens. It is an estimate, never a quote (that's the
// Actual Cost, ADR-0009): unit price × naively estimated units for one run
// (1 for images/megapixels/units; the Model's schema-derived default
// duration for seconds) × the variant count.

export interface ModelPricingSnapshot {
  unitPrice: number;
  unit: string;
  currency: string;
}

export interface EstimatePriceInput {
  /** The Model's snapshotted pricing entry, or none if unresolvable. */
  pricing?: ModelPricingSnapshot | null;
  /** The total number of variants a Generate click will produce. */
  variantCount: number;
  /** The Model's schema-derived default duration, for per-second pricing. */
  defaultDurationSeconds?: number;
}

// The naive per-run unit count (CONTEXT.md): deliberately not a real
// estimate of the model's actual output size — just 1 for images/
// megapixels/units, or the schema's default duration for seconds. Any other
// unit FAL might report has no naive estimate defined here.
function naiveUnitsForOneRun(unit: string, defaultDurationSeconds?: number): number | undefined {
  switch (unit) {
    case "images":
    case "megapixels":
    case "units":
      return 1;
    case "seconds":
      return defaultDurationSeconds;
    default:
      return undefined;
  }
}

// Returns undefined when there's nothing to show (no pricing entry, or a
// unit this naive estimation doesn't cover) — CONTEXT.md: "A Model without a
// resolvable pricing entry simply shows no estimate."
export function estimatePrice(input: EstimatePriceInput): number | undefined {
  if (!input.pricing) return undefined;

  const units = naiveUnitsForOneRun(input.pricing.unit, input.defaultDurationSeconds);
  if (units === undefined) return undefined;

  return input.pricing.unitPrice * units * input.variantCount;
}

// "Est. ~$0.28" (CONTEXT.md): always labelled as an estimate, never shown as
// a bare number that could be mistaken for a quote.
export function formatEstimatedPrice(amount: number | undefined): string | undefined {
  if (amount === undefined) return undefined;
  return `Est. ~$${amount.toFixed(2)}`;
}
