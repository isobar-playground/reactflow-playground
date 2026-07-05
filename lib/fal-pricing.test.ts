import { describe, it, expect, afterEach } from "vitest";
import { fetchModelPricing } from "./fal-pricing";

// fal-pricing (ADR-0009 / issue #37): server-only client for FAL's
// `GET /v1/models/pricing`, mirroring lib/fal-models.ts's injectable-fetch
// pattern. The response is a `prices` array; only the entry matching the
// requested `endpoint_id` is returned, mapped to {unitPrice, unit, currency}.

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

describe("fetchModelPricing", () => {
  afterEach(() => {
    delete process.env.FAL_KEY;
  });

  it("fetches the pricing endpoint with endpoint_id and returns the matching entry", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(
        JSON.stringify({
          prices: [{ endpoint_id: "fal-ai/flux/schnell", unit_price: 0.003, unit: "megapixels", currency: "USD" }],
          next_cursor: null,
          has_more: false,
        }),
        { status: 200 },
      ),
    );

    const pricing = await fetchModelPricing("fal-ai/flux/schnell", { fetchImpl });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get("endpoint_id")).toBe("fal-ai/flux/schnell");
    expect(pricing).toEqual({ unitPrice: 0.003, unit: "megapixels", currency: "USD" });
  });

  it("returns null when the response's prices array has no entry for the requested endpoint", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(
        JSON.stringify({
          prices: [{ endpoint_id: "fal-ai/some-other-model", unit_price: 1, unit: "images", currency: "USD" }],
        }),
        { status: 200 },
      ),
    );

    const pricing = await fetchModelPricing("fal-ai/flux/schnell", { fetchImpl });

    expect(pricing).toBeNull();
  });

  it("returns null (not a throw) when FAL returns a non-ok response, e.g. an unrecognized endpoint", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(JSON.stringify({ error: { message: "Endpoint(s) not found" } }), { status: 404 }),
    );

    const pricing = await fetchModelPricing("fal-ai/does-not-exist", { fetchImpl });

    expect(pricing).toBeNull();
  });

  it("sends 'Authorization: Key <FAL_KEY>' when FAL_KEY is set", async () => {
    process.env.FAL_KEY = "secret-key";
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ prices: [] }), { status: 200 }));

    await fetchModelPricing("fal-ai/flux/schnell", { fetchImpl });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key secret-key");
  });

  it("sends no Authorization header when FAL_KEY is unset", async () => {
    delete process.env.FAL_KEY;
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ prices: [] }), { status: 200 }));

    await fetchModelPricing("fal-ai/flux/schnell", { fetchImpl });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
