// Pure, isolated filter for the Model Catalog (ADR-0006, PRD #24). No I/O and
// no React so it can be unit-tested directly and reused by the browser to
// derive its visible list client-side (instant, no re-fetch — PRD #27).
//
// `query` is matched case-insensitively as a substring against a Model's name,
// description, tags, and endpoint_id. FAL has no dedicated provider field, so
// covering endpoint_id (and name/description/tags) is what lets a provider
// query like "Google" or "KLING" surface that provider's models (PRD #24).

import type { Model, ModelCategory } from "./fal-models";

export type ApprovalFilter = "all" | "approved" | "not-approved";

export interface FilterCriteria {
  /** Free-text substring, matched case-insensitively across four fields. */
  query?: string;
  /** Narrow to one category; unset means all categories. */
  category?: ModelCategory | "all";
  /** Narrow by approval state; unset means all. */
  approval?: ApprovalFilter;
  /** The approved endpoint ids, needed to evaluate the approval filter. */
  approvedIds?: string[];
}

export function filterModels(
  models: Model[],
  criteria: FilterCriteria = {},
): Model[] {
  const query = criteria.query?.trim().toLowerCase() ?? "";
  const category = criteria.category ?? "all";
  const approval = criteria.approval ?? "all";
  const approvedIds = new Set(criteria.approvedIds ?? []);

  return models.filter(
    (m) =>
      matchesQuery(m, query) &&
      (category === "all" || m.category === category) &&
      matchesApproval(approval, approvedIds.has(m.endpointId)),
  );
}

function matchesApproval(approval: ApprovalFilter, isApproved: boolean): boolean {
  if (approval === "approved") return isApproved;
  if (approval === "not-approved") return !isApproved;
  return true;
}

function matchesQuery(model: Model, query: string): boolean {
  if (!query) return true;
  const haystack = [
    model.name,
    model.description,
    model.endpointId,
    ...model.tags,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
