// Server-only FAL Model Catalog client (ADR-0006). The catalog is read live
// from FAL's `GET /v1/models` and never snapshotted into our DB; the only
// Model state the app owns is the set of approvals (a separate module).
//
// Deep module behind `listModels()`: it fetches once per surfaced category,
// walks the `cursor`/`has_more` pagination, keeps only `status=active`
// models, maps each entry to the `Model` type, and caches the assembled list
// with a ~1h TTL so a rarely-opened settings page doesn't re-paginate all of
// FAL every visit. A test hook resets the cache (as with `resetDbForTests`).

// A FAL inference endpoint a Generation Node can call (CONTEXT.md). Its
// `category` maps 1:1 onto a generation Mode — only these five are surfaced.
export interface Model {
  endpointId: string;
  name: string;
  category: ModelCategory;
  description: string;
  tags: string[];
  thumbnailUrl?: string;
}

// The five categories that map onto a generation Mode. FAL's other categories
// (llm, speech-to-text, training, …) have no node to run them, so they are
// neither fetched nor surfaced (ADR-0006).
export const SURFACED_CATEGORIES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "video-to-video",
] as const;

export type ModelCategory = (typeof SURFACED_CATEGORIES)[number];

// The shape of the fields we read off a FAL `GET /v1/models` entry. FAL
// returns more (license_type, group, kind, model_url, is_favorited, …) which
// we intentionally ignore this step.
interface FalModelEntry {
  endpoint_id: string;
  metadata?: {
    display_name?: string;
    category?: string;
    description?: string;
    // FAL lifecycle status lives inside `metadata` (not top-level).
    status?: string;
    tags?: string[];
    thumbnail_url?: string;
  };
}

interface FalModelsPage {
  models: FalModelEntry[];
  next_cursor?: string | null;
  has_more?: boolean;
}

const FAL_MODELS_URL = "https://api.fal.ai/v1/models";
const PAGE_LIMIT = 100;

export interface ListModelsOptions {
  /** Injectable fetch so tests can serve canned FAL responses. */
  fetchImpl?: typeof fetch;
}

// Rarely-opened settings page + FAL changes slowly, so a ~1h TTL avoids
// re-paginating all five categories on every visit (ADR-0006).
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache: { models: Model[]; expiresAt: number } | undefined;

export async function listModels(options: ListModelsOptions = {}): Promise<Model[]> {
  if (cache && Date.now() < cache.expiresAt) return cache.models;

  const fetchImpl = options.fetchImpl ?? fetch;

  const perCategory = await Promise.all(
    SURFACED_CATEGORIES.map((category) => fetchCategory(category, fetchImpl)),
  );
  const models = perCategory.flat();

  cache = { models, expiresAt: Date.now() + CACHE_TTL_MS };
  return models;
}

/** Test hook: drop the memoised catalog so a test starts from a clean cache. */
export function resetFalModelsForTests(): void {
  cache = undefined;
}

// Walks the cursor pagination for a single category, mapping active entries.
async function fetchCategory(
  category: ModelCategory,
  fetchImpl: typeof fetch,
): Promise<Model[]> {
  const headers: Record<string, string> = {};
  if (process.env.FAL_KEY) {
    headers.Authorization = `Key ${process.env.FAL_KEY}`;
  }

  const models: Model[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL(FAL_MODELS_URL);
    url.searchParams.set("category", category);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetchImpl(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`FAL /v1/models returned ${response.status} for ${category}`);
    }
    const page = (await response.json()) as FalModelsPage;

    for (const entry of page.models ?? []) {
      if (entry.metadata?.status !== "active") continue;
      if (entry.metadata?.category !== category) continue;
      models.push(toModel(entry, category));
    }

    cursor = page.has_more ? (page.next_cursor ?? null) : null;
  } while (cursor);

  return models;
}

function toModel(entry: FalModelEntry, category: ModelCategory): Model {
  return {
    endpointId: entry.endpoint_id,
    name: entry.metadata?.display_name ?? entry.endpoint_id,
    category,
    description: entry.metadata?.description ?? "",
    tags: entry.metadata?.tags ?? [],
    thumbnailUrl: entry.metadata?.thumbnail_url,
  };
}
