"use server";

import { revalidatePath } from "next/cache";
import { approveModel, unapproveModel, listApprovedEndpointIds } from "@/lib/model-approvals";
import { listModels, type Model } from "@/lib/fal-models";
import { modelsForKind } from "@/lib/model-filter";
import { fetchModelInputSchema, deriveInputHandles, type DeriveInputHandlesResult } from "@/lib/fal-schema";

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

// Model-select handle derivation (ADR-0007 / ADR-0008 / issue #30): fetches
// one endpoint's FAL OpenAPI document and derives its Input Handles. Runs
// server-side because FAL's openapi.json endpoint isn't reachable via a
// browser fetch (no CORS) — the Model picker's onChange calls this action
// instead of lib/fal-schema.ts directly.
export async function fetchModelSchemaAction(endpointId: string): Promise<DeriveInputHandlesResult> {
  const schema = await fetchModelInputSchema(endpointId);
  return deriveInputHandles(schema, endpointId);
}
