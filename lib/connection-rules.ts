import type { NodeTypeKey } from "./add-node-menu";

// connection-rules (CONTEXT.md / PRD issue #1): validates a connection
// attempt by data type at connect time. A directed edge means "the source's
// output feeds a specific input handle of the target". References have an
// output handle only — nothing can connect into a Reference. Generation
// Node outputs may chain into further Generation Nodes.
//
// The model is data-type driven rather than a literal node-type switch, so
// it extends naturally as more node types/handles are registered (issues
// #10/#11 add the image/video handles and the Video Generation Node):
// each node type declares what data type its (possibly handle-scoped)
// output produces, and each target handle declares which data types it
// accepts. A connection is allowed when the target handle exists and its
// accepted types include the source's output data type.

export type DataType = "text" | "image" | "video";

export interface ConnectionAttempt {
  sourceType: NodeTypeKey;
  /** Handle id on the source node, or null for a node with a single implicit output. */
  sourceHandle: string | null;
  targetType: NodeTypeKey;
  /** Handle id on the target node, or null when the target has no named input handles. */
  targetHandle: string | null;
  /** Edges already present, for enforcing per-handle multiplicity. */
  existingEdges: ConnectionAttemptEdge[];
}

export interface ConnectionAttemptEdge {
  target: string;
  targetHandle: string | null;
}

// What data type each node type's output produces. References reject all
// inbound edges, so they have no entry in `targetHandles` below.
const SOURCE_DATA_TYPE: Record<NodeTypeKey, DataType | null> = {
  staticTextReference: "text",
  staticMediaReference: null, // image or video, not modelled until #10/#11 need it
  imageGeneration: "image",
  videoGeneration: "video",
};

// Which data types each target node type's named input handles accept.
// Node types absent here (the two Reference kinds) accept no inbound edges
// at all — References have an output handle only (CONTEXT.md).
const TARGET_HANDLES: Partial<Record<NodeTypeKey, Record<string, DataType[]>>> = {
  imageGeneration: {
    text: ["text"],
  },
};

export function isConnectionAllowed(attempt: ConnectionAttempt): boolean {
  const sourceDataType = SOURCE_DATA_TYPE[attempt.sourceType];
  if (!sourceDataType) return false;

  const handles = TARGET_HANDLES[attempt.targetType];
  if (!handles) return false; // e.g. a Reference target: no inbound edges allowed

  if (attempt.targetHandle === null) return false;
  const acceptedTypes = handles[attempt.targetHandle];
  if (!acceptedTypes) return false; // unknown/unsupported handle

  return acceptedTypes.includes(sourceDataType);
}
