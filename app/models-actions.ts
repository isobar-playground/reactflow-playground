"use server";

import { revalidatePath } from "next/cache";
import { approveModel, unapproveModel, listApprovedEndpointIds } from "@/lib/model-approvals";
import { listModels, type Model } from "@/lib/fal-models";
import { modelsForKind } from "@/lib/model-filter";
import { fetchModelInputSchema, deriveInputHandles, type DeriveInputHandlesResult } from "@/lib/fal-schema";
import { fetchModelPricing, fetchPricingBatch, fetchPricingChunk, type ModelPricing } from "@/lib/fal-pricing";

export type ApprovedModel = Model & {
  pricing?: ModelPricing | null;
};

export async function approveModelAction(endpointId: string) {
  await approveModel(endpointId);
  revalidatePath("/models");
}

export async function unapproveModelAction(endpointId: string) {
  await unapproveModel(endpointId);
  revalidatePath("/models");
}

// The Model picker's one call (ADR-0007 / PRD #28 item F): joins the live
// catalog (ADR-0006) against approvals, narrowed to the Generation Node's
// output kind (lib/model-filter.ts's modelsForKind) — name/thumbnail only,
// no schema fetch. If FAL is unreachable the picker gets an empty list
// rather than the whole node crashing (mirrors app/models/page.tsx).
export async function approvedModelsForKind(kind: "image" | "video"): Promise<ApprovedModel[]> {
  const approvedIds = await listApprovedEndpointIds();
  let models: Model[];
  try {
    models = await listModels();
  } catch {
    return [];
  }
  const approved = modelsForKind(models, kind).filter((m) => approvedIds.includes(m.endpointId));
  const pricingByEndpoint = await fetchPricingBatch(approved.map((model) => model.endpointId));
  return approved.map((model) => ({
    ...model,
    pricing: pricingByEndpoint.get(model.endpointId) ?? null,
  }));
}

export interface ModelSelectionResult extends DeriveInputHandlesResult {
  /** The Model's pricing entry (issue #37 / ADR-0009), or null when
   * unresolvable — snapshotted into node data alongside the handles so a
   * Model without pricing simply shows no Estimated Price. */
  pricing: ModelPricing | null;
}

// Model-select handle + pricing derivation (ADR-0007 / ADR-0008 / issue #30,
// extended by ADR-0009 / issue #37): fetches one endpoint's FAL OpenAPI
// document (deriving its Input Handles and default duration) and its
// pricing entry, in parallel. Runs server-side because neither FAL endpoint
// is reachable via a browser fetch (no CORS / requires FAL_KEY) — the Model
// picker's onChange calls this action instead of lib/fal-schema.ts or
// lib/fal-pricing.ts directly.
export async function fetchModelSchemaAction(endpointId: string): Promise<ModelSelectionResult> {
  const [schema, pricing] = await Promise.all([
    fetchModelInputSchema(endpointId).then((document) => deriveInputHandles(document, endpointId)),
    fetchModelPricing(endpointId),
  ]);
  return { ...schema, pricing };
}

// Lazy Unit Price fetch for the /models catalog (ADR-0010 revision): the
// catalog is ~1000+ Models, and FAL's pricing endpoint's rate limit can't
// absorb pricing every Model up front (chunked-and-throttled still trips
// 429s across ~35 sequential chunks). Instead, ModelsBrowser calls this once
// per change to its visible (filtered) set, so a typical search/filter only
// prices a handful of Models rather than the whole catalog. Returns a plain
// object (not the Map fetchPricingBatch uses internally) since server action
// return values must be serializable across the RSC boundary.
export async function fetchCatalogPricingAction(
  endpointIds: string[],
): Promise<Record<string, ModelPricing>> {
  const pricingById = await fetchPricingBatch(endpointIds);
  return Object.fromEntries(pricingById);
}

export interface CatalogPricingChunkResult {
  prices: Record<string, ModelPricing>;
  /** Set when FAL rate-limited this chunk — its `Retry-After`, in seconds. */
  retryAfterSeconds?: number;
}

// "Load prices anyway" (ADR-0010 revision): the /models catalog's manual,
// deliberately-slow escape hatch for a result set too large to auto-price
// (MAX_AUTO_PRICING_MODELS). ModelsBrowser calls this once per <=30-id
// chunk, waiting out `retryAfterSeconds` between chunks when FAL rate-limits
// one, instead of fetchCatalogPricingAction's silent best-effort.
export async function fetchCatalogPricingChunkAction(
  endpointIds: string[],
): Promise<CatalogPricingChunkResult> {
  const { prices, retryAfterSeconds } = await fetchPricingChunk(endpointIds);
  return { prices: Object.fromEntries(prices), retryAfterSeconds };
}
