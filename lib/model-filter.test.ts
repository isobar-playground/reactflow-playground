import { describe, it, expect } from "vitest";
import { filterModels, modelsForKind } from "./model-filter";
import type { Model } from "./fal-models";

// A deliberately blank model so each query test isolates the one field it puts
// content into — no other field can accidentally match the query.
function model(overrides: Partial<Model> = {}): Model {
  return {
    endpointId: "x",
    name: "",
    category: "text-to-image",
    description: "",
    tags: [],
    ...overrides,
  };
}

describe("filterModels — query matching", () => {
  it("matches on name", () => {
    const flux = model({ endpointId: "a", name: "FLUX.1 [dev]" });
    const kling = model({ endpointId: "b", name: "Kling Video" });

    const result = filterModels([flux, kling], { query: "flux" });

    expect(result).toEqual([flux]);
  });

  it("matches on description", () => {
    const hit = model({ endpointId: "a", description: "A photoreal renderer" });
    const miss = model({ endpointId: "b", description: "A cartoon stylizer" });

    const result = filterModels([hit, miss], { query: "photoreal" });

    expect(result).toEqual([hit]);
  });

  it("matches on tags", () => {
    const hit = model({ endpointId: "a", tags: ["cinematic", "hd"] });
    const miss = model({ endpointId: "b", tags: ["sketch"] });

    const result = filterModels([hit, miss], { query: "cinematic" });

    expect(result).toEqual([hit]);
  });

  it("matches on endpoint_id, so a provider query surfaces its models", () => {
    const google = model({ endpointId: "fal-ai/google/veo" });
    const kling = model({ endpointId: "fal-ai/kling/video" });

    expect(filterModels([google, kling], { query: "google" })).toEqual([google]);
    expect(filterModels([google, kling], { query: "kling" })).toEqual([kling]);
  });

  it("matches case-insensitively", () => {
    const hit = model({ endpointId: "a", name: "KLING Video" });

    expect(filterModels([hit], { query: "kling" })).toEqual([hit]);
    expect(filterModels([hit], { query: "KLING" })).toEqual([hit]);
  });

  it("returns all models when the query is empty or whitespace", () => {
    const models = [model({ endpointId: "a" }), model({ endpointId: "b" })];

    expect(filterModels(models, { query: "" })).toEqual(models);
    expect(filterModels(models, { query: "   " })).toEqual(models);
    expect(filterModels(models, {})).toEqual(models);
  });
});

describe("filterModels — category narrowing", () => {
  it("narrows to a single category", () => {
    const image = model({ endpointId: "a", category: "text-to-image" });
    const video = model({ endpointId: "b", category: "text-to-video" });

    expect(filterModels([image, video], { category: "text-to-video" })).toEqual([
      video,
    ]);
  });

  it("treats an 'all' category as no narrowing", () => {
    const image = model({ endpointId: "a", category: "text-to-image" });
    const video = model({ endpointId: "b", category: "text-to-video" });

    expect(filterModels([image, video], { category: "all" })).toEqual([
      image,
      video,
    ]);
  });
});

describe("filterModels — approval narrowing", () => {
  const approved = model({ endpointId: "approved-1" });
  const notApproved = model({ endpointId: "not-approved-1" });
  const models = [approved, notApproved];
  const approvedIds = ["approved-1"];

  it("keeps only approved models when approval is 'approved'", () => {
    expect(
      filterModels(models, { approval: "approved", approvedIds }),
    ).toEqual([approved]);
  });

  it("keeps only not-approved models when approval is 'not-approved'", () => {
    expect(
      filterModels(models, { approval: "not-approved", approvedIds }),
    ).toEqual([notApproved]);
  });

  it("keeps all models when approval is 'all'", () => {
    expect(filterModels(models, { approval: "all", approvedIds })).toEqual(
      models,
    );
  });

  it("treats no approved ids as everything being not-approved", () => {
    expect(filterModels(models, { approval: "approved" })).toEqual([]);
    expect(filterModels(models, { approval: "not-approved" })).toEqual(models);
  });
});

describe("filterModels — sorting", () => {
  const older = model({ endpointId: "old", name: "Beta", addedAt: "2025-01-01T00:00:00Z" });
  const newer = model({ endpointId: "new", name: "Alpha", addedAt: "2026-06-01T00:00:00Z" });

  it("defaults to newest-added first", () => {
    expect(filterModels([older, newer])).toEqual([newer, older]);
  });

  it("sorts oldest-added first when asked", () => {
    expect(filterModels([newer, older], { sort: "oldest" })).toEqual([older, newer]);
  });

  it("sorts by name A–Z when asked", () => {
    expect(filterModels([older, newer], { sort: "name" })).toEqual([newer, older]);
  });

  it("puts models without a date last under 'newest'", () => {
    const dated = model({ endpointId: "dated", addedAt: "2026-01-01T00:00:00Z" });
    const undated = model({ endpointId: "undated" });
    expect(filterModels([undated, dated])).toEqual([dated, undated]);
  });
});

describe("modelsForKind — output-modality grouping (PRD #28 item D)", () => {
  it("keeps only image-output categories for kind 'image'", () => {
    const textToImage = model({ endpointId: "a", category: "text-to-image" });
    const imageToImage = model({ endpointId: "b", category: "image-to-image" });
    const textToVideo = model({ endpointId: "c", category: "text-to-video" });

    expect(modelsForKind([textToImage, imageToImage, textToVideo], "image")).toEqual([
      textToImage,
      imageToImage,
    ]);
  });

  it("keeps only video-output categories for kind 'video'", () => {
    const textToVideo = model({ endpointId: "a", category: "text-to-video" });
    const imageToVideo = model({ endpointId: "b", category: "image-to-video" });
    const videoToVideo = model({ endpointId: "c", category: "video-to-video" });
    const textToImage = model({ endpointId: "d", category: "text-to-image" });

    expect(modelsForKind([textToVideo, imageToVideo, videoToVideo, textToImage], "video")).toEqual([
      textToVideo,
      imageToVideo,
      videoToVideo,
    ]);
  });

  it("returns an empty list when nothing matches the kind", () => {
    const textToVideo = model({ endpointId: "a", category: "text-to-video" });

    expect(modelsForKind([textToVideo], "image")).toEqual([]);
  });
});

describe("filterModels — combinations and empty result", () => {
  it("applies query, category, and approval together", () => {
    const target = model({
      endpointId: "fal-ai/kling/video",
      name: "Kling Video",
      category: "text-to-video",
    });
    const wrongCategory = model({
      endpointId: "fal-ai/kling/image",
      name: "Kling Image",
      category: "text-to-image",
    });
    const wrongQuery = model({
      endpointId: "fal-ai/veo/video",
      name: "Veo Video",
      category: "text-to-video",
    });
    const notApproved = model({
      endpointId: "fal-ai/kling/video-2",
      name: "Kling Video 2",
      category: "text-to-video",
    });

    const result = filterModels(
      [target, wrongCategory, wrongQuery, notApproved],
      {
        query: "kling",
        category: "text-to-video",
        approval: "approved",
        approvedIds: ["fal-ai/kling/video"],
      },
    );

    expect(result).toEqual([target]);
  });

  it("returns an empty list when nothing matches", () => {
    const models = [
      model({ endpointId: "a", name: "FLUX" }),
      model({ endpointId: "b", name: "Kling" }),
    ];

    expect(filterModels(models, { query: "nonexistent" })).toEqual([]);
  });
});
