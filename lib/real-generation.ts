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

import {
  submitGenerationAction,
  pollGenerationAction,
  type PendingGeneration,
} from "@/app/generation-actions";
import type { ImagePlaceholderResult, VideoPlaceholderResult } from "./node-history";

export interface RunGenerationInput {
  endpointId: string;
  /** The Resolved Prompt (CONTEXT.md) — never the raw local prompt field alone. */
  prompt: string;
  /** Only sent when the selected Model's schema has `negative_prompt`. */
  negativePrompt?: string;
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

function buildRequestBody(input: RunGenerationInput): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (input.negativePrompt) {
    body.negative_prompt = input.negativePrompt;
  }
  return body;
}

export async function runImageGeneration(
  input: RunImageGenerationInput,
  options: RunImageGenerationOptions = {},
): Promise<ImagePlaceholderResult> {
  const pending = await submitGenerationAction(input.endpointId, buildRequestBody(input));
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
): Promise<ImagePlaceholderResult> {
  return pollUntilSettled(pending, options, "image");
}

// Video Generation Node's real generation (issue #39): identical submit/poll
// mechanics to the image path above — only the resulting placeholder's
// `kind` differs, and FAL's video Models answer with a `video`/`videos`
// result shape (lib/fal-generation.ts's getGenerationResult already covers
// both).
export async function runVideoGeneration(
  input: RunVideoGenerationInput,
  options: RunVideoGenerationOptions = {},
): Promise<VideoPlaceholderResult> {
  const pending = await submitGenerationAction(input.endpointId, buildRequestBody(input));
  options.onPending?.(pending);

  return pollUntilSettled(pending, options, "video");
}

// Resumes polling an already-submitted video generation after a reload
// (issue #38's treatment, extended to video by issue #39) — mirrors
// resumeImageGeneration exactly, just entered with a video pending record.
export async function resumeVideoGeneration(
  pending: PendingGeneration,
  options: RunVideoGenerationOptions = {},
): Promise<VideoPlaceholderResult> {
  return pollUntilSettled(pending, options, "video");
}

async function pollUntilSettled<K extends "image" | "video">(
  pending: PendingGeneration,
  options: RunGenerationOptions,
  kind: K,
): Promise<{ kind: K; url: string }> {
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
  return { kind, url: outcome.mediaUrl };
}
