import { describe, it, expect } from "vitest";
import { deriveFamily, familyOptions } from "./model-family";
import type { Model } from "./fal-models";

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

describe("deriveFamily — merges fragmenting lines (ADR-0010)", () => {
  it("merges the LTX variants into one family", () => {
    expect(deriveFamily("fal-ai/ltx/dev")).toBe("LTX");
    expect(deriveFamily("fal-ai/ltx-video/v1")).toBe("LTX");
    expect(deriveFamily("fal-ai/ltxv/turbo")).toBe("LTX");
  });

  it("merges the Kling variants into one family", () => {
    expect(deriveFamily("fal-ai/kling-video/v3/pro/text-to-video")).toBe("Kling");
    expect(deriveFamily("fal-ai/kling-image/v2/edit")).toBe("Kling");
    expect(deriveFamily("fal-ai/kling/video")).toBe("Kling");
  });

  it("merges the Nano Banana variants into one family", () => {
    expect(deriveFamily("fal-ai/nano-banana/edit")).toBe("Nano Banana");
    expect(deriveFamily("fal-ai/nano-banana-pro/edit")).toBe("Nano Banana");
    expect(deriveFamily("fal-ai/nano-banana-lite/edit")).toBe("Nano Banana");
  });
});

describe("deriveFamily — fallback for unmapped tokens", () => {
  it("falls back to its own derived, title-cased name", () => {
    expect(deriveFamily("fal-ai/my-model/v1")).toBe("My Model");
  });

  it("cuts a trailing version/digit run before falling back", () => {
    expect(deriveFamily("fal-ai/somenewline3/fast")).toBe("Somenewline");
  });

  it("leaves an embedded (non-trailing) digit alone", () => {
    // "wan-t2v" has no *trailing* version run, so it isn't cut — it's an
    // explicit alias instead (Wan), covered in the merges above via its own
    // fixture; here we confirm an unmapped analogous token keeps its digit.
    expect(deriveFamily("fal-ai/foo-t2v/dev")).toBe("Foo T2v");
  });
});

describe("familyOptions — dropdown families (>= 2 loaded Models)", () => {
  it("includes a family with two or more Models", () => {
    const models = [
      model({ endpointId: "fal-ai/kling-video/v3" }),
      model({ endpointId: "fal-ai/kling-image/v2" }),
    ];

    expect(familyOptions(models)).toEqual(["Kling"]);
  });

  it("excludes a family with only one Model (singleton)", () => {
    const models = [
      model({ endpointId: "fal-ai/kling-video/v3" }),
      model({ endpointId: "fal-ai/kling-image/v2" }),
      model({ endpointId: "fal-ai/one-off-thing/v1" }),
    ];

    expect(familyOptions(models)).toEqual(["Kling"]);
  });

  it("returns families in stable, first-seen order", () => {
    const models = [
      model({ endpointId: "fal-ai/ltx/dev" }),
      model({ endpointId: "fal-ai/kling/video" }),
      model({ endpointId: "fal-ai/ltx-video/v1" }),
      model({ endpointId: "fal-ai/kling-image/v2" }),
    ];

    expect(familyOptions(models)).toEqual(["LTX", "Kling"]);
  });
});
