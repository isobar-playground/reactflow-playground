import { describe, it, expect, afterEach, vi } from "vitest";

// generation-actions (ADR-0009): thin server actions over lib/fal-generation.
// Tested by stubbing the global fetch, the same way app/models-actions.test.ts
// exercises fetchModelSchemaAction — these actions take no fetchImpl param
// themselves (server actions must stay plain-data in/out).

describe("submitGenerationAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the pending generation record from FAL's submit response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            request_id: "req-1",
            status_url: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
            response_url: "https://queue.fal.run/fal-ai/flux/requests/req-1",
          }),
          { status: 200 },
        ),
      ),
    );

    const { submitGenerationAction } = await import("./generation-actions");
    const result = await submitGenerationAction("fal-ai/flux/schnell", { prompt: "a cat" });

    expect(result).toEqual({
      requestId: "req-1",
      statusUrl: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
      responseUrl: "https://queue.fal.run/fal-ai/flux/requests/req-1",
    });
  });

  // Connected media inputs (issue #40 / ADR-0009): a local Asset Library
  // asset isn't a URL FAL can fetch, so the submit action inlines it as a
  // base64 data URI (lib/fal-generation.ts's inlineLocalAssets) before
  // submitting — proven here by asserting on the body FAL's queue endpoint
  // actually received.
  it("inlines a local asset ref into a base64 data URI before submitting to FAL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/uploads/cat.png")) {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response(
          JSON.stringify({
            request_id: "req-1",
            status_url: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
            response_url: "https://queue.fal.run/fal-ai/flux/requests/req-1",
          }),
          { status: 200 },
        );
      }),
    );

    const { submitGenerationAction } = await import("./generation-actions");
    await submitGenerationAction(
      "fal-ai/flux/schnell",
      { prompt: "a cat", image_url: "/uploads/cat.png" },
      [{ handleId: "image_url", url: "/uploads/cat.png" }],
    );

    const submitCall = calls.find((call) => call.url === "https://queue.fal.run/fal-ai/flux/schnell");
    const submittedBody = JSON.parse(String(submitCall?.init?.body));
    expect(submittedBody.image_url).toBe(
      `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
    );
  });

  it("submits the body verbatim when no local asset refs are given (existing behavior unchanged)", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({ request_id: "req-1", status_url: "s", response_url: "u" }),
          { status: 200 },
        );
      }),
    );

    const { submitGenerationAction } = await import("./generation-actions");
    await submitGenerationAction("fal-ai/flux/schnell", {
      prompt: "a cat",
      image_url: "https://fal.media/upstream.png",
    });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      prompt: "a cat",
      image_url: "https://fal.media/upstream.png",
    });
  });
});

describe("pollGenerationAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
    responseUrl: "https://queue.fal.run/fal-ai/flux/requests/req-1",
  };

  it("reports pending while the queue status is IN_QUEUE or IN_PROGRESS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "IN_PROGRESS" }), { status: 200 })),
    );

    const { pollGenerationAction } = await import("./generation-actions");
    const result = await pollGenerationAction(pending);

    expect(result).toEqual({ status: "pending" });
  });

  it("fetches the result and reports completed with the image URL once COMPLETED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
        }
        return new Response(JSON.stringify({ images: [{ url: "https://fal.media/out.png" }] }), {
          status: 200,
        });
      }),
    );

    const { pollGenerationAction } = await import("./generation-actions");
    const result = await pollGenerationAction(pending);

    expect(result).toEqual({ status: "completed", mediaUrl: "https://fal.media/out.png" });
  });

  // Video Generation Node results (issue #39): FAL's video models answer
  // with a single `video: {url}` object rather than an `images` array; the
  // server action reports the same generic `mediaUrl` field either way.
  it("fetches the result and reports completed with the video URL once COMPLETED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
        }
        return new Response(JSON.stringify({ video: { url: "https://fal.media/clip.mp4" } }), {
          status: 200,
        });
      }),
    );

    const { pollGenerationAction } = await import("./generation-actions");
    const result = await pollGenerationAction(pending);

    expect(result).toEqual({ status: "completed", mediaUrl: "https://fal.media/clip.mp4" });
  });

  it("reports an error instead of throwing when FAL's status call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const { pollGenerationAction } = await import("./generation-actions");
    const result = await pollGenerationAction(pending);

    expect(result.status).toBe("error");
    expect((result as { message: string }).message).toMatch(/500/);
  });

  // Actual Cost (CONTEXT.md / ADR-0009, issue #41): the billable-units count
  // (lib/fal-generation.ts's x-fal-billable-units header) rides along on the
  // "completed" result so the caller can multiply it by the Model's
  // snapshotted unit price.
  it("forwards billableUnits on the completed result when FAL reports it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
        }
        return new Response(JSON.stringify({ images: [{ url: "https://fal.media/out.png" }] }), {
          status: 200,
          headers: { "x-fal-billable-units": "3" },
        });
      }),
    );

    const { pollGenerationAction } = await import("./generation-actions");
    const result = await pollGenerationAction(pending);

    expect(result).toEqual({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
      billableUnits: 3,
    });
  });

  it("reports an error instead of throwing when the completed result has no image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    const { pollGenerationAction } = await import("./generation-actions");
    const result = await pollGenerationAction(pending);

    expect(result.status).toBe("error");
  });
});
