import type { Edge, Node } from "@xyflow/react";
import { SOURCE_DATA_TYPE, type DataType } from "./connection-rules";
import type { ResolvedHandle } from "./fal-schema";
import type { NodeTypeKey } from "./add-node-menu";

// edge-reconcile (CONTEXT.md's Handle-Spawned Node / ADR-0008, issue #33):
// re-selecting a Generation Node's Model recomputes its snapshotted Input
// Handle set (ADR-0007/ADR-0008), and any existing input edge whose target
// handle the new snapshot no longer exposes — or now exposes with an
// incompatible data type — is dropped **silently**, per ADR-0004's
// no-confirmation ethos. These two pure helpers do the actual matching, kept
// framework-agnostic like lib/connection-rules.ts and lib/handle-spawn.ts so
// they're trivial to unit test and share between the Image and Video
// Generation Node components.

// Resolves an edge's carried data type. Kept as an injected function rather
// than baked into the edge itself — like canvas-editor.tsx's
// sourceMediaDataType/draggedHandleDataType — since a plain `Edge` doesn't
// carry its data type; only the source node (and, for a Static Media
// Reference, its per-instance asset) knows it.
export type ResolveEdgeDataType = (edge: Edge) => DataType | null | undefined;

// The node's fixed prompt handle (ADR-0007): present whenever a Model is
// selected, always accepting text, and never itself part of the
// Model-derived snapshot — reconciliation must not drop it.
const TEXT_HANDLE_ID = "text";

// Given a Generation Node's freshly recomputed handle snapshot, finds the
// first handle (in schema order) that accepts `dataType` — used both by
// Handle-Spawned Node's Model-picker flow (CONTEXT.md) and available here
// for callers that need to know where a dropped edge *could* have
// reconnected.
export function firstCompatibleHandle(
  handles: ResolvedHandle[],
  dataType: DataType,
): ResolvedHandle | null {
  return handles.find((handle) => handle.dataType === dataType) ?? null;
}

// Reconciles `edges` against a Generation Node's newly-selected Model: every
// edge targeting `nodeId` is kept only if its `targetHandle` still exists in
// `newHandles` (or is the fixed `text` handle) AND the edge's own data type
// is still accepted there. Edges targeting other nodes pass through
// untouched. Re-selecting the same Model — same handles, same ids — is a
// no-op: every previously-valid edge stays valid.
export function reconcileEdges(
  edges: Edge[],
  nodeId: string,
  newHandles: ResolvedHandle[],
  resolveEdgeDataType: ResolveEdgeDataType,
): Edge[] {
  const handlesById = new Map(newHandles.map((handle) => [handle.handleId, handle]));

  return edges.filter((edge) => {
    if (edge.target !== nodeId) return true;

    const targetHandle = edge.targetHandle ?? "";
    if (targetHandle === TEXT_HANDLE_ID) return true;

    const handle = handlesById.get(targetHandle);
    if (!handle) return false;

    const edgeDataType = resolveEdgeDataType(edge);
    return edgeDataType === handle.dataType;
  });
}

// A ready-made ResolveEdgeDataType for the canvas's real node graph: looks
// up the edge's source node via `getNode` and resolves its output data
// type the same way canvas-editor.tsx's sourceMediaDataType does — fixed
// per node type via SOURCE_DATA_TYPE, except a Static Media Reference,
// whose type is per-instance (the asset it holds, or none yet).
export function resolveEdgeDataTypeFromNodes(
  getNode: (id: string) => Node | undefined,
): ResolveEdgeDataType {
  return (edge) => {
    const sourceNode = getNode(edge.source);
    if (!sourceNode) return undefined;
    if (sourceNode.type === "staticMediaReference") {
      const data = sourceNode.data as { asset?: { type: DataType } | null };
      return data.asset?.type ?? null;
    }
    return SOURCE_DATA_TYPE[sourceNode.type as NodeTypeKey] ?? undefined;
  };
}
