// fal-pricing (ADR-0009 / issue #37): server-only client for FAL's
// `GET /v1/models/pricing`, fetched once at Model selection alongside the
// input schema (lib/fal-schema.ts) and snapshotted into the node's data
// (extends ADR-0008). Mirrors lib/fal-models.ts's injectable-fetch pattern.
//
// The endpoint returns a `prices` *array* — observed entries have one
// element, but the shape allows more — so this takes the entry matching the
// requested `endpoint_id` rather than assuming index 0.

export interface ModelPricing {
  unitPrice: number;
  unit: string;
  currency: string;
}

interface FalPriceEntry {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
}

interface FalPricingResponse {
  prices?: FalPriceEntry[];
}

const FAL_PRICING_URL = "https://api.fal.ai/v1/models/pricing";

export interface FetchModelPricingOptions {
  /** Injectable fetch so tests can serve canned FAL responses. */
  fetchImpl?: typeof fetch;
}

// Fetches one endpoint's pricing entry. A Model without a resolvable
// pricing entry (not found, unreachable, or simply absent from the
// response) returns `null` rather than throwing — per CONTEXT.md's
// Estimated Price, a Model with no pricing just shows no estimate; it must
// never break Model selection.
export async function fetchModelPricing(
  endpointId: string,
  options: FetchModelPricingOptions = {},
): Promise<ModelPricing | null> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {};
  if (process.env.FAL_KEY) {
    headers.Authorization = `Key ${process.env.FAL_KEY}`;
  }

  const url = new URL(FAL_PRICING_URL);
  url.searchParams.set("endpoint_id", endpointId);

  try {
    const response = await fetchImpl(url.toString(), { headers });
    if (!response.ok) return null;

    const data = (await response.json()) as FalPricingResponse;
    const entry = (data.prices ?? []).find((price) => price.endpoint_id === endpointId);
    if (!entry) return null;

    return { unitPrice: entry.unit_price, unit: entry.unit, currency: entry.currency };
  } catch {
    return null;
  }
}
