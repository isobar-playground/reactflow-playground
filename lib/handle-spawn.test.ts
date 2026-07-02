import { describe, it, expect } from "vitest";
import { resolveSpawnCandidates, type SpawnAttempt } from "./handle-spawn";

// handle-spawn (CONTEXT.md / PRD issue #17): given a connection drag that
// ended on empty canvas rather than on a handle, resolves which node types
// (and, for multi-handle targets, which specific handle) would form a valid
// connection at the dragged handle — mirroring connection-rules.test.ts's
// table-driven style.

describe("resolveSpawnCandidates", () => {
  it("yields both Generation Node types (handle deferred) when dragging a text-typed source handle", () => {
    const attempt: SpawnAttempt = {
      direction: "source",
      dataType: "text",
    };

    expect(resolveSpawnCandidates(attempt)).toEqual([
      { nodeType: "imageGeneration", handleId: null },
      { nodeType: "videoGeneration", handleId: null },
    ]);
  });

  it("yields staticMediaReference and imageGeneration when dragging an image-typed target handle", () => {
    const attempt: SpawnAttempt = {
      direction: "target",
      dataType: "image",
    };

    expect(resolveSpawnCandidates(attempt)).toEqual([
      { nodeType: "staticMediaReference", handleId: null },
      { nodeType: "imageGeneration", handleId: null },
    ]);
  });

  // issue #34 / ADR-0007: a Generation Node's Input Handles are unknown
  // until a Model is selected, so it can't be excluded or handle-pinned at
  // spawn time by a static per-node-type map the way it used to be —
  // handle-spawn candidacy is now output-kind agnostic (any image/video/text
  // drag offers both Generation Node types), and the actual target handle is
  // resolved later, once a Model is picked (firstCompatibleHandle,
  // lib/edge-reconcile.ts), via the deferred-edge flow the picker triggers.
  it("offers both Generation Node types for a video-typed source drag, with the handle deferred to Model selection", () => {
    const attempt: SpawnAttempt = {
      direction: "source",
      dataType: "video",
    };

    const candidates = resolveSpawnCandidates(attempt);

    expect(candidates).toContainEqual({ nodeType: "imageGeneration", handleId: null });
    expect(candidates).toContainEqual({ nodeType: "videoGeneration", handleId: null });
  });

  // Unlike the source-side (target-candidate) case above, a "target" drag
  // asks which node types could *supply* dataType as their output — that's
  // still a fixed, known property per node type (an Image Generation Node's
  // output is always image), so it's unaffected by issue #34: only
  // videoGeneration can source a video-typed target handle.
  it("a video-typed target drag still only offers videoGeneration as a source (output modality is fixed, not schema-derived)", () => {
    const attempt: SpawnAttempt = {
      direction: "target",
      dataType: "video",
    };

    const candidates = resolveSpawnCandidates(attempt);

    expect(candidates.some((c) => c.nodeType === "imageGeneration")).toBe(false);
    expect(candidates.some((c) => c.nodeType === "videoGeneration")).toBe(true);
  });
});
