import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getDb, migrate, resetDbForTests } from "@/lib/db";
import { resetFalModelsForTests } from "@/lib/fal-models";

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

    const { approveModelAction } = await import("./models-actions");
    await approveModelAction("fal-ai/flux/dev");
    await approveModelAction("fal-ai/edit/model");
    await approveModelAction("fal-ai/kling/video");

    const { approvedModelsForKind } = await import("./models-actions");
    const result = await approvedModelsForKind("image");

    expect(result.map((m) => m.endpointId).sort()).toEqual([
      "fal-ai/edit/model",
      "fal-ai/flux/dev",
    ]);
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
