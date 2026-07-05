// real-generation (ADR-0009): the Image Generation Node's one call to go
// from a Model + prompt to a finished output — submits via the queue-API
// server action, then polls the status server action every few seconds
// until FAL reports COMPLETED (or a failure), and extracts the image URL.
//
// Kept deliberately at the same call shape as the old lib/generation-mock.ts
// (`() => Promise<{kind: "image", url}>`) so the node component's History
// entry shape (lib/node-history.ts) needs no change, and so existing node
// tests only need to swap which function they mock.

import {
  submitGenerationAction,
  pollGenerationAction,
  type PendingGeneration,
} from "@/app/generation-actions";
import type { ImagePlaceholderResult } from "./generation-mock";

export interface RunImageGenerationInput {
  endpointId: string;
  /** The Resolved Prompt (CONTEXT.md) — never the raw local prompt field alone. */
  prompt: string;
  /** Only sent when the selected Model's schema has `negative_prompt`. */
  negativePrompt?: string;
}

export interface RunImageGenerationOptions {
  /** Called once FAL returns the pending record, so the caller can persist
   * it into the node's `data` (ADR-0009) before polling begins. */
  onPending?: (pending: PendingGeneration) => void;
  /** Overridable for tests; defaults to a few seconds per ADR-0009. */
  pollIntervalMs?: number;
  /** Injectable wait so tests can avoid real timers. */
  wait?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runImageGeneration(
  input: RunImageGenerationInput,
  options: RunImageGenerationOptions = {},
): Promise<ImagePlaceholderResult> {
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (input.negativePrompt) {
    body.negative_prompt = input.negativePrompt;
  }

  const pending = await submitGenerationAction(input.endpointId, body);
  options.onPending?.(pending);

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
  return { kind: "image", url: outcome.imageUrl };
}
