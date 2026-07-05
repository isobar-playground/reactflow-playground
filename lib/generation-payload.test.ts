import { describe, it, expect } from "vitest";
import { buildGenerationPayload, type MediaHandleConnection } from "./generation-payload";
import type { ResolvedHandle } from "./fal-schema";

// generation-payload (issue #40 / ADR-0009, PRD #35): the pure module that
// maps a Generation Node's snapshotted Input Handles + their currently
// connected source nodes into the FAL request body — the payload grows from
// prompt-only (#36) to the node's full wired inputs. Kept framework-agnostic
// (no React Flow imports) like lib/connection-rules.ts and lib/edge-reconcile.ts,
// so it's trivial to unit test and reused by both Generation Node components.

const imageUrlsHandle: ResolvedHandle = {
  handleId: "image_url",
  label: "image_url",
  dataType: "image",
  many: false,
};

describe("buildGenerationPayload", () => {
  it("always includes the prompt, with no media handles wired", () => {
    const { body } = buildGenerationPayload({ prompt: "a red car" }, []);

    expect(body).toEqual({ prompt: "a red car" });
  });

  it("includes negative_prompt only when given", () => {
    const withNegative = buildGenerationPayload(
      { prompt: "a red car", negativePrompt: "blurry" },
      [],
    );
    expect(withNegative.body).toEqual({ prompt: "a red car", negative_prompt: "blurry" });

    const withoutNegative = buildGenerationPayload({ prompt: "a red car" }, []);
    expect(withoutNegative.body).toEqual({ prompt: "a red car" });
  });

  it("resolves a single handle's connected Static Media Reference to its asset URL, marked local", () => {
    const connections: MediaHandleConnection[] = [
      {
        handle: imageUrlsHandle,
        sources: [
          { type: "staticMediaReference", data: { asset: { url: "/uploads/cat.png", type: "image" } } },
        ],
      },
    ];

    const { body, localAssetRefs } = buildGenerationPayload({ prompt: "a red car" }, connections);

    expect(body).toEqual({ prompt: "a red car", image_url: "/uploads/cat.png" });
    expect(localAssetRefs).toEqual([{ handleId: "image_url", url: "/uploads/cat.png" }]);
  });

  it("omits a handle with no connected source entirely (no client-side required-field duplication)", () => {
    const connections: MediaHandleConnection[] = [{ handle: imageUrlsHandle, sources: [] }];

    const { body, localAssetRefs } = buildGenerationPayload({ prompt: "a red car" }, connections);

    expect(body).toEqual({ prompt: "a red car" });
    expect(localAssetRefs).toEqual([]);
  });

  it("passes an upstream Generation Node's Active Output through as its fal.media URL, untouched", () => {
    const connections: MediaHandleConnection[] = [
      {
        handle: imageUrlsHandle,
        sources: [
          {
            type: "imageGeneration",
            data: {
              history: {
                entries: [{ id: "e1", prompt: "p", output: { kind: "image", url: "https://fal.media/out.png" } }],
                activeId: "e1",
              },
            },
          },
        ],
      },
    ];

    const { body, localAssetRefs } = buildGenerationPayload({ prompt: "a red car" }, connections);

    expect(body).toEqual({ prompt: "a red car", image_url: "https://fal.media/out.png" });
    expect(localAssetRefs).toEqual([]);
  });

  it("sends a `many` handle's connections as an array, in edge order, marking only the local ones for inlining", () => {
    const manyHandle: ResolvedHandle = {
      handleId: "image_urls",
      label: "image_urls",
      dataType: "image",
      many: true,
    };
    const connections: MediaHandleConnection[] = [
      {
        handle: manyHandle,
        sources: [
          {
            type: "imageGeneration",
            data: {
              history: {
                entries: [{ id: "e1", prompt: "p", output: { kind: "image", url: "https://fal.media/first.png" } }],
                activeId: "e1",
              },
            },
          },
          { type: "staticMediaReference", data: { asset: { url: "/uploads/second.png", type: "image" } } },
        ],
      },
    ];

    const { body, localAssetRefs } = buildGenerationPayload({ prompt: "a red car" }, connections);

    expect(body).toEqual({
      prompt: "a red car",
      image_urls: ["https://fal.media/first.png", "/uploads/second.png"],
    });
    expect(localAssetRefs).toEqual([{ handleId: "image_urls", index: 1, url: "/uploads/second.png" }]);
  });

  it("ignores a Static Media Reference source with no asset chosen yet, same as unconnected", () => {
    const connections: MediaHandleConnection[] = [
      { handle: imageUrlsHandle, sources: [{ type: "staticMediaReference", data: { asset: null } }] },
    ];

    const { body, localAssetRefs } = buildGenerationPayload({ prompt: "a red car" }, connections);

    expect(body).toEqual({ prompt: "a red car" });
    expect(localAssetRefs).toEqual([]);
  });
});
