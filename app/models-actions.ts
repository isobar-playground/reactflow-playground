"use server";

import { revalidatePath } from "next/cache";
import { approveModel, unapproveModel, listApprovedEndpointIds } from "@/lib/model-approvals";
import { listEditPairs, setEditPair, clearEditPair } from "@/lib/model-edit-pairs";
import { listModels, type Model } from "@/lib/fal-models";
import { modelsForKind, selectableBaseModels } from "@/lib/model-filter";
import { fetchModelInputSchema, deriveInputHandles, type DeriveInputHandlesResult } from "@/lib/fal-schema";
import { fetchModelPricing, fetchPricingBatch, fetchPricingChunk, type ModelPricing } from "@/lib/fal-pricing";
import { primaryImageHandle, type EditModelSnapshot } from "@/lib/generation-run";

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

// Edit Model pairing (CONTEXT.md's Edit Model, ADR-0014, PRD #69): the
// Models tab's admin actions for the app-owned text-to-image → Edit Model
// map. Mirrors approveModelAction/unapproveModelAction's shape.
export async function setEditPairAction(baseEndpointId: string, editEndpointId: string) {
  await setEditPair(baseEndpointId, editEndpointId);
  revalidatePath("/models");
}

export async function clearEditPairAction(baseEndpointId: string) {
  await clearEditPair(baseEndpointId);
  revalidatePath("/models");
}

export async function listEditPairsAction(): Promise<Record<string, string>> {
  return listEditPairs();
}

// The Model picker's one call (ADR-0007 / PRD #28 item F, extended by
// ADR-0014 / PRD #69): joins the live catalog (ADR-0006) against approvals,
// narrowed to the Generation Node's output kind (lib/model-filter.ts's
// modelsForKind) and then to the Models selectable as a *base*
// (selectableBaseModels) — an unpaired text-to-image Model can generate but
// never edit, so it's excluded here rather than in the node component. Only
// name/thumbnail/pricing, no schema fetch. If FAL is unreachable the picker
// gets an empty list rather than the whole node crashing (mirrors
// app/models/page.tsx).
export async function approvedModelsForKind(kind: "image" | "video"): Promise<ApprovedModel[]> {
  const [approvedIds, pairs] = await Promise.all([listApprovedEndpointIds(), listEditPairs()]);
  let models: Model[];
  try {
    models = await listModels();
  } catch {
    return [];
  }
  const approved = selectableBaseModels(modelsForKind(models, kind), pairs).filter((m) =>
    approvedIds.includes(m.endpointId),
  );
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
  /** The paired Edit Model's snapshot (CONTEXT.md's Edit Model, ADR-0014,
   * PRD #69), resolved when this endpoint has a configured pairing; `null`
   * otherwise — including for an image-to-image base, which edits with
   * itself and needs no separate snapshot (lib/generation-run.ts). */
  editModel: EditModelSnapshot | null;
}

// Model-select handle + pricing derivation (ADR-0007 / ADR-0008 / issue #30,
// extended by ADR-0009 / issue #37, and by ADR-0014 / PRD #69): fetches one
// endpoint's FAL OpenAPI document (deriving its Input Handles and default
// duration) and its pricing entry, in parallel. Runs server-side because
// neither FAL endpoint is reachable via a browser fetch (no CORS / requires
// FAL_KEY) — the Model picker's onChange calls this action instead of
// lib/fal-schema.ts or lib/fal-pricing.ts directly. When the selected
// endpoint has a configured Edit Model pairing, that Edit Model's own
// schema/pricing is resolved too and snapshotted alongside — so a text-to-
// image base's first Edit never needs a live fetch (extends ADR-0008's
// snapshot-at-selection stance to the Edit Model).
export async function fetchModelSchemaAction(endpointId: string): Promise<ModelSelectionResult> {
  const [schema, pricing, pairs] = await Promise.all([
    fetchModelInputSchema(endpointId).then((document) => deriveInputHandles(document, endpointId)),
    fetchModelPricing(endpointId),
    listEditPairs(),
  ]);
  const editEndpointId = pairs[endpointId];
  const editModel = editEndpointId ? await resolveEditModelSnapshot(editEndpointId) : null;
  return { ...schema, pricing, editModel };
}

async function resolveEditModelSnapshot(editEndpointId: string): Promise<EditModelSnapshot | null> {
  const [editSchema, editPricing] = await Promise.all([
    fetchModelInputSchema(editEndpointId).then((document) => deriveInputHandles(document, editEndpointId)),
    fetchModelPricing(editEndpointId),
  ]);
  const handle = primaryImageHandle(editSchema.handles);
  if (!handle) return null;

  return {
    endpointId: editEndpointId,
    primaryImageHandleId: handle.handleId,
    hasNegativePrompt: editSchema.hasNegativePrompt,
    pricing: editPricing,
  };
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
