import { describe, it, expect } from "vitest";
import { deriveInputHandles, fetchModelInputSchema } from "./fal-schema";
import fluxSchnellSchema from "./__fixtures__/flux-schnell.json";
import nanoBanana2EditSchema from "./__fixtures__/nano-banana-2-edit.json";
import gptImage2EditSchema from "./__fixtures__/gpt-image-2-edit.json";
import klingImageToVideoSchema from "./__fixtures__/kling-v3-pro-image-to-video.json";

// fal-schema (ADR-0007 / ADR-0008 / issue #30): derives a Generation Node's
// Input Handles from a Model's real FAL input schema (`expand=openapi-3.0`).
// Fixtures are real OpenAPI documents fetched from FAL's public
// `/api/openapi/queue/openapi.json?endpoint_id=...` for the three models the
// issue names as unit-test fixtures.

describe("deriveInputHandles", () => {
  it("maps nano-banana-2/edit's image_urls array to a many-image handle labelled by the field name", () => {
    const { handles } = deriveInputHandles(nanoBanana2EditSchema, "fal-ai/nano-banana-2/edit");

    const imageUrls = handles.find((h) => h.handleId === "image_urls");
    expect(imageUrls).toEqual({
      handleId: "image_urls",
      label: "image_urls",
      dataType: "image",
      many: true,
    });
  });

  // ADR-0007's key example: an image-output model can legitimately expose a
  // video input, giving an Image Generation Node a video-typed handle (which
  // in turn makes video -> image possible at connection time — validated
  // separately in connection-rules).
  it("maps nano-banana-2/edit's video_url to a single video-typed handle", () => {
    const { handles } = deriveInputHandles(nanoBanana2EditSchema, "fal-ai/nano-banana-2/edit");

    const videoUrl = handles.find((h) => h.handleId === "video_url");
    expect(videoUrl).toEqual({
      handleId: "video_url",
      label: "video_url",
      dataType: "video",
      many: false,
    });
  });

  it("gives nano-banana-2/edit no handle for its audio_url or pdf_url inputs (unsupported media)", () => {
    const { handles } = deriveInputHandles(nanoBanana2EditSchema, "fal-ai/nano-banana-2/edit");

    expect(handles.find((h) => h.handleId === "audio_url")).toBeUndefined();
    expect(handles.find((h) => h.handleId === "pdf_url")).toBeUndefined();
  });

  it("gives nano-banana-2/edit no handle for scalar params (seed, resolution, num_images, …)", () => {
    const { handles } = deriveInputHandles(nanoBanana2EditSchema, "fal-ai/nano-banana-2/edit");
    const handleIds = handles.map((h) => h.handleId);

    expect(handleIds).not.toContain("seed");
    expect(handleIds).not.toContain("resolution");
    expect(handleIds).not.toContain("num_images");
    expect(handleIds).not.toContain("safety_tolerance");
  });

  it("gives nano-banana-2/edit no handle for its prompt field (prompt stays the node's local field, not a handle)", () => {
    const { handles } = deriveInputHandles(nanoBanana2EditSchema, "fal-ai/nano-banana-2/edit");

    expect(handles.find((h) => h.handleId === "prompt")).toBeUndefined();
  });

  it("maps gpt-image-2/edit's mask_url to a single image-typed handle", () => {
    const { handles } = deriveInputHandles(gptImage2EditSchema, "openai/gpt-image-2/edit");

    expect(handles.find((h) => h.handleId === "mask_url")).toEqual({
      handleId: "mask_url",
      label: "mask_url",
      dataType: "image",
      many: false,
    });
  });

  it("maps gpt-image-2/edit's image_urls to a many-image handle alongside mask_url", () => {
    const { handles } = deriveInputHandles(gptImage2EditSchema, "openai/gpt-image-2/edit");
    const handleIds = handles.map((h) => h.handleId).sort();

    expect(handleIds).toEqual(["image_urls", "mask_url"]);
  });

  it("gives flux/schnell (text-to-image, no media inputs) no handles at all", () => {
    const { handles } = deriveInputHandles(fluxSchnellSchema, "fal-ai/flux/schnell");

    expect(handles).toEqual([]);
  });
});

// hasNegativePrompt (issue #32 / ADR-0007): a model's schema may expose a
// `negative_prompt` field. It is never a handle (it's not a `*_url` field);
// its presence is reported so the node can show it as a config field.
describe("deriveInputHandles hasNegativePrompt", () => {
  it("reports hasNegativePrompt: true for a model whose schema has a negative_prompt field", () => {
    const result = deriveInputHandles(
      klingImageToVideoSchema,
      "fal-ai/kling-video/v3/pro/image-to-video",
    );

    expect(result.hasNegativePrompt).toBe(true);
  });

  it("gives negative_prompt no handle of its own", () => {
    const result = deriveInputHandles(
      klingImageToVideoSchema,
      "fal-ai/kling-video/v3/pro/image-to-video",
    );

    expect(result.handles.find((h) => h.handleId === "negative_prompt")).toBeUndefined();
  });

  it("reports hasNegativePrompt: false for a model whose schema has no negative_prompt field", () => {
    const result = deriveInputHandles(nanoBanana2EditSchema, "fal-ai/nano-banana-2/edit");

    expect(result.hasNegativePrompt).toBe(false);
  });
});

// defaultDurationSeconds (issue #37 / ADR-0009): the Estimated Price for a
// per-second-priced Model naively assumes the schema's *default* duration,
// so this must be extracted alongside the handles. FAL represents it as a
// string-enum property (kling's `duration`: type "string", default "5") —
// not a bare number — so the value is coerced to a number of seconds.
describe("deriveInputHandles defaultDurationSeconds", () => {
  it("extracts the default duration (in seconds) from a video model's duration field", () => {
    const result = deriveInputHandles(
      klingImageToVideoSchema,
      "fal-ai/kling-video/v3/pro/image-to-video",
    );

    expect(result.defaultDurationSeconds).toBe(5);
  });

  it("is undefined for a model whose schema has no duration field", () => {
    const result = deriveInputHandles(fluxSchnellSchema, "fal-ai/flux/schnell");

    expect(result.defaultDurationSeconds).toBeUndefined();
  });
});

// fetchModelInputSchema (ADR-0008): fetches that ONE endpoint's schema —
// lazy, at Model selection only, distinct from the live, un-expanded
// catalog fetch in lib/fal-models.ts.
describe("fetchModelInputSchema", () => {
  it("fetches the single endpoint's OpenAPI document with expand=openapi-3.0", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => fluxSchnellSchema,
      } as Response;
    };

    const schema = await fetchModelInputSchema("fal-ai/flux/schnell", { fetchImpl });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.searchParams.get("endpoint_id")).toBe("fal-ai/flux/schnell");
    expect(schema).toEqual(fluxSchnellSchema);
  });

  it("throws when FAL returns a non-ok response", async () => {
    const fetchImpl: typeof fetch = async () =>
      ({ ok: false, status: 404 }) as Response;

    await expect(fetchModelInputSchema("fal-ai/does/not-exist", { fetchImpl })).rejects.toThrow();
  });
});
