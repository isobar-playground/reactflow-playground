// fal-generation (ADR-0009): server-only module wrapping FAL's queue API
// (`queue.fal.run`) with plain `fetch` — no new dependency. All `FAL_KEY`
// usage lives here, server-side only; the client never sees it.
//
// Three calls mirror the queue API's own submit / status / result shape:
// `submitGeneration` posts the request body and returns the `request_id`
// plus the `status_url`/`response_url` verbatim (ADR-0009: they may live
// under a parent app, e.g. `fal-ai/flux/schnell` answers under
// `fal-ai/flux` — never reconstructed by hand). `getGenerationStatus` polls
// the returned `status_url`. `getGenerationResult` fetches the returned
// `response_url` once complete and extracts the first image URL across
// FAL's result shapes (`images: [{url}]` or a single `image: {url}`).

const FAL_QUEUE_BASE_URL = "https://queue.fal.run";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.FAL_KEY) {
    headers.Authorization = `Key ${process.env.FAL_KEY}`;
  }
  return headers;
}

export interface FalFetchOptions {
  /** Injectable fetch so tests can serve canned FAL responses. */
  fetchImpl?: typeof fetch;
}

// The pending-generation record (ADR-0009 / CONTEXT.md): persisted verbatim
// into the node's `data` so a reload can resume polling (issue #38 wires the
// resumption itself — this module only ever returns/consumes the record).
export interface PendingGeneration {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

interface FalSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

export async function submitGeneration(
  endpointId: string,
  input: Record<string, unknown>,
  options: FalFetchOptions = {},
): Promise<PendingGeneration> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(`${FAL_QUEUE_BASE_URL}/${endpointId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`FAL queue submit returned ${response.status} for ${endpointId}`);
  }
  const data = (await response.json()) as FalSubmitResponse;
  return {
    requestId: data.request_id,
    statusUrl: data.status_url,
    responseUrl: data.response_url,
  };
}

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export interface GenerationStatusResult {
  status: FalQueueStatus;
}

interface FalStatusResponse {
  status: FalQueueStatus;
}

// Polls the queue's own `status_url` (used verbatim — never reconstructed,
// per ADR-0009).
export async function getGenerationStatus(
  statusUrl: string,
  options: FalFetchOptions = {},
): Promise<GenerationStatusResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(statusUrl, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`FAL queue status returned ${response.status}`);
  }
  const data = (await response.json()) as FalStatusResponse;
  return { status: data.status };
}

export interface GenerationOutputResult {
  mediaUrl: string;
}

// FAL's result shapes vary by model and by output modality (issue #39: the
// Image and Video Generation Nodes share this one extraction function, per
// ADR-0009's "one transport for both node kinds"): an array of images
// (`images: [{url}, ...]`, most text-to-image/image-to-image models), a
// single `image: {url}` object, a single `video: {url}` object (most
// text-to-video/image-to-video models), or a `videos: [{url}, ...]` array.
// Only the first asset is taken (CONTEXT.md's Generate: scalar params like
// `num_images` stay unsurfaced, so the first returned asset is what the node
// keeps).
function extractMediaUrl(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;

  const images = record.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0] as Record<string, unknown> | undefined;
    if (first && typeof first.url === "string") return first.url;
  }

  const image = record.image;
  if (image && typeof image === "object" && typeof (image as Record<string, unknown>).url === "string") {
    return (image as Record<string, unknown>).url as string;
  }

  const video = record.video;
  if (video && typeof video === "object" && typeof (video as Record<string, unknown>).url === "string") {
    return (video as Record<string, unknown>).url as string;
  }

  const videos = record.videos;
  if (Array.isArray(videos) && videos.length > 0) {
    const first = videos[0] as Record<string, unknown> | undefined;
    if (first && typeof first.url === "string") return first.url;
  }

  return undefined;
}

// A media field resolved to a local Asset Library asset (ADR-0005 — see
// lib/generation-payload.ts, which produces these): its URL isn't reachable
// by FAL, so it needs replacing with a base64 data URI before submission.
export interface LocalAssetRef {
  handleId: string;
  /** Index into the array value, for a `many` handle; absent for a single
   * value. */
  index?: number;
  url: string;
}

export interface InlineAssetsOptions extends FalFetchOptions {
  /** Resolves a possibly-relative asset URL (e.g. the local-filesystem Asset
   * Library backend's `/uploads/...` paths, ADR-0005) to one `fetch` can
   * reach from the server. An already-absolute URL (the Blob backend, or
   * any fal.media passthrough — which never reaches this function anyway,
   * per lib/generation-payload.ts's local-vs-remote marking) is used as-is
   * when this is omitted. */
  resolveUrl?: (url: string) => string;
}

// Issue #40 / ADR-0009: "the submit server action inlines them as base64
// data URIs before submitting." Fetches each local asset's raw bytes and
// swaps its URL for a `data:` URI in a shallow copy of `body` — `body`
// itself is never mutated. Only the local Asset Library ever reaches this
// path; an upstream Generation Node's Active Output is already a public
// fal.media URL and is never included in `localAssetRefs` (see
// lib/generation-payload.ts's buildGenerationPayload).
export async function inlineLocalAssets(
  body: Record<string, unknown>,
  localAssetRefs: LocalAssetRef[],
  options: InlineAssetsOptions = {},
): Promise<Record<string, unknown>> {
  if (localAssetRefs.length === 0) return body;

  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveUrl = options.resolveUrl ?? ((url: string) => url);
  const next = { ...body };

  await Promise.all(
    localAssetRefs.map(async (ref) => {
      const response = await fetchImpl(resolveUrl(ref.url));
      if (!response.ok) {
        throw new Error(`Failed to fetch local asset for inlining (${response.status}): ${ref.url}`);
      }
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const buffer = Buffer.from(await response.arrayBuffer());
      const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;

      if (ref.index !== undefined) {
        const values = [...(next[ref.handleId] as string[])];
        values[ref.index] = dataUri;
        next[ref.handleId] = values;
      } else {
        next[ref.handleId] = dataUri;
      }
    }),
  );

  return next;
}

// Fetches the queue's own `response_url` (used verbatim, per ADR-0009) once
// status is COMPLETED, and extracts the first generated asset's URL —
// image or video, whichever the Model's output shape contains.
export async function getGenerationResult(
  responseUrl: string,
  options: FalFetchOptions = {},
): Promise<GenerationOutputResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(responseUrl, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`FAL queue result returned ${response.status}`);
  }
  const data = await response.json();
  const mediaUrl = extractMediaUrl(data);
  if (!mediaUrl) {
    throw new Error("FAL result contained no media URL");
  }
  return { mediaUrl };
}
