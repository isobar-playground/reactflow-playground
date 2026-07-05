import type { ResolvedHandle } from "./fal-schema";
import { getActiveEntry, type NodeHistory } from "./node-history";

// generation-payload (issue #40 / ADR-0009, PRD #35): a pure module mapping a
// Generation Node's snapshotted, schema-derived Input Handles (ADR-0007/
// ADR-0008) + their currently-connected source nodes into the FAL request
// body — generation payloads grow from prompt-only (#36) to the node's full
// wired inputs. Each media connection resolves to its source's value: a
// Static Media Reference's asset (local Asset Library, ADR-0005 — not
// reachable by FAL, so marked for later inlining) or an upstream Generation
// Node's Active Output (already a public fal.media URL, passed through
// as-is). Framework-agnostic — no React Flow import — like
// lib/connection-rules.ts and lib/edge-reconcile.ts, so it's trivial to unit
// test and shared by both Generation Node components.

// The shape a caller (a node component, reading useNodeConnections +
// useNodesData) hands in for one connected source node — deliberately just
// the two fields this module actually reads, mirroring
// lib/edge-reconcile.ts's resolveEdgeDataTypeFromNodes' own minimal node
// shape.
export interface ConnectedSourceNode {
  type?: string;
  data: unknown;
}

export interface MediaHandleConnection {
  handle: ResolvedHandle;
  /** Connected source nodes for this handle, in edge order; empty when
   * nothing is wired — an unconnected handle is simply omitted from the
   * payload (FAL's own validation error surfaces as the node error, per
   * CONTEXT.md — no client-side required-field duplication). */
  sources: ConnectedSourceNode[];
}

// A media field that resolved to a local Asset Library asset (ADR-0005): its
// URL isn't reachable by FAL and needs base64 inlining before submission —
// tracked separately from `body` so this module stays pure (no fetch/I/O)
// while still telling the submit step exactly what to inline and where.
export interface LocalAssetRef {
  handleId: string;
  /** Index into the array value, for a `many` handle; absent for a single
   * value. */
  index?: number;
  url: string;
}

export interface GenerationPayload {
  body: Record<string, unknown>;
  localAssetRefs: LocalAssetRef[];
}

interface ResolvedMediaValue {
  url: string;
  /** True when the value came from the local Asset Library (a Static Media
   * Reference) rather than an upstream Generation Node's already-public
   * fal.media output. */
  local: boolean;
}

// Resolves one connected source node to the value it feeds a media handle —
// the two shapes CONTEXT.md's Connection rules allow a media Input Handle to
// receive: a Static Media Reference's chosen asset, or a Generation Node's
// Active Output. Any other/unrecognized source resolves to nothing, and is
// simply excluded (same effect as being unconnected).
function resolveConnectedMediaValue(source: ConnectedSourceNode): ResolvedMediaValue | undefined {
  if (source.type === "staticMediaReference") {
    const asset = (source.data as { asset?: { url: string } | null } | undefined)?.asset;
    return asset ? { url: asset.url, local: true } : undefined;
  }
  if (source.type === "imageGeneration" || source.type === "videoGeneration") {
    const history = (source.data as { history?: NodeHistory } | undefined)?.history;
    const active = history ? getActiveEntry(history) : undefined;
    return active ? { url: active.output.url, local: false } : undefined;
  }
  return undefined;
}

export function buildGenerationPayload(
  base: { prompt: string; negativePrompt?: string },
  mediaConnections: MediaHandleConnection[],
): GenerationPayload {
  const body: Record<string, unknown> = { prompt: base.prompt };
  if (base.negativePrompt) {
    body.negative_prompt = base.negativePrompt;
  }

  const localAssetRefs: LocalAssetRef[] = [];

  for (const { handle, sources } of mediaConnections) {
    const resolved = sources
      .map(resolveConnectedMediaValue)
      .filter((value): value is ResolvedMediaValue => value !== undefined);
    if (resolved.length === 0) continue;

    if (handle.many) {
      body[handle.handleId] = resolved.map((value) => value.url);
      resolved.forEach((value, index) => {
        if (value.local) localAssetRefs.push({ handleId: handle.handleId, index, url: value.url });
      });
    } else {
      body[handle.handleId] = resolved[0].url;
      if (resolved[0].local) {
        localAssetRefs.push({ handleId: handle.handleId, url: resolved[0].url });
      }
    }
  }

  return { body, localAssetRefs };
}
