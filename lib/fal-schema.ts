import type { DataType } from "./connection-rules";

// fal-schema (ADR-0007 / ADR-0008 / issue #30): derives a Generation Node's
// Input Handles from a single Model's real FAL input schema, fetched lazily
// (only at Model selection, via `expand=openapi-3.0`) and then snapshotted
// into the node's data — never re-derived live on load.
//
// FAL exposes no machine flag marking a property as a connectable
// reference, so this is a heuristic over the schema's field names (ADR-0007):
// a `*_url` / `*_urls` suffix marks a media/text reference input; the field
// name further decides its DataType (video vs image); array ⇒ many,
// singular ⇒ one; label = the schema field name verbatim. Scalar params
// (guidance, steps, seed, num_images, …), unsupported media (audio, pdf),
// and nested objects are all skipped.

export interface ResolvedHandle {
  handleId: string;
  label: string;
  dataType: DataType;
  many: boolean;
}

const URL_SUFFIX = /^(.*)_urls?$/;

// Field-name fragments that mark a media reference as a type this app
// doesn't model (ADR-0007): these get no handle at all, even though they
// match the `*_url`/`*_urls` shape.
const UNSUPPORTED_FRAGMENTS = ["audio", "pdf"];

function classifyDataType(fieldName: string): DataType | null {
  if (UNSUPPORTED_FRAGMENTS.some((fragment) => fieldName.includes(fragment))) return null;
  if (fieldName.includes("video")) return "video";
  // Every other `*_url`/`*_urls` field (image_url, image_urls, mask_url,
  // start_image_url, end_image_url, …) is treated as an image reference —
  // FAL's media inputs are overwhelmingly image URLs, and the app models no
  // third visual media type.
  return "image";
}

// The subset of an OpenAPI 3.0 document this module reads: the request body
// schema for the single POST endpoint FAL exposes per model, resolved
// through its `$ref` into `components.schemas`.
interface OpenApiDocument {
  paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: SchemaRef }> } } }>;
  components?: { schemas?: Record<string, JsonSchemaProperty> };
}

interface SchemaRef {
  $ref?: string;
}

interface JsonSchemaProperty {
  type?: string;
  items?: { type?: string };
  properties?: Record<string, JsonSchemaProperty>;
  // FAL wraps optional (nullable) fields as `anyOf: [{type: "..."}, {type:
  // "null"}]` instead of a bare `type`, so the effective type has to be read
  // through this wrapper too.
  anyOf?: JsonSchemaProperty[];
}

// The property's effective type: FAL represents an optional field as
// `anyOf: [{type}, {type: "null"}]` rather than a bare `type` key, so this
// looks through that wrapper for the first non-null branch.
function effectiveType(property: JsonSchemaProperty): { type?: string; items?: { type?: string } } {
  if (property.type) return property;
  const nonNullBranch = property.anyOf?.find((branch) => branch.type && branch.type !== "null");
  return nonNullBranch ?? property;
}

function resolveInputSchema(document: OpenApiDocument, endpointId: string): JsonSchemaProperty | null {
  const paths = document.paths ?? {};
  // FAL's queue OpenAPI document keys the input path by the endpoint id
  // (e.g. "/fal-ai/flux/schnell"); fall back to scanning for the sole POST
  // path if the id doesn't match verbatim, since some entries omit a
  // provider prefix mismatch or use a slightly different casing.
  const exactPath = paths[`/${endpointId}`];
  const path = exactPath ?? Object.values(paths).find((entry) => entry.post?.requestBody);
  const ref = path?.post?.requestBody?.content?.["application/json"]?.schema?.$ref;
  if (!ref) return null;

  const schemaName = ref.replace("#/components/schemas/", "");
  return document.components?.schemas?.[schemaName] ?? null;
}

const FAL_OPENAPI_URL = "https://fal.ai/api/openapi/queue/openapi.json";

export interface FetchModelInputSchemaOptions {
  /** Injectable fetch so tests can serve a canned OpenAPI document. */
  fetchImpl?: typeof fetch;
}

// Fetches ONE endpoint's OpenAPI document (ADR-0008: lazy, only at Model
// selection — never for the whole catalog). This is FAL's public,
// unauthenticated queue OpenAPI endpoint (`expand=openapi-3.0` equivalent),
// distinct from the `Authorization`-gated `/v1/models` catalog fetch in
// lib/fal-models.ts.
export async function fetchModelInputSchema(
  endpointId: string,
  options: FetchModelInputSchemaOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = new URL(FAL_OPENAPI_URL);
  url.searchParams.set("endpoint_id", endpointId);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`FAL openapi.json returned ${response.status} for ${endpointId}`);
  }
  return response.json();
}

export interface DeriveInputHandlesResult {
  handles: ResolvedHandle[];
  /**
   * Whether the Model's schema exposes a `negative_prompt` field (ADR-0007 /
   * issue #32). It is never itself a handle — it's surfaced as an optional
   * config field beneath the prompt, not a connection point, and never part
   * of the Resolved Prompt.
   */
  hasNegativePrompt: boolean;
}

export function deriveInputHandles(
  openapiDocument: unknown,
  endpointId: string,
): DeriveInputHandlesResult {
  const document = openapiDocument as OpenApiDocument;
  const inputSchema = resolveInputSchema(document, endpointId);
  if (!inputSchema?.properties) return { handles: [], hasNegativePrompt: false };

  const handles: ResolvedHandle[] = [];
  const hasNegativePrompt = Object.prototype.hasOwnProperty.call(
    inputSchema.properties,
    "negative_prompt",
  );

  for (const [fieldName, property] of Object.entries(inputSchema.properties)) {
    // Nested objects are skipped outright (ADR-0007) — a handle only ever
    // comes from a string or array-of-string property.
    const resolved = effectiveType(property);
    const isArray = resolved.type === "array";
    const isString = resolved.type === "string";
    if (!isArray && !isString) continue;
    if (isArray && resolved.items?.type !== "string") continue;

    const match = URL_SUFFIX.exec(fieldName);
    if (!match) continue;

    const dataType = classifyDataType(fieldName);
    if (!dataType) continue;

    handles.push({
      handleId: fieldName,
      label: fieldName,
      dataType,
      many: isArray,
    });
  }

  return { handles, hasNegativePrompt };
}
