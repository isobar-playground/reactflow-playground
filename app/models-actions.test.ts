import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getDb, migrate, resetDbForTests } from "@/lib/db";
import { resetFalModelsForTests } from "@/lib/fal-models";
import * as falSchema from "@/lib/fal-schema";
import * as falPricing from "@/lib/fal-pricing";

// Server actions call revalidatePath, which throws outside a real Next.js
// request context — stub it the same way app/library-actions.test.ts does.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// A fake FAL /v1/models entry, matching lib/fal-models.test.ts's shape.
function falEntry(endpointId: string, category: string, displayName: string) {
  return {
    endpoint_id: endpointId,
    metadata: {
      display_name: displayName,
      category,
      status: "active",
      description: "",
      tags: [],
      date: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("models-actions — approvedModelsForKind", () => {
  beforeEach(async () => {
    delete process.env.DATABASE_URL; // force the local (PGlite) branch
    process.env.PGLITE_DIR = "memory://"; // ephemeral per test run
    resetDbForTests();
    await migrate(await getDb());
    resetFalModelsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns only approved models whose category matches the requested kind", async () => {
    const flux = falEntry("fal-ai/flux/dev", "text-to-image", "FLUX.1 [dev]");
    const editModel = falEntry("fal-ai/edit/model", "image-to-image", "Edit Model");
    const klingVideo = falEntry("fal-ai/kling/video", "text-to-video", "Kling Video");
    const unapprovedFlux = falEntry("fal-ai/unapproved/flux", "text-to-image", "Unapproved Flux");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const category = url.searchParams.get("category");
        const byCategory: Record<string, unknown[]> = {
          "text-to-image": [flux, unapprovedFlux],
          "image-to-image": [editModel],
          "text-to-video": [klingVideo],
          "image-to-video": [],
          "video-to-video": [],
        };
        return new Response(
          JSON.stringify({ models: byCategory[category ?? ""] ?? [], has_more: false }),
          { status: 200 },
        );
      }),
    );

    const { approveModelAction, setEditPairAction } = await import("./models-actions");
    await approveModelAction("fal-ai/flux/dev");
    await approveModelAction("fal-ai/edit/model");
    await approveModelAction("fal-ai/kling/video");
    // A text-to-image base needs a paired Edit Model to be selectable
    // (CONTEXT.md's Edit Model, ADR-0014) — paired here so this test can
    // stay focused on category narrowing; the pairing gate itself is
    // covered by the next test.
    await setEditPairAction("fal-ai/flux/dev", "fal-ai/edit/model");

    const { approvedModelsForKind } = await import("./models-actions");
    const result = await approvedModelsForKind("image");

    expect(result.map((m) => m.endpointId).sort()).toEqual([
      "fal-ai/edit/model",
      "fal-ai/flux/dev",
    ]);
  });

  it("excludes an approved text-to-image Model with no paired Edit Model (CONTEXT.md's Edit Model / ADR-0014)", async () => {
    const flux = falEntry("fal-ai/flux/dev", "text-to-image", "FLUX.1 [dev]");
    const editModel = falEntry("fal-ai/edit/model", "image-to-image", "Edit Model");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const category = url.searchParams.get("category");
        const byCategory: Record<string, unknown[]> = {
          "text-to-image": [flux],
          "image-to-image": [editModel],
          "text-to-video": [],
          "image-to-video": [],
          "video-to-video": [],
        };
        return new Response(
          JSON.stringify({ models: byCategory[category ?? ""] ?? [], has_more: false }),
          { status: 200 },
        );
      }),
    );

    const { approveModelAction } = await import("./models-actions");
    // Both approved, but flux is never paired — it can generate but never
    // edit, so the picker must not offer it as a base.
    await approveModelAction("fal-ai/flux/dev");
    await approveModelAction("fal-ai/edit/model");

    const { approvedModelsForKind } = await import("./models-actions");
    const result = await approvedModelsForKind("image");

    expect(result.map((m) => m.endpointId)).toEqual(["fal-ai/edit/model"]);
  });

  it("returns an empty list when FAL is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { approvedModelsForKind } = await import("./models-actions");
    const result = await approvedModelsForKind("image");

    expect(result).toEqual([]);
  });
});

// fetchModelSchemaAction (issue #37 / ADR-0009): Model selection now also
// snapshots the Model's pricing entry alongside the schema-derived handles —
// fetched in the same server action, since the schema fetch already needs to
// run server-side (FAL's openapi.json has no CORS either).
describe("models-actions — fetchModelSchemaAction pricing snapshot (issue #37)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes the Model's pricing entry alongside the derived handles", async () => {
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue({
      unitPrice: 0.003,
      unit: "megapixels",
      currency: "USD",
    });

    const { fetchModelSchemaAction } = await import("./models-actions");
    const result = await fetchModelSchemaAction("fal-ai/flux/schnell");

    expect(result.pricing).toEqual({ unitPrice: 0.003, unit: "megapixels", currency: "USD" });
  });

  it("includes null pricing when the Model has no resolvable pricing entry", async () => {
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);

    const { fetchModelSchemaAction } = await import("./models-actions");
    const result = await fetchModelSchemaAction("fal-ai/does-not-exist");

    expect(result.pricing).toBeNull();
  });
});

// fetchModelSchemaAction's Edit Model snapshot (CONTEXT.md's Edit Model,
// ADR-0014, PRD #69): when the selected endpoint has a configured pairing,
// the paired Edit Model's own schema/pricing is resolved and snapshotted
// alongside — so a text-to-image base's first Edit never needs a live
// fetch (extends ADR-0008's snapshot-at-selection stance).
describe("models-actions — fetchModelSchemaAction Edit Model snapshot (ADR-0014)", () => {
  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DIR = "memory://";
    resetDbForTests();
    await migrate(await getDb());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves and snapshots the paired Edit Model when one is configured", async () => {
    const { setEditPairAction, fetchModelSchemaAction } = await import("./models-actions");
    await setEditPairAction("fal-ai/flux/dev", "fal-ai/nano-banana/edit");

    vi.spyOn(falSchema, "fetchModelInputSchema").mockImplementation(async (endpointId: string) =>
      endpointId === "fal-ai/nano-banana/edit"
        ? {
            paths: {
              "/fal-ai/nano-banana/edit": {
                post: {
                  requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } },
                },
              },
            },
            components: { schemas: { Input: { properties: { image_url: { type: "string" } } } } },
          }
        : { paths: {}, components: {} },
    );
    vi.spyOn(falPricing, "fetchModelPricing").mockImplementation(async (endpointId: string) =>
      endpointId === "fal-ai/nano-banana/edit"
        ? { unitPrice: 0.05, unit: "images", currency: "USD" }
        : null,
    );

    const result = await fetchModelSchemaAction("fal-ai/flux/dev");

    expect(result.editModel).toEqual({
      endpointId: "fal-ai/nano-banana/edit",
      primaryImageHandleId: "image_url",
      hasNegativePrompt: false,
      pricing: { unitPrice: 0.05, unit: "images", currency: "USD" },
    });
  });

  it("resolves editModel to null when the endpoint has no configured pairing", async () => {
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);

    const { fetchModelSchemaAction } = await import("./models-actions");
    const result = await fetchModelSchemaAction("fal-ai/unpaired/model");

    expect(result.editModel).toBeNull();
  });
});

// fetchCatalogPricingAction (ADR-0010 revision): the /models catalog's lazy,
// per-visible-set pricing fetch — a thin server action over
// fal-pricing.ts's already-throttled fetchPricingBatch, since that endpoint
// needs FAL_KEY and isn't reachable from the browser.
describe("models-actions — fetchCatalogPricingAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a plain object keyed by endpoint id for resolved prices", async () => {
    vi.spyOn(falPricing, "fetchPricingBatch").mockResolvedValue(
      new Map([
        ["fal-ai/flux/dev", { unitPrice: 0.04, unit: "images", currency: "USD" }],
      ]),
    );

    const { fetchCatalogPricingAction } = await import("./models-actions");
    const result = await fetchCatalogPricingAction(["fal-ai/flux/dev", "fal-ai/unresolved"]);

    expect(result).toEqual({
      "fal-ai/flux/dev": { unitPrice: 0.04, unit: "images", currency: "USD" },
    });
  });
});

// fetchCatalogPricingChunkAction (ADR-0010 revision): backs the /models
// catalog's "load prices anyway" button — a thin server action over
// fal-pricing.ts's fetchPricingChunk, surfacing Retry-After for a
// deliberate, user-triggered retry loop.
describe("models-actions — fetchCatalogPricingChunkAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a plain object of resolved prices with no retryAfterSeconds on success", async () => {
    vi.spyOn(falPricing, "fetchPricingChunk").mockResolvedValue({
      prices: new Map([["fal-ai/flux/dev", { unitPrice: 0.04, unit: "images", currency: "USD" }]]),
    });

    const { fetchCatalogPricingChunkAction } = await import("./models-actions");
    const result = await fetchCatalogPricingChunkAction(["fal-ai/flux/dev"]);

    expect(result).toEqual({
      prices: { "fal-ai/flux/dev": { unitPrice: 0.04, unit: "images", currency: "USD" } },
    });
  });

  it("forwards retryAfterSeconds when the chunk was rate-limited", async () => {
    vi.spyOn(falPricing, "fetchPricingChunk").mockResolvedValue({
      prices: new Map(),
      retryAfterSeconds: 37,
    });

    const { fetchCatalogPricingChunkAction } = await import("./models-actions");
    const result = await fetchCatalogPricingChunkAction(["fal-ai/flux/dev"]);

    expect(result).toEqual({ prices: {}, retryAfterSeconds: 37 });
  });
});
