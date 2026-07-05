"use server";

// Thin server actions over lib/fal-generation (ADR-0009): FAL's queue API
// isn't reachable from a browser fetch any more reliably than the schema
// endpoint is (see app/models-actions.ts's fetchModelSchemaAction), and
// FAL_KEY must never leave the server, so the Image Generation Node calls
// these instead of lib/fal-generation.ts directly.

import {
  submitGeneration,
  getGenerationStatus,
  getGenerationResult,
  type PendingGeneration,
} from "@/lib/fal-generation";

export type { PendingGeneration };

// Submits a generation request to the selected Model's FAL queue endpoint.
// The returned pending record (request id + status/response URLs, used
// verbatim) is what the caller persists into the node's `data`.
export async function submitGenerationAction(
  endpointId: string,
  input: Record<string, unknown>,
): Promise<PendingGeneration> {
  return submitGeneration(endpointId, input);
}

export type GenerationPollResult =
  | { status: "pending" }
  | { status: "completed"; mediaUrl: string }
  | { status: "error"; message: string };

// One poll of a pending generation (CONTEXT.md / ADR-0009): still queued or
// running -> "pending"; done -> fetches the result and extracts the
// generated asset's URL (image or video, per issue #39 — the queue API is
// one shared transport for both node kinds); any FAL error (bad status
// code, unrecognized result shape) surfaces as "error" rather than
// throwing, so the client can show it without a crash.
export async function pollGenerationAction(
  pending: PendingGeneration,
): Promise<GenerationPollResult> {
  try {
    const { status } = await getGenerationStatus(pending.statusUrl);
    if (status !== "COMPLETED") return { status: "pending" };

    const { mediaUrl } = await getGenerationResult(pending.responseUrl);
    return { status: "completed", mediaUrl };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "FAL generation failed",
    };
  }
}
