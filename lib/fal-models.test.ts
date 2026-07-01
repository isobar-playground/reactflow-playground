import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  listModels,
  resetFalModelsForTests,
  SURFACED_CATEGORIES,
  type Model,
} from "./fal-models";

// A fake FAL entry as returned by GET /v1/models.
function falEntry(
  overrides: { endpoint_id?: string; metadata?: Record<string, unknown> } = {},
) {
  const { metadata, ...rest } = overrides;
  return {
    endpoint_id: "fal-ai/flux/dev",
    ...rest,
    // FAL nests the lifecycle `status` inside `metadata`, not at the top level.
    metadata: {
      display_name: "FLUX.1 [dev]",
      category: "text-to-image",
      status: "active",
      description: "A fast text-to-image model.",
      tags: ["flux", "fast"],
      thumbnail_url: "https://fal.media/flux-dev.png",
      ...metadata,
    },
  };
}

// Builds a fake `fetch` that serves canned responses keyed by the `category`
// query param, with each category optionally spanning several cursor pages.
// Records every request so tests can assert on URLs and headers.
function fakeFetch(
  pagesByCategory: Record<string, Array<{ models: unknown[]; next_cursor: string | null }>>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });

    const category = url.searchParams.get("category") ?? "";
    const cursor = url.searchParams.get("cursor");
    const pages = pagesByCategory[category] ?? [];

    const pageIndex = cursor ? Number(cursor) : 0;
    const page = pages[pageIndex] ?? { models: [], next_cursor: null };

    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: page.models,
        next_cursor: page.next_cursor,
        has_more: page.next_cursor != null,
      }),
    } as Response;
  };

  return { fetchImpl, calls };
}

describe("fal-models catalog client", () => {
  beforeEach(() => {
    delete process.env.FAL_KEY;
    resetFalModelsForTests();
  });

  afterEach(() => {
    resetFalModelsForTests();
  });

  it("maps a FAL entry to the Model type", async () => {
    const { fetchImpl } = fakeFetch({
      "text-to-image": [{ models: [falEntry()], next_cursor: null }],
    });

    const models = await listModels({ fetchImpl });

    const model = models.find((m) => m.endpointId === "fal-ai/flux/dev");
    expect(model).toEqual<Model>({
      endpointId: "fal-ai/flux/dev",
      name: "FLUX.1 [dev]",
      category: "text-to-image",
      description: "A fast text-to-image model.",
      tags: ["flux", "fast"],
      thumbnailUrl: "https://fal.media/flux-dev.png",
    });
  });

  it("walks the full cursor pagination for a category (not just the first page)", async () => {
    const { fetchImpl } = fakeFetch({
      "text-to-image": [
        {
          models: [falEntry({ endpoint_id: "fal-ai/a" })],
          next_cursor: "1",
        },
        {
          models: [falEntry({ endpoint_id: "fal-ai/b" })],
          next_cursor: "2",
        },
        {
          models: [falEntry({ endpoint_id: "fal-ai/c" })],
          next_cursor: null,
        },
      ],
    });

    const models = await listModels({ fetchImpl });

    expect(models.map((m) => m.endpointId)).toEqual([
      "fal-ai/a",
      "fal-ai/b",
      "fal-ai/c",
    ]);
  });

  it("fetches only the five surfaced categories, never non-surfaced ones", async () => {
    const { fetchImpl, calls } = fakeFetch({});

    await listModels({ fetchImpl });

    const requestedCategories = calls.map((call) =>
      new URL(call.url).searchParams.get("category"),
    );
    expect(requestedCategories.sort()).toEqual([...SURFACED_CATEGORIES].sort());
    expect(requestedCategories).not.toContain("llm");
    expect(requestedCategories).not.toContain("speech-to-text");
  });

  it("requests only status=active", async () => {
    const { fetchImpl, calls } = fakeFetch({});

    await listModels({ fetchImpl });

    for (const call of calls) {
      expect(new URL(call.url).searchParams.get("status")).toBe("active");
    }
  });

  it("drops any non-active entry FAL still returns", async () => {
    const { fetchImpl } = fakeFetch({
      "text-to-image": [
        {
          models: [
            falEntry({ endpoint_id: "fal-ai/live" }),
            falEntry({
              endpoint_id: "fal-ai/dead",
              metadata: { status: "deprecated" },
            }),
          ],
          next_cursor: null,
        },
      ],
    });

    const models = await listModels({ fetchImpl });

    const ids = models.map((m) => m.endpointId);
    expect(ids).toContain("fal-ai/live");
    expect(ids).not.toContain("fal-ai/dead");
  });

  it("drops an entry whose metadata.category isn't the surfaced one", async () => {
    const { fetchImpl } = fakeFetch({
      "text-to-image": [
        {
          models: [
            falEntry({ endpoint_id: "fal-ai/t2i" }),
            falEntry({
              endpoint_id: "fal-ai/mislabeled",
              metadata: { display_name: "X", category: "llm" },
            }),
          ],
          next_cursor: null,
        },
      ],
    });

    const models = await listModels({ fetchImpl });

    const ids = models.map((m) => m.endpointId);
    expect(ids).toContain("fal-ai/t2i");
    expect(ids).not.toContain("fal-ai/mislabeled");
  });

  function authHeaderOf(init: RequestInit | undefined): string | undefined {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.Authorization;
  }

  it("sends 'Authorization: Key <FAL_KEY>' when FAL_KEY is set", async () => {
    process.env.FAL_KEY = "secret-key";
    const { fetchImpl, calls } = fakeFetch({});

    await listModels({ fetchImpl });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(authHeaderOf(call.init)).toBe("Key secret-key");
    }
  });

  it("sends no Authorization header when FAL_KEY is unset", async () => {
    delete process.env.FAL_KEY;
    const { fetchImpl, calls } = fakeFetch({});

    await listModels({ fetchImpl });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(authHeaderOf(call.init)).toBeUndefined();
    }
  });

  it("caches the assembled catalog so a repeat visit doesn't re-fetch", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "text-to-image": [{ models: [falEntry()], next_cursor: null }],
    });

    const first = await listModels({ fetchImpl });
    const callsAfterFirst = calls.length;
    const second = await listModels({ fetchImpl });

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(calls.length).toBe(callsAfterFirst); // no new fetches
    expect(second).toEqual(first);
  });

  it("re-fetches after the cache is reset (test hook)", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "text-to-image": [{ models: [falEntry()], next_cursor: null }],
    });

    await listModels({ fetchImpl });
    const callsAfterFirst = calls.length;
    resetFalModelsForTests();
    await listModels({ fetchImpl });

    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
