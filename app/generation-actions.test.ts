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

    expect(result).toEqual({ status: "completed", imageUrl: "https://fal.media/out.png" });
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
