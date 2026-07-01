"use server";

import { revalidatePath } from "next/cache";
import { approveModel, unapproveModel } from "@/lib/model-approvals";

export async function approveModelAction(endpointId: string) {
  await approveModel(endpointId);
  revalidatePath("/models");
}

export async function unapproveModelAction(endpointId: string) {
  await unapproveModel(endpointId);
  revalidatePath("/models");
}
