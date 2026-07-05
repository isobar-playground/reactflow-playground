// actual-cost (CONTEXT.md's Actual Cost / ADR-0009, issue #41): a pure
// module computing what one generation really cost, once it's finished —
// the billable units FAL reports for the run (lib/fal-generation.ts's
// `x-fal-billable-units` header, threaded through lib/real-generation.ts) ×
// the Model's pricing snapshot's unit price. Reuses price-estimate.ts's
// ModelPricingSnapshot (the same snapshot Estimated Price reads from
// data.model.pricing) rather than duplicating the pricing shape.
//
// Unlike the Estimated Price (lib/price-estimate.ts), there is no naive unit
// guessing here: FAL already reports the real billed unit count for
// whatever unit that Model bills in, so this is a plain multiplication.

import type { ModelPricingSnapshot } from "./price-estimate";

export interface ActualCostInput {
  /** The Model's snapshotted pricing entry, or none if unresolvable
   * (CONTEXT.md: a node without a pricing snapshot records no cost). */
  pricing?: ModelPricingSnapshot | null;
  /** FAL's billed unit count for the finished run, or undefined when the
   * result carried no `x-fal-billable-units` header (CONTEXT.md: records no
   * cost either way). */
  billableUnits?: number;
}

// Returns undefined when there's nothing to compute (no pricing snapshot, or
// no billable-units figure) — CONTEXT.md: "A run whose result carries no
// billable-units header, or a node without a pricing snapshot, records no
// cost."
export function computeActualCost(input: ActualCostInput): number | undefined {
  if (!input.pricing || input.billableUnits === undefined) return undefined;

  return input.pricing.unitPrice * input.billableUnits;
}

// "$0.28" (CONTEXT.md's Actual Cost: avoid "spend"): a plain dollar amount,
// never prefixed "Est." — unlike Estimated Price, this is what the run
// really cost, not a guess.
export function formatActualCost(amount: number | undefined): string | undefined {
  if (amount === undefined) return undefined;
  return `$${amount.toFixed(2)}`;
}
