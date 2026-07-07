// Pure, isolated filter for the Model Catalog (ADR-0006, PRD #24). No I/O and
// no React so it can be unit-tested directly and reused by the browser to
// derive its visible list client-side (instant, no re-fetch — PRD #27).
//
// `query` is matched case-insensitively as a substring against a Model's name,
// description, tags, and endpoint_id. FAL has no dedicated provider field, so
// covering endpoint_id (and name/description/tags) is what lets a provider
// query like "Google" or "KLING" surface that provider's models (PRD #24).

import type { Model, ModelCategory } from "./fal-models";
import { deriveFamily } from "./model-family";

export type ApprovalFilter = "all" | "approved" | "not-approved";
export type SortOrder = "newest" | "oldest" | "name";

export interface FilterCriteria {
  /** Free-text substring, matched case-insensitively across four fields. */
  query?: string;
  /** Narrow to one category; unset means all categories. */
  category?: ModelCategory | "all";
  /** Narrow to one derived Family (ADR-0010); "all"/unset means no narrowing. */
  family?: string;
  /** Narrow by approval state; unset means all. */
  approval?: ApprovalFilter;
  /** The approved endpoint ids, needed to evaluate the approval filter. */
  approvedIds?: string[];
  /** Result ordering; defaults to newest-added first. */
  sort?: SortOrder;
}

export function filterModels(
  models: Model[],
  criteria: FilterCriteria = {},
): Model[] {
  const query = criteria.query?.trim().toLowerCase() ?? "";
  const category = criteria.category ?? "all";
  const family = criteria.family ?? "all";
  const approval = criteria.approval ?? "all";
  const approvedIds = new Set(criteria.approvedIds ?? []);

  const matched = models.filter(
    (m) =>
      matchesQuery(m, query) &&
      (category === "all" || m.category === category) &&
      (family === "all" || deriveFamily(m.endpointId) === family) &&
      matchesApproval(approval, approvedIds.has(m.endpointId)),
  );

  return sortModels(matched, criteria.sort ?? "newest");
}

// `matched` is already a fresh array, so sort it in place. ISO-8601 date
// strings compare chronologically as plain strings; models missing `addedAt`
// (rare, old entries) fall to the end under "newest". Sort is stable, so when
// dates tie (or all are absent) the original order is preserved.
function sortModels(models: Model[], sort: SortOrder): Model[] {
  if (sort === "name") {
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }
  const dir = sort === "oldest" ? 1 : -1;
  return models.sort(
    (a, b) => dir * (a.addedAt ?? "").localeCompare(b.addedAt ?? ""),
  );
}

function matchesApproval(approval: ApprovalFilter, isApproved: boolean): boolean {
  if (approval === "approved") return isApproved;
  if (approval === "not-approved") return !isApproved;
  return true;
}

// Output-modality grouping (ADR-0007, PRD #28 item D): which Approved Models
// a Generation Node's Model picker offers is constrained by output kind, not
// by a 1:1 category — an Image Generation Node offers both image-output
// categories, a Video Generation Node all three video-output ones.
const CATEGORIES_BY_KIND: Record<"image" | "video", ModelCategory[]> = {
  image: ["text-to-image", "image-to-image"],
  video: ["text-to-video", "image-to-video", "video-to-video"],
};

export function modelsForKind(models: Model[], kind: "image" | "video"): Model[] {
  const categories = new Set<ModelCategory>(CATEGORIES_BY_KIND[kind]);
  return models.filter((m) => categories.has(m.category));
}

// selectableBaseModels (CONTEXT.md's Edit Model, ADR-0014, PRD #69): which
// Approved Models a Generation Node's Model picker offers as a *base*. An
// image-to-image Model is always selectable — it edits with itself, needing
// no pairing. A text-to-image Model is selectable only once it has a paired
// Edit Model configured in the Models tab: "A text-to-image Model with no
// paired Edit Model cannot be selected as a base (it could generate but
// never edit), so it is not offered in the Model picker." Every other
// category (image-to-video, text-to-video, video-to-video) is untouched —
// the Edit lifecycle is scoped to images only, so the pairing has no bearing
// on a Video Generation Node's picker.
export function selectableBaseModels(models: Model[], pairs: Record<string, string>): Model[] {
  return models.filter((m) => m.category !== "text-to-image" || Boolean(pairs[m.endpointId]));
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
