"use server";

import { revalidatePath } from "next/cache";
import { approveModel, unapproveModel, listApprovedEndpointIds } from "@/lib/model-approvals";
import { listModels, type Model } from "@/lib/fal-models";
import { modelsForKind } from "@/lib/model-filter";

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
