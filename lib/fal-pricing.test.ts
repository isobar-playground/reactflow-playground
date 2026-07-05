import { describe, it, expect, afterEach } from "vitest";
import { fetchModelPricing, fetchPricingBatch, fetchPricingChunk, formatUnitPrice } from "./fal-pricing";

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

// formatUnitPrice (issue #45, ADR-0010): renders a Model's raw Unit Price
// verbatim, singularizing FAL's plural `unit` field ("seconds" -> "second")
// for display. Absent pricing renders nothing so the catalog card shows no
// price rather than a misleading value.
describe("formatUnitPrice", () => {
  it("renders a per-second price singularized", () => {
    expect(formatUnitPrice({ unitPrice: 0.14, unit: "seconds", currency: "USD" })).toBe(
      "$0.14 / second",
    );
  });

  it("renders a per-megapixel price singularized", () => {
    expect(
      formatUnitPrice({ unitPrice: 0.025, unit: "megapixels", currency: "USD" }),
    ).toBe("$0.025 / megapixel");
  });

  it("renders a per-image price singularized", () => {
    expect(formatUnitPrice({ unitPrice: 0.04, unit: "images", currency: "USD" })).toBe(
      "$0.04 / image",
    );
  });

  it("renders nothing for null or undefined pricing", () => {
    expect(formatUnitPrice(null)).toBeUndefined();
    expect(formatUnitPrice(undefined)).toBeUndefined();
  });
});

// fetchPricingBatch (issue #45 / ADR-0010): FAL's pricing endpoint has no
// bulk mode, caps repeated `endpoint_id` params near ~30/call (100 -> 400),
// and rate-limits bursts hard. This chunks ids into ~30-sized groups, issues
// one request per chunk sequentially (never in parallel), and is
// best-effort: a failing chunk contributes nothing rather than throwing.
describe("fetchPricingBatch", () => {
  it("fetches all requested ids in one request when there are <= 30, returning a Map keyed by endpoint id", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(
        JSON.stringify({
          prices: [
            { endpoint_id: "fal-ai/a", unit_price: 0.1, unit: "images", currency: "USD" },
            { endpoint_id: "fal-ai/b", unit_price: 0.2, unit: "seconds", currency: "USD" },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchPricingBatch(["fal-ai/a", "fal-ai/b"], { fetchImpl });

    expect(calls.length).toBe(1);
    expect(result).toEqual(
      new Map([
        ["fal-ai/a", { unitPrice: 0.1, unit: "images", currency: "USD" }],
        ["fal-ai/b", { unitPrice: 0.2, unit: "seconds", currency: "USD" }],
      ]),
    );
  });

  it("chunks more than 30 ids into multiple sequential requests, each capped near 30", async () => {
    const endpointIds = Array.from({ length: 61 }, (_, i) => `fal-ai/model-${i}`);
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(JSON.stringify({ prices: [] }), { status: 200 }),
    );

    await fetchPricingBatch(endpointIds, { fetchImpl });

    expect(calls.length).toBe(3); // 30 + 30 + 1
    const idsPerCall = calls.map(
      (call) => new URL(call.url).searchParams.getAll("endpoint_id").length,
    );
    expect(idsPerCall).toEqual([30, 30, 1]);
    for (const count of idsPerCall) {
      expect(count).toBeLessThanOrEqual(30);
    }
  });

  it("still resolves the other chunks' entries when one chunk fails (best-effort, no throw)", async () => {
    let callIndex = 0;
    const endpointIds = Array.from({ length: 31 }, (_, i) => `fal-ai/model-${i}`);
    const { fetchImpl } = fakeFetch(() => {
      callIndex++;
      if (callIndex === 1) {
        throw new Error("network error / 429");
      }
      return new Response(
        JSON.stringify({
          prices: [
            { endpoint_id: "fal-ai/model-30", unit_price: 0.5, unit: "images", currency: "USD" },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await fetchPricingBatch(endpointIds, { fetchImpl });

    expect(result.get("fal-ai/model-30")).toEqual({ unitPrice: 0.5, unit: "images", currency: "USD" });
    expect(result.size).toBe(1);
  });
});

// fetchPricingChunk (ADR-0010 revision): the un-chunked primitive behind
// fetchPricingBatch, also used directly by the /models catalog's "load
// prices anyway" button — unlike fetchPricingBatch, it surfaces a 429's
// Retry-After so a deliberate retry loop can wait the right amount.
describe("fetchPricingChunk", () => {
  it("returns resolved prices for a single request", async () => {
    const { fetchImpl } = fakeFetch(() =>
      new Response(
        JSON.stringify({
          prices: [{ endpoint_id: "fal-ai/a", unit_price: 0.1, unit: "images", currency: "USD" }],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchPricingChunk(["fal-ai/a"], { fetchImpl });

    expect(result.prices).toEqual(new Map([["fal-ai/a", { unitPrice: 0.1, unit: "images", currency: "USD" }]]));
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it("surfaces retryAfterSeconds from a 429 response's Retry-After header", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: { "retry-after": "37" },
        }),
    );

    const result = await fetchPricingChunk(["fal-ai/a"], { fetchImpl });

    expect(result.prices.size).toBe(0);
    expect(result.retryAfterSeconds).toBe(37);
  });

  it("leaves retryAfterSeconds undefined on a 429 with no Retry-After header", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({}), { status: 429 }));

    const result = await fetchPricingChunk(["fal-ai/a"], { fetchImpl });

    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it("returns no prices (not a throw) on a network failure", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };

    const result = await fetchPricingChunk(["fal-ai/a"], { fetchImpl });

    expect(result.prices.size).toBe(0);
  });
});
