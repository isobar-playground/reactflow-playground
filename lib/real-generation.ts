// real-generation (ADR-0009): a Generation Node's one call to go from a
// Model + prompt to a finished output — submits via the queue-API server
// action, then polls the status server action every few seconds until FAL
// reports COMPLETED (or a failure), and extracts the resulting asset's URL.
//
// Issue #39 generalizes this from the Image Generation Node's original
// shape to a shared transport for both node kinds (ADR-0009: "one transport
// for both node kinds") — submit/poll/extract are identical for image and
// video Models, they only differ in which placeholder `kind` the finished
// output is tagged with. `runImageGeneration`/`resumeImageGeneration` and
// `runVideoGeneration`/`resumeVideoGeneration` are thin, kind-specific
// wrappers over the same internal `pollUntilSettled` loop.
//
// Kept deliberately at the same call shape as the old lib/generation-mock.ts
// (`() => Promise<{kind, url}>`) so the node components' History entry shape
// (lib/node-history.ts) needs no change, and so existing node tests only
// need to swap which function they mock.

import { submitGenerationAction, pollGenerationAction } from "@/app/generation-actions";
import type { PendingGeneration } from "@/lib/fal-generation";
import type { ImagePlaceholderResult, VideoPlaceholderResult } from "./node-history";
import { buildGenerationPayload, type MediaHandleConnection } from "./generation-payload";

export interface RunGenerationInput {
  endpointId: string;
  /** The Resolved Prompt (CONTEXT.md) — never the raw local prompt field alone. */
  prompt: string;
  /** Only sent when the selected Model's schema has `negative_prompt`. */
  negativePrompt?: string;
  /** The node's snapshotted, schema-derived Input Handles (ADR-0007/
   * ADR-0008) paired with their currently-connected source nodes, in edge
   * order (issue #40 / ADR-0009: "generation payloads grow from prompt-only
   * to the node's full wired inputs"). Omitted/empty when the Model has no
   * media handles, or none are wired — those handles are simply absent from
   * the submitted body. */
  media?: MediaHandleConnection[];
}

export type RunImageGenerationInput = RunGenerationInput;
export type RunVideoGenerationInput = RunGenerationInput;

export interface RunGenerationOptions {
  /** Called once FAL returns the pending record, so the caller can persist
   * it into the node's `data` (ADR-0009) before polling begins. */
  onPending?: (pending: PendingGeneration) => void;
  /** Overridable for tests; defaults to a few seconds per ADR-0009. */
  pollIntervalMs?: number;
  /** Injectable wait so tests can avoid real timers. */
  wait?: (ms: number) => Promise<void>;
}

export type RunImageGenerationOptions = RunGenerationOptions;
export type RunVideoGenerationOptions = RunGenerationOptions;

const DEFAULT_POLL_INTERVAL_MS = 3000;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Submits `input` to FAL's queue via the server action (ADR-0009): the body
// is built by the pure lib/generation-payload.ts module from the prompt/
// negative-prompt plus this node's connected media handles (issue #40), and
// any local Asset Library asset it found is forwarded as a localAssetRef so
// the server action can inline it — the third argument is only ever
// non-empty when at least one connected input is a local asset, keeping the
// call shape unchanged for every Model with no media inputs wired.
async function submit(input: RunGenerationInput): Promise<PendingGeneration> {
  const { body, localAssetRefs } = buildGenerationPayload(
    { prompt: input.prompt, negativePrompt: input.negativePrompt },
    input.media ?? [],
  );
  return localAssetRefs.length > 0
    ? submitGenerationAction(input.endpointId, body, localAssetRefs)
    : submitGenerationAction(input.endpointId, body);
}

// The submit-only operation (issue #48 / ADR-0011): submits to the FAL queue
// exactly like a full run would — same payload building, same server action —
// but resolves to the pending-generation record without ever polling. A
// variant submitter uses this for its clones: it writes the record into the
// clone's node data and hands the run to the clone's own resume-on-mount
// machinery (issue #38), which polls it to completion. The submitter never
// polls a clone's run — double-append is the failure mode ADR-0011's
// ownership rule exists to prevent.
export async function submitImageGeneration(
  input: RunImageGenerationInput,
): Promise<PendingGeneration> {
  return submit(input);
}

// Actual Cost (CONTEXT.md / ADR-0009, issue #41): the resolved output plus
// the FAL-reported billable-units count (lib/fal-generation.ts's
// `x-fal-billable-units` header, forwarded verbatim through
// app/generation-actions.ts's pollGenerationAction) — undefined when FAL's
// result carried none. The node component multiplies this by the Model's
// snapshotted unit price (lib/actual-cost.ts) before persisting the History
// entry; this module has no pricing knowledge of its own.
export type ImageGenerationResult = ImagePlaceholderResult & { billableUnits?: number };
export type VideoGenerationResult = VideoPlaceholderResult & { billableUnits?: number };

export async function runImageGeneration(
  input: RunImageGenerationInput,
  options: RunImageGenerationOptions = {},
): Promise<ImageGenerationResult> {
  const pending = await submit(input);
  options.onPending?.(pending);

  return pollUntilSettled(pending, options, "image");
}

// Resumes polling an already-submitted pending record (issue #38 / ADR-0009)
// — typically one restored from a Generation Node's `data.pendingGeneration`
// after a page reload — without submitting a fresh request to FAL (FAL bills
// the run either way; re-submitting would pay for a second one). Shares the
// exact poll-until-settled loop runImageGeneration uses after its own
// submit, so a resumed run behaves identically to one that never reloaded:
// it resolves to the finished output, or throws the same FAL error a fresh
// run would (e.g. a stale record FAL no longer recognizes) rather than
// polling forever.
export async function resumeImageGeneration(
  pending: PendingGeneration,
  options: RunImageGenerationOptions = {},
): Promise<ImageGenerationResult> {
  return pollUntilSettled(pending, options, "image");
}

// The submit-only operation for video variants (issue #49 / ADR-0011):
// mirrors submitImageGeneration exactly — submits to the FAL queue like a
// full run would, then resolves to the pending-generation record without
// ever polling. A video variant submitter uses this for its clones, writing
// the record into each clone's node data and handing the run to that clone's
// own resume-on-mount machinery (issue #39). The submitter never polls a
// clone's run — double-append is the failure mode ADR-0011 exists to prevent.
export async function submitVideoGeneration(
  input: RunVideoGenerationInput,
): Promise<PendingGeneration> {
  return submit(input);
}

// Video Generation Node's real generation (issue #39): identical submit/poll
// mechanics to the image path above — only the resulting placeholder's
// `kind` differs, and FAL's video Models answer with a `video`/`videos`
// result shape (lib/fal-generation.ts's getGenerationResult already covers
// both).
export async function runVideoGeneration(
  input: RunVideoGenerationInput,
  options: RunVideoGenerationOptions = {},
): Promise<VideoGenerationResult> {
  const pending = await submit(input);
  options.onPending?.(pending);

  return pollUntilSettled(pending, options, "video");
}

// Resumes polling an already-submitted video generation after a reload
// (issue #38's treatment, extended to video by issue #39) — mirrors
// resumeImageGeneration exactly, just entered with a video pending record.
export async function resumeVideoGeneration(
  pending: PendingGeneration,
  options: RunVideoGenerationOptions = {},
): Promise<VideoGenerationResult> {
  return pollUntilSettled(pending, options, "video");
}

async function pollUntilSettled<K extends "image" | "video">(
  pending: PendingGeneration,
  options: RunGenerationOptions,
  kind: K,
): Promise<{ kind: K; url: string; billableUnits?: number }> {
  const wait = options.wait ?? defaultWait;
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let outcome = await pollGenerationAction(pending);
  while (outcome.status === "pending") {
    await wait(intervalMs);
    outcome = await pollGenerationAction(pending);
  }

  if (outcome.status === "error") {
    throw new Error(outcome.message);
  }
  return { kind, url: outcome.mediaUrl, billableUnits: outcome.billableUnits };
}
