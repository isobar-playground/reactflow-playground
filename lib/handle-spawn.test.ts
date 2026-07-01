import { describe, it, expect } from "vitest";
import { resolveSpawnCandidates, type SpawnAttempt } from "./handle-spawn";

// handle-spawn (CONTEXT.md / PRD issue #17): given a connection drag that
// ended on empty canvas rather than on a handle, resolves which node types
// (and, for multi-handle targets, which specific handle) would form a valid
// connection at the dragged handle — mirroring connection-rules.test.ts's
// table-driven style.

describe("resolveSpawnCandidates", () => {
  it("yields both Generation Node types with their text handle when dragging a text-typed source handle", () => {
    const attempt: SpawnAttempt = {
      direction: "source",
      dataType: "text",
    };

    expect(resolveSpawnCandidates(attempt)).toEqual([
      { nodeType: "imageGeneration", handleId: "text" },
      { nodeType: "videoGeneration", handleId: "text" },
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

  it("yields videoGeneration with startFrame specifically when dragging an output that produces image (first declared match)", () => {
    const attempt: SpawnAttempt = {
      direction: "source",
      dataType: "image",
    };

    const candidates = resolveSpawnCandidates(attempt);
    const videoGenCandidate = candidates.find((c) => c.nodeType === "videoGeneration");

    expect(videoGenCandidate).toEqual({ nodeType: "videoGeneration", handleId: "startFrame" });
  });

  it("a video-typed handle never yields imageGeneration (no video->image)", () => {
    const attempt: SpawnAttempt = {
      direction: "target",
      dataType: "video",
    };

    const candidates = resolveSpawnCandidates(attempt);

    expect(candidates.some((c) => c.nodeType === "imageGeneration")).toBe(false);
  });

  it("dragging Video Generation Node's startFrame/endFrame/imageReference (all image-accepting) each yield the same source-side candidates", () => {
    const attempt: SpawnAttempt = {
      direction: "target",
      dataType: "image",
    };

    const candidates = resolveSpawnCandidates(attempt);

    expect(candidates).toEqual([
      { nodeType: "staticMediaReference", handleId: null },
      { nodeType: "imageGeneration", handleId: null },
    ]);
  });
});
