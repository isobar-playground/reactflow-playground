import { describe, it, expect, afterEach } from "vitest";
import {
  submitGeneration,
  getGenerationStatus,
  getGenerationResult,
  inlineLocalAssets,
} from "./fal-generation";

// fal-generation (ADR-0009): the server-only queue-API wrapper. Tested with
// an injectable fetch serving canned FAL responses — prior art:
// lib/fal-models.test.ts and lib/fal-schema.test.ts.

function fakeFetch(handler: (input: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

describe("submitGeneration", () => {
  afterEach(() => {
    delete process.env.FAL_KEY;
  });

  it("posts the input to queue.fal.run/{endpointId} and returns the request id and URLs verbatim", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(
        JSON.stringify({
          request_id: "req-1",
          status_url: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
          response_url: "https://queue.fal.run/fal-ai/flux/requests/req-1",
        }),
        { status: 200 },
      ),
    );

    const result = await submitGeneration(
      "fal-ai/flux/schnell",
      { prompt: "a red car" },
      { fetchImpl },
    );

    expect(calls[0].url).toBe("https://queue.fal.run/fal-ai/flux/schnell");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ prompt: "a red car" });
    // The returned status_url/response_url live under the *parent* app
    // (fal-ai/flux, not fal-ai/flux/schnell) — used verbatim, never
    // reconstructed (ADR-0009).
    expect(result).toEqual({
      requestId: "req-1",
      statusUrl: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
      responseUrl: "https://queue.fal.run/fal-ai/flux/requests/req-1",
    });
  });

  it("sends the FAL_KEY as an Authorization: Key header when set", async () => {
    process.env.FAL_KEY = "test-key-123";
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(
        JSON.stringify({ request_id: "r", status_url: "s", response_url: "u" }),
        { status: 200 },
      ),
    );

    await submitGeneration("fal-ai/flux/schnell", { prompt: "x" }, { fetchImpl });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key test-key-123");
  });

  it("throws when FAL returns a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("bad request", { status: 422 }));

    await expect(
      submitGeneration("fal-ai/flux/schnell", { prompt: "x" }, { fetchImpl }),
    ).rejects.toThrow(/422/);
  });
});

describe("getGenerationStatus", () => {
  it("fetches the given status_url verbatim and returns the queue status", async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      expect(url).toBe("https://queue.fal.run/fal-ai/flux/requests/req-1/status");
      return new Response(JSON.stringify({ status: "IN_PROGRESS" }), { status: 200 });
    });

    const result = await getGenerationStatus(
      "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
      { fetchImpl },
    );

    expect(result).toEqual({ status: "IN_PROGRESS" });
    expect(calls).toHaveLength(1);
  });

  it("throws when the status endpoint returns a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("gone", { status: 404 }));

    await expect(
      getGenerationStatus("https://queue.fal.run/x/status", { fetchImpl }),
    ).rejects.toThrow(/404/);
  });
});

describe("getGenerationResult", () => {
  it("extracts the first image URL from an `images` array result", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(
        JSON.stringify({ images: [{ url: "https://fal.media/a.png" }, { url: "https://fal.media/b.png" }] }),
        { status: 200 },
      ),
    );

    const result = await getGenerationResult("https://queue.fal.run/x", { fetchImpl });

    expect(result).toEqual({ mediaUrl: "https://fal.media/a.png" });
  });

  it("extracts the image URL from a single `image` object result", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(JSON.stringify({ image: { url: "https://fal.media/solo.png" } }), { status: 200 }),
    );

    const result = await getGenerationResult("https://queue.fal.run/x", { fetchImpl });

    expect(result).toEqual({ mediaUrl: "https://fal.media/solo.png" });
  });

  // Video Generation Node results (issue #39): FAL's video models answer
  // with a single `video: {url}` object rather than an `images` array.
  it("extracts the video URL from a single `video` object result", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(JSON.stringify({ video: { url: "https://fal.media/clip.mp4" } }), { status: 200 }),
    );

    const result = await getGenerationResult("https://queue.fal.run/x", { fetchImpl });

    expect(result).toEqual({ mediaUrl: "https://fal.media/clip.mp4" });
  });

  it("extracts the first video URL from a `videos` array result", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(
        JSON.stringify({ videos: [{ url: "https://fal.media/clip-a.mp4" }, { url: "https://fal.media/clip-b.mp4" }] }),
        { status: 200 },
      ),
    );

    const result = await getGenerationResult("https://queue.fal.run/x", { fetchImpl });

    expect(result).toEqual({ mediaUrl: "https://fal.media/clip-a.mp4" });
  });

  it("throws when the result has no recognizable media URL", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({}), { status: 200 }));

    await expect(getGenerationResult("https://queue.fal.run/x", { fetchImpl })).rejects.toThrow(
      /no media url/i,
    );
  });

  it("throws when the result endpoint returns a non-2xx response (a FAL failure)", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(JSON.stringify({ detail: "moderation blocked" }), { status: 500 }),
    );

    await expect(getGenerationResult("https://queue.fal.run/x", { fetchImpl })).rejects.toThrow(/500/);
  });
});

// inlineLocalAssets (issue #40 / ADR-0009): assets from the local Asset
// Library aren't URLs FAL can fetch, so the submit path fetches their bytes
// itself and swaps in a base64 data URI — tested with an injectable fetch
// serving canned bytes, same pattern as the rest of this module.
describe("inlineLocalAssets", () => {
  it("replaces a single-value field's URL with a base64 data URI fetched from it", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    );

    const result = await inlineLocalAssets(
      { prompt: "a cat", image_url: "/uploads/cat.png" },
      [{ handleId: "image_url", url: "/uploads/cat.png" }],
      { fetchImpl },
    );

    expect(result).toEqual({
      prompt: "a cat",
      image_url: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
    });
  });

  it("returns the body untouched when there are no local asset refs (no fetch call)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    const result = await inlineLocalAssets({ prompt: "a cat" }, [], { fetchImpl });

    expect(result).toEqual({ prompt: "a cat" });
    expect(calls).toHaveLength(0);
  });

  it("inlines only the referenced index of a `many` field's array, leaving other entries (e.g. fal.media passthroughs) untouched", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );

    const result = await inlineLocalAssets(
      { prompt: "a cat", image_urls: ["https://fal.media/first.png", "/uploads/second.png"] },
      [{ handleId: "image_urls", index: 1, url: "/uploads/second.png" }],
      { fetchImpl },
    );

    expect(result).toEqual({
      prompt: "a cat",
      image_urls: [
        "https://fal.media/first.png",
        `data:image/jpeg;base64,${Buffer.from([9]).toString("base64")}`,
      ],
    });
  });

  it("resolves a relative URL through the given resolveUrl before fetching", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png" } }),
    );

    await inlineLocalAssets(
      { prompt: "a cat", image_url: "/uploads/cat.png" },
      [{ handleId: "image_url", url: "/uploads/cat.png" }],
      { fetchImpl, resolveUrl: (url) => `http://localhost:3000${url}` },
    );

    expect(calls[0].url).toBe("http://localhost:3000/uploads/cat.png");
  });

  it("throws when fetching the local asset fails", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("nope", { status: 404 }));

    await expect(
      inlineLocalAssets(
        { prompt: "a cat", image_url: "/uploads/missing.png" },
        [{ handleId: "image_url", url: "/uploads/missing.png" }],
        { fetchImpl },
      ),
    ).rejects.toThrow(/404/);
  });
});
