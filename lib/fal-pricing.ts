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

// FAL's per-call cap on repeated `endpoint_id` params: observed to accept
// ~30-50 but reject 100 with HTTP 400 (ADR-0010). Chunking at 30 stays safely
// under that cap.
const CHUNK_SIZE = 30;

// Throttle between chunks so sequential calls don't still trip FAL's
// aggressive rate limiter (ADR-0010: 20-way parallel singles returned 429 for
// 41/50).
const CHUNK_DELAY_MS = 250;

export interface FetchPricingBatchOptions {
  /** Injectable fetch so tests can serve canned FAL responses. */
  fetchImpl?: typeof fetch;
}

// Batched, throttled, best-effort pricing fetch for the Model Catalog (issue
// #45 / ADR-0010). FAL's pricing endpoint has no bulk mode: this chunks
// `endpointIds` into groups of ~30, issuing one request per chunk with
// repeated `endpoint_id` params, sequentially (never in parallel) with a
// throttle between chunks to survive the rate limiter. A chunk that fails
// (429, outage, non-ok) contributes nothing to the result rather than
// throwing — other chunks' entries still populate the returned Map, so one
// bad chunk never wipes out the rest (mirrors `fetchModelPricing`'s
// never-throw contract, at the batch level).
export async function fetchPricingBatch(
  endpointIds: string[],
  options: FetchPricingBatchOptions = {},
): Promise<Map<string, ModelPricing>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const result = new Map<string, ModelPricing>();

  const headers: Record<string, string> = {};
  if (process.env.FAL_KEY) {
    headers.Authorization = `Key ${process.env.FAL_KEY}`;
  }

  const chunks = chunk(endpointIds, CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(CHUNK_DELAY_MS);

    try {
      const url = new URL(FAL_PRICING_URL);
      for (const endpointId of chunks[i]) {
        url.searchParams.append("endpoint_id", endpointId);
      }

      const response = await fetchImpl(url.toString(), { headers });
      if (!response.ok) continue;

      const data = (await response.json()) as FalPricingResponse;
      for (const entry of data.prices ?? []) {
        result.set(entry.endpoint_id, {
          unitPrice: entry.unit_price,
          unit: entry.unit,
          currency: entry.currency,
        });
      }
    } catch {
      // Best-effort: a failing chunk contributes nothing; other chunks'
      // entries remain in `result`.
    }
  }

  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Renders a Model's raw Unit Price verbatim (CONTEXT.md's Unit Price / issue
// #45): `$0.14 / second`, `$0.025 / megapixel`, `$0.04 / image`. FAL's `unit`
// field is plural ("seconds", "megapixels", "images"); this singularizes it
// for display. Absent pricing renders nothing (`undefined`) so the catalog
// card simply shows no price rather than a misleading value.
export function formatUnitPrice(pricing: ModelPricing | null | undefined): string | undefined {
  if (!pricing) return undefined;
  const unit = pricing.unit.endsWith("s") ? pricing.unit.slice(0, -1) : pricing.unit;
  return `$${pricing.unitPrice} / ${unit}`;
}
