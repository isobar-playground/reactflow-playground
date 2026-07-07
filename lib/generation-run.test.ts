import { describe, it, expect } from "vitest";
import { resolveNextRun, primaryImageHandle, type NextRunBaseModel } from "./generation-run";
import { appendEntry, setActiveEntry, type NodeHistory } from "./node-history";
import type { ResolvedHandle } from "./fal-schema";
import type { MediaHandleConnection } from "./generation-payload";

const emptyHistory: NodeHistory = { entries: [], activeId: null };

function withEntry(id: string, history: NodeHistory = emptyHistory): NodeHistory {
  return appendEntry(history, {
    id,
    prompt: "a cat",
    output: { kind: "image", url: `https://picsum.photos/seed/${id}/768/768` },
  });
}

const promptHandle: ResolvedHandle = { handleId: "text", label: "text", dataType: "text", many: true };
const imageUrlHandle: ResolvedHandle = { handleId: "image_url", label: "image_url", dataType: "image", many: false };
const imageUrlsHandle: ResolvedHandle = { handleId: "image_urls", label: "image_urls", dataType: "image", many: true };

const externalMedia: MediaHandleConnection[] = [
  { handle: imageUrlHandle, sources: [{ type: "staticMediaReference", data: { asset: { url: "https://x/y.png" } } }] },
];

describe("primaryImageHandle", () => {
  it("returns the first image-typed handle in schema order", () => {
    expect(primaryImageHandle([promptHandle, imageUrlHandle, imageUrlsHandle])).toEqual(imageUrlHandle);
  });

  it("returns undefined when no handle is image-typed", () => {
    expect(primaryImageHandle([promptHandle])).toBeUndefined();
  });

  it("returns undefined for an empty handle list", () => {
    expect(primaryImageHandle([])).toBeUndefined();
  });
});

describe("resolveNextRun — empty History (first generation)", () => {
  const base: NextRunBaseModel = {
    endpointId: "fal-ai/flux/dev",
    category: "text-to-image",
    handles: [imageUrlHandle],
    editModel: null,
  };

  it("runs the base Model with the external connections", () => {
    const result = resolveNextRun({ history: emptyHistory, base, externalMedia });

    expect(result).toEqual({
      mode: "generate",
      endpointId: "fal-ai/flux/dev",
      media: externalMedia,
      priceModel: "base",
    });
  });

  it("also generates for an image-to-image base on its first run (composition)", () => {
    const imgToImgBase: NextRunBaseModel = {
      endpointId: "fal-ai/some/compose",
      category: "image-to-image",
      handles: [imageUrlHandle],
      editModel: null,
    };

    const result = resolveNextRun({ history: emptyHistory, base: imgToImgBase, externalMedia });

    expect(result.mode).toBe("generate");
    expect(result.endpointId).toBe("fal-ai/some/compose");
    expect(result.media).toBe(externalMedia);
  });
});

describe("resolveNextRun — non-empty History (Edit), text-to-image base", () => {
  const base: NextRunBaseModel = {
    endpointId: "fal-ai/flux/dev",
    category: "text-to-image",
    handles: [imageUrlHandle],
    editModel: {
      endpointId: "fal-ai/nano-banana/edit",
      primaryImageHandleId: "image_url",
      hasNegativePrompt: false,
      pricing: { unitPrice: 0.05, unit: "images", currency: "usd" },
    },
  };
  const history = withEntry("h1");

  it("runs the paired Edit Model instead of the base Model", () => {
    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.mode).toBe("edit");
    expect(result.endpointId).toBe("fal-ai/nano-banana/edit");
    expect(result.priceModel).toBe("edit");
  });

  it("drops external connections — only the self-input feeds an Edit", () => {
    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.media).toHaveLength(1);
  });

  it("feeds the node's own Active Output into the Edit Model's primary image handle", () => {
    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.media[0].handle.handleId).toBe("image_url");
    expect(result.media[0].sources).toEqual([{ type: "imageGeneration", data: { history } }]);
  });
});

describe("resolveNextRun — non-empty History (Edit), image-to-image base", () => {
  const base: NextRunBaseModel = {
    endpointId: "fal-ai/some/compose",
    category: "image-to-image",
    handles: [imageUrlHandle],
    editModel: null,
  };
  const history = withEntry("h1");

  it("edits with its own model — no separate Edit Model needed", () => {
    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.mode).toBe("edit");
    expect(result.endpointId).toBe("fal-ai/some/compose");
    expect(result.priceModel).toBe("base");
  });

  it("feeds the self-input on its own primary image handle", () => {
    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.media).toEqual([
      { handle: imageUrlHandle, sources: [{ type: "imageGeneration", data: { history } }] },
    ]);
  });

  it("drops the external connections on the edit", () => {
    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.media).toHaveLength(1);
  });
});

describe("resolveNextRun — editing from a non-newest History entry", () => {
  it("still resolves an edit using whichever History object it is handed", () => {
    let history = withEntry("h1");
    history = withEntry("h2", history);
    history = setActiveEntry(history, "h1");
    const base: NextRunBaseModel = {
      endpointId: "fal-ai/some/compose",
      category: "image-to-image",
      handles: [imageUrlHandle],
      editModel: null,
    };

    const result = resolveNextRun({ history, base, externalMedia });

    expect(result.mode).toBe("edit");
    expect(result.media[0].sources[0]).toEqual({ type: "imageGeneration", data: { history } });
  });
});
