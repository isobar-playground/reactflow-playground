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
});
