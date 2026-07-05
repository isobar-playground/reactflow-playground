"use server";

import { revalidatePath } from "next/cache";
import { approveModel, unapproveModel, listApprovedEndpointIds } from "@/lib/model-approvals";
import { listModels, type Model } from "@/lib/fal-models";
import { modelsForKind } from "@/lib/model-filter";
import { fetchModelInputSchema, deriveInputHandles, type DeriveInputHandlesResult } from "@/lib/fal-schema";
import { fetchModelPricing, type ModelPricing } from "@/lib/fal-pricing";

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
export async function approvedModelsForKind(kind: "image" | "video"): Promise<Model[]> {
  const approvedIds = await listApprovedEndpointIds();
  let models: Model[];
  try {
    models = await listModels();
  } catch {
    return [];
  }
  return modelsForKind(models, kind).filter((m) => approvedIds.includes(m.endpointId));
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
