import type { NodeTypeKey } from "./add-node-menu";
import { SOURCE_DATA_TYPE, TARGET_HANDLES, type DataType } from "./connection-rules";

// handle-spawn (CONTEXT.md / PRD issue #17): a Handle-Spawned Node is created
// by dragging from an existing node's handle and dropping on empty canvas —
// this pure function resolves which node types (and, for a target node type
// with several handles accepting the same data type, which specific handle)
// would form a valid connection at the dragged handle, mirroring the shape
// and style of lib/connection-rules.ts rather than re-declaring its type
// maps.

export interface SpawnAttempt {
  /**
   * Which end of the connection was dragged: "source" means the user dragged
   * from an output handle and we need a compatible *target* node type;
   * "target" means the user dragged from an input handle and we need a
   * compatible *source* node type.
   */
  direction: "source" | "target";
  /** The dragged handle's data type. */
  dataType: DataType;
}

export interface SpawnCandidate {
  nodeType: NodeTypeKey;
  /** The specific handle the new node should be auto-connected at, or null
   * for a node type with a single implicit input/output. */
  handleId: string | null;
}

// Static Media Reference has no fixed entry in SOURCE_DATA_TYPE (issue #9:
// its output type is per-instance, resolved only once an asset is chosen).
// It is still a valid spawn candidate for any image- or video-accepting
// target handle — callers special-case it per ADR-0003 (its Asset Picker
// opens immediately with a type hint; the edge is created only once an
// asset is picked, not at spawn time).
const MEDIA_REFERENCE_DATA_TYPES: DataType[] = ["image", "video"];

export function resolveSpawnCandidates(attempt: SpawnAttempt): SpawnCandidate[] {
  if (attempt.direction === "source") {
    return resolveTargetCandidates(attempt.dataType);
  }
  return resolveSourceCandidates(attempt.dataType);
}

// The user dragged from an output handle producing `dataType`: find every
// node type (and first-declared matching handle) that could accept it as a
// target. Static Media Reference itself never appears here — it's a
// Reference (output handle only), so it accepts no inbound edges.
function resolveTargetCandidates(dataType: DataType): SpawnCandidate[] {
  const candidates: SpawnCandidate[] = [];

  for (const [nodeType, handles] of Object.entries(TARGET_HANDLES) as [
    NodeTypeKey,
    Record<string, DataType[]>,
  ][]) {
    const handleId = firstMatchingHandle(handles, dataType);
    if (handleId) candidates.push({ nodeType, handleId });
  }

  return candidates;
}

// The user dragged from an input handle accepting `dataType`: find every
// node type that could provide it as a source.
function resolveSourceCandidates(dataType: DataType): SpawnCandidate[] {
  const candidates: SpawnCandidate[] = [];

  for (const [nodeType, sourceType] of Object.entries(SOURCE_DATA_TYPE) as [
    NodeTypeKey,
    DataType | null,
  ][]) {
    if (sourceType === dataType) candidates.push({ nodeType, handleId: null });
  }

  if (MEDIA_REFERENCE_DATA_TYPES.includes(dataType)) {
    candidates.unshift({ nodeType: "staticMediaReference", handleId: null });
  }

  return candidates;
}

// For a target node type with multiple handles accepting the same data
// type, returns the first matching handle in the object's declared key
// order (PRD: "the first such handle in the node's declared order is
// used").
function firstMatchingHandle(
  handles: Record<string, DataType[]>,
  dataType: DataType,
): string | null {
  for (const [handleId, acceptedTypes] of Object.entries(handles)) {
    if (acceptedTypes.includes(dataType)) return handleId;
  }
  return null;
}
