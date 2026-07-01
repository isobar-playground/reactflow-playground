import { describe, it, expect } from "vitest";
import { isConnectionAllowed, type ConnectionAttempt } from "./connection-rules";

// connection-rules (CONTEXT.md / PRD issue #1): validates a connection
// attempt by data type at connect time. Disallowed edges are rejected;
// References accept no inbound edges; generation outputs may chain into
// further generation nodes.

function attempt(overrides: Partial<ConnectionAttempt>): ConnectionAttempt {
  return {
    sourceType: "staticTextReference",
    sourceHandle: null,
    targetType: "imageGeneration",
    targetId: "gen1",
    targetHandle: "text",
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
