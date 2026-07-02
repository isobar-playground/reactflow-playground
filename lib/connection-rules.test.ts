import { describe, it, expect } from "vitest";
import { isConnectionAllowed, type ConnectionAttempt, type DataType } from "./connection-rules";

// connection-rules (CONTEXT.md / PRD issue #1): validates a connection
// attempt by data type at connect time. Disallowed edges are rejected;
// References accept no inbound edges; generation outputs may chain into
// further generation nodes.

// Default targetHandles models an Image Generation Node whose selected Model
// snapshotted the same two handles the old static per-node-type map used to
// declare (ADR-0007/0008: handles now come from the Model's schema snapshot,
// not a fixed map) — this keeps the many pre-existing imageGeneration cases
// below meaningful without each needing to restate the snapshot.
const DEFAULT_IMAGE_GENERATION_HANDLES: Record<string, { dataTypes: DataType[]; many: boolean }> = {
  text: { dataTypes: ["text"], many: true },
  image: { dataTypes: ["image"], many: true },
};

function attempt(overrides: Partial<ConnectionAttempt>): ConnectionAttempt {
  const targetType = overrides.targetType ?? "imageGeneration";
  return {
    sourceType: "staticTextReference",
    sourceHandle: null,
    targetType,
    targetId: "gen1",
    targetHandle: "text",
    // Models an Image Generation Node whose selected Model snapshotted the
    // same two handles the old static per-node-type map used to declare
    // (ADR-0007/0008: handles now come from the Model's schema snapshot, not
    // a fixed map) — kept only for imageGeneration so the many pre-existing
    // videoGeneration cases below still exercise the static TARGET_HANDLES
    // fallback (per-instance handles land for video in issue #31).
    targetHandles: targetType === "imageGeneration" ? DEFAULT_IMAGE_GENERATION_HANDLES : undefined,
    existingEdges: [],
    ...overrides,
  };
}

describe("isConnectionAllowed", () => {
  it("allows a Static Text Reference into an Image Generation Node's text handle", () => {
    expect(isConnectionAllowed(attempt({}))).toBe(true);
  });

  it("rejects any connection into a Static Text Reference (references accept no inbound edges)", () => {
    expect(
      isConnectionAllowed(
        attempt({ targetType: "staticTextReference", targetHandle: null }),
      ),
    ).toBe(false);
  });

  it("rejects any connection into a Static Media Reference (references accept no inbound edges)", () => {
    expect(
      isConnectionAllowed(
        attempt({ targetType: "staticMediaReference", targetHandle: null }),
      ),
    ).toBe(false);
  });

  it("rejects a connection into a handle the target node doesn't have", () => {
    expect(
      isConnectionAllowed(attempt({ targetHandle: "not-a-real-handle" })),
    ).toBe(false);
  });

  it("rejects a connection with no target handle when the target has named input handles", () => {
    expect(isConnectionAllowed(attempt({ targetHandle: null }))).toBe(false);
  });

  it("rejects a data type the target handle doesn't accept (e.g. an image source into the text handle)", () => {
    expect(
      isConnectionAllowed(attempt({ sourceType: "imageGeneration", sourceHandle: null })),
    ).toBe(false);
  });

  it("rejects a video source into the text handle (an image-gen source is video, not text)", () => {
    expect(
      isConnectionAllowed(attempt({ sourceType: "videoGeneration", sourceHandle: null })),
    ).toBe(false);
  });

  it("rejects a Static Media Reference with no asset chosen (no concrete data type to check)", () => {
    expect(
      isConnectionAllowed(attempt({ sourceType: "staticMediaReference", sourceHandle: null })),
    ).toBe(false);
  });

  it("rejects a Static Media Reference holding an image into the text handle (its concrete type is image, not text)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
        }),
      ),
    ).toBe(false);
  });

  it("allows a Static Media Reference holding text-typed data into the text handle (per-instance type drives the check, not a fixed per-node-type map)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "text",
        }),
      ),
    ).toBe(true);
  });

  it("allows a Static Media Reference holding an image into the image handle (issue #10: image->image edit input)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetHandle: "image",
        }),
      ),
    ).toBe(true);
  });

  it("rejects any target handle on an Image Generation Node before a Model is selected (no snapshotted handles, no static fallback)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "imageGeneration",
          targetHandle: "image",
          targetHandles: {},
        }),
      ),
    ).toBe(false);
  });

  it("uses the target node's snapshotted handles (ADR-0007/0008) instead of the static per-node-type map when provided", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "imageGeneration",
          targetHandle: "mask_url",
          targetHandles: { mask_url: { dataTypes: ["image"], many: false } },
        }),
      ),
    ).toBe(true);
  });

  it("allows a video source into a Model-declared video handle on an Image Generation Node (ADR-0007: video -> image becomes possible where the Model exposes a video input)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetType: "imageGeneration",
          targetHandle: "video_url",
          targetHandles: { video_url: { dataTypes: ["video"], many: false } },
        }),
      ),
    ).toBe(true);
  });

  it("rejects a handle absent from the target node's snapshotted handles even if the static map would have allowed it", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "imageGeneration",
          targetHandle: "image",
          targetHandles: { image_urls: { dataTypes: ["image"], many: true } },
        }),
      ),
    ).toBe(false);
  });

  it("allows many connections into a Model-declared many-image handle on an Image Generation Node", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "imageGeneration",
          targetHandle: "image_urls",
          targetHandles: { image_urls: { dataTypes: ["image"], many: true } },
          existingEdges: [{ target: "gen1", targetHandle: "image_urls" }],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a second connection into a Model-declared single-image handle on an Image Generation Node", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "imageGeneration",
          targetHandle: "mask_url",
          targetHandles: { mask_url: { dataTypes: ["image"], many: false } },
          existingEdges: [{ target: "gen1", targetHandle: "mask_url" }],
        }),
      ),
    ).toBe(false);
  });

  it("allows an Image Generation Node's output to chain into another Image Generation Node's image handle (edit mode from a generated image)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "imageGeneration",
          sourceHandle: null,
          targetHandle: "image",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a Static Media Reference holding a video into the image handle (video cannot connect into an Image Generation Node)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetHandle: "image",
        }),
      ),
    ).toBe(false);
  });

  it("rejects a Video Generation Node's output into the image handle (video cannot connect into an Image Generation Node)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "videoGeneration",
          sourceHandle: null,
          targetHandle: "image",
        }),
      ),
    ).toBe(false);
  });
});

describe("isConnectionAllowed — Video Generation Node handles (issue #11)", () => {
  it("allows a Static Text Reference into the text handle", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticTextReference",
          sourceHandle: null,
          targetType: "videoGeneration",
          targetHandle: "text",
        }),
      ),
    ).toBe(true);
  });

  it("allows an image into the startFrame handle", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "startFrame",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a second connection into the startFrame handle (accepts exactly one image)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "startFrame",
          existingEdges: [{ target: "gen1", targetHandle: "startFrame" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects a second connection into the endFrame handle (accepts exactly one image)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "endFrame",
          existingEdges: [{ target: "gen1", targetHandle: "endFrame" }],
        }),
      ),
    ).toBe(false);
  });

  it("allows many connections into the imageReference handle", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "imageReference",
          existingEdges: [
            { target: "gen1", targetHandle: "imageReference" },
            { target: "gen1", targetHandle: "imageReference" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("allows a video into the video handle when nothing else is connected", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetType: "videoGeneration",
          targetHandle: "video",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a second connection into the video handle (accepts exactly one video)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetType: "videoGeneration",
          targetHandle: "video",
          existingEdges: [{ target: "gen1", targetHandle: "video" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects connecting a video when a startFrame is already connected (video-exclusivity)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetType: "videoGeneration",
          targetHandle: "video",
          existingEdges: [{ target: "gen1", targetHandle: "startFrame" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects connecting a video when an imageReference is already connected (video-exclusivity)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetType: "videoGeneration",
          targetHandle: "video",
          existingEdges: [{ target: "gen1", targetHandle: "imageReference" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects connecting a startFrame when a video is already connected (video-exclusivity)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "startFrame",
          existingEdges: [{ target: "gen1", targetHandle: "video" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects connecting an endFrame when a video is already connected (video-exclusivity)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "endFrame",
          existingEdges: [{ target: "gen1", targetHandle: "video" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects connecting an imageReference when a video is already connected (video-exclusivity)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "image",
          targetType: "videoGeneration",
          targetHandle: "imageReference",
          existingEdges: [{ target: "gen1", targetHandle: "video" }],
        }),
      ),
    ).toBe(false);
  });

  it("still allows connecting text when a video is already connected", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticTextReference",
          sourceHandle: null,
          targetType: "videoGeneration",
          targetHandle: "text",
          existingEdges: [{ target: "gen1", targetHandle: "video" }],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a video source into an unrelated node's video handle (existingEdges scoped by targetId)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "staticMediaReference",
          sourceHandle: null,
          sourceDataType: "video",
          targetType: "videoGeneration",
          targetId: "gen1",
          targetHandle: "video",
          existingEdges: [{ target: "gen2", targetHandle: "video" }],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a video-gen output (video) into the imageReference handle (only images accepted)", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "videoGeneration",
          sourceHandle: null,
          targetType: "videoGeneration",
          targetHandle: "imageReference",
        }),
      ),
    ).toBe(false);
  });

  it("allows an Image Generation Node's output to chain into the startFrame handle", () => {
    expect(
      isConnectionAllowed(
        attempt({
          sourceType: "imageGeneration",
          sourceHandle: null,
          targetType: "videoGeneration",
          targetHandle: "startFrame",
        }),
      ),
    ).toBe(true);
  });
});
