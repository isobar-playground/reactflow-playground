import type { ModelCategory } from "./fal-models";
import type { ModelPricing } from "./fal-pricing";
import type { ResolvedHandle } from "./fal-schema";
import type { MediaHandleConnection } from "./generation-payload";
import type { NodeHistory } from "./node-history";

// generation-run (PRD #69, ADR-0013/ADR-0014): a Generation Node's Edit
// lifecycle in one pure decision — an Image Generation Node's first run
// generates from its inputs, every later run is an Edit of its own previous
// Active Output. Pure/framework-agnostic like lib/generation-payload.ts, so
// it's trivial to unit test and shared by the node component's Generate,
// Variant, and resume-on-mount paths alike.

// The Model's schema field name (verbatim, per lib/fal-schema.ts) that will
// receive the self-input, plus enough of the paired Edit Model to run it —
// snapshotted at Model-selection time (extends ADR-0008), never re-derived
// live. `null`/`undefined` when the base Model is text-to-image with no
// configured pairing (CONTEXT.md: such a Model can't be selected as a base
// at all, so this should never actually resolve to an edit in that state).
export interface EditModelSnapshot {
  endpointId: string;
  primaryImageHandleId: string;
  hasNegativePrompt: boolean;
  pricing?: ModelPricing | null;
}

// The subset of a Generation Node's selected (base) Model this module needs
// to decide the next run — mirrors components/nodes/image-generation-node.tsx's
// SelectedModel without importing it (framework-agnostic).
export interface NextRunBaseModel {
  endpointId: string;
  category: ModelCategory;
  handles: ResolvedHandle[];
  editModel?: EditModelSnapshot | null;
}

/** Which Model's unit price the Estimated Price should read (CONTEXT.md's
 * Estimated Price): "base" before the first output exists, or when an
 * image-to-image base edits with itself; "edit" once a text-to-image base
 * hands off to its paired Edit Model. */
export type PriceModel = "base" | "edit";

export interface NextRun {
  mode: "generate" | "edit";
  endpointId: string;
  /** The connections to submit as this run's media inputs — the node's
   * external connections on a first generation, or a single self-input
   * connection carrying the node's own History on an Edit (CONTEXT.md:
   * "external inputs feed only the first generation; they are not re-fed on
   * an Edit"). */
  media: MediaHandleConnection[];
  priceModel: PriceModel;
}

export interface ResolveNextRunInput {
  history: NodeHistory;
  base: NextRunBaseModel;
  /** The node's currently-wired external connections (References or
   * upstream nodes) — used only for a first generation. */
  externalMedia: MediaHandleConnection[];
}

// The Model-declared handle an Edit's self-input feeds (CONTEXT.md's Edit
// Model): the first image-typed handle in schema order, so a Model whose
// schema declares `image_url` before `mask_url` (or similar) always gets the
// base image on the field it expects.
export function primaryImageHandle(handles: ResolvedHandle[]): ResolvedHandle | undefined {
  return handles.find((handle) => handle.dataType === "image");
}

// The Edit's self-input (CONTEXT.md's Edit / PRD #69): expressed as a
// MediaHandleConnection whose source is the node itself, carrying its own
// History — lib/generation-payload.ts's buildGenerationPayload already knows
// how to resolve an `imageGeneration` source via getActiveEntry, so no
// change is needed there.
function selfInputConnection(handle: ResolvedHandle, history: NodeHistory): MediaHandleConnection {
  return {
    handle,
    sources: [{ type: "imageGeneration", data: { history } }],
  };
}

// Resolves a Generation Node's next run (PRD #69's `resolveNextRun`): empty
// History means there's no output yet to edit, so the node generates from
// its base Model + external inputs exactly as before. Once History has an
// entry, every further run is an Edit of the node's own previous Active
// Output — an image-to-image base edits with itself; a text-to-image base
// hands off to its paired Edit Model (CONTEXT.md's Edit Model / ADR-0014).
export function resolveNextRun(input: ResolveNextRunInput): NextRun {
  const { history, base, externalMedia } = input;

  if (history.entries.length === 0) {
    return { mode: "generate", endpointId: base.endpointId, media: externalMedia, priceModel: "base" };
  }

  if (base.category === "image-to-image") {
    const handle = primaryImageHandle(base.handles);
    return {
      mode: "edit",
      endpointId: base.endpointId,
      media: handle ? [selfInputConnection(handle, history)] : [],
      priceModel: "base",
    };
  }

  if (!base.editModel) {
    // No paired Edit Model (shouldn't happen — CONTEXT.md: an unpaired
    // text-to-image Model can't be selected as a base). Degrade to an edit
    // with no media rather than throwing, so a stale snapshot never crashes
    // the node.
    return { mode: "edit", endpointId: base.endpointId, media: [], priceModel: "base" };
  }

  const handle: ResolvedHandle = {
    handleId: base.editModel.primaryImageHandleId,
    label: base.editModel.primaryImageHandleId,
    dataType: "image",
    many: false,
  };
  return {
    mode: "edit",
    endpointId: base.editModel.endpointId,
    media: [selfInputConnection(handle, history)],
    priceModel: "edit",
  };
}
