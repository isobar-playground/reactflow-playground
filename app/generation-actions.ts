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
  inlineLocalAssets,
  type PendingGeneration,
  type LocalAssetRef,
} from "@/lib/fal-generation";

// Connected media inputs (issue #40 / ADR-0009): the local-filesystem Asset
// Library backend (ADR-0005) serves assets from a relative `/uploads/...`
// path, which a plain server-side `fetch` can't resolve on its own — unlike
// the Blob backend's already-absolute URLs, or an upstream Generation Node's
// fal.media output (which never needs inlining at all — see
// lib/generation-payload.ts). NEXT_PUBLIC_APP_URL/VERCEL_URL cover deployed
// environments; local dev falls back to Next's own default port.
function resolveAssetOrigin(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Submits a generation request to the selected Model's FAL queue endpoint.
// `localAssetRefs` (issue #40) names which of `input`'s fields are local
// Asset Library assets that need inlining as base64 data URIs before FAL can
// ever see them (lib/fal-generation.ts's inlineLocalAssets) — omitted/empty
// when the node has no connected local assets, in which case `input` is
// submitted verbatim exactly as before. The returned pending record (request
// id + status/response URLs, used verbatim) is what the caller persists
// into the node's `data`.
export async function submitGenerationAction(
  endpointId: string,
  input: Record<string, unknown>,
  localAssetRefs: LocalAssetRef[] = [],
): Promise<PendingGeneration> {
  const resolvedInput = await inlineLocalAssets(input, localAssetRefs, {
    resolveUrl: (url) => (url.startsWith("/") ? `${resolveAssetOrigin()}${url}` : url),
  });
  return submitGeneration(endpointId, resolvedInput);
}

export type GenerationPollResult =
  | { status: "pending" }
  // billableUnits (CONTEXT.md's Actual Cost / ADR-0009, issue #41): FAL's
  // x-fal-billable-units header, forwarded verbatim from
  // lib/fal-generation.ts's getGenerationResult; undefined when FAL's result
  // carried none.
  | { status: "completed"; mediaUrl: string; billableUnits?: number }
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

    const { mediaUrl, billableUnits } = await getGenerationResult(pending.responseUrl);
    return { status: "completed", mediaUrl, billableUnits };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "FAL generation failed",
    };
  }
}
