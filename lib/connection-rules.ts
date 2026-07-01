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
  /** Id of the target node, used to scope existingEdges when checking per-handle multiplicity. */
  targetId: string;
  /** Handle id on the target node, or null when the target has no named input handles. */
  targetHandle: string | null;
  /** Edges already present, for enforcing per-handle multiplicity. */
  existingEdges: ConnectionAttemptEdge[];
  /**
   * Concrete output data type for source node types whose type isn't fixed
   * per node type (issue #9: a Static Media Reference's output is image or
   * video depending on which asset it holds, inferred from the file — so
   * unlike the other node types it has no single entry in
   * SOURCE_DATA_TYPE). The caller resolves this from the source node's
   * instance data before calling isConnectionAllowed. Ignored for node
   * types that already have a fixed entry in SOURCE_DATA_TYPE.
   */
  sourceDataType?: DataType | null;
}

export interface ConnectionAttemptEdge {
  target: string;
  targetHandle: string | null;
}

// What data type each node type's output produces. References reject all
// inbound edges, so they have no entry in `targetHandles` below.
const SOURCE_DATA_TYPE: Record<NodeTypeKey, DataType | null> = {
  staticTextReference: "text",
  staticMediaReference: null, // image or video, per-instance (issue #9): resolved via ConnectionAttempt.sourceDataType
  imageGeneration: "image",
  videoGeneration: "video",
};

// Which data types each target node type's named input handles accept.
// Node types absent here (the two Reference kinds) accept no inbound edges
// at all — References have an output handle only (CONTEXT.md).
const TARGET_HANDLES: Partial<Record<NodeTypeKey, Record<string, DataType[]>>> = {
  imageGeneration: {
    text: ["text"],
    // image (issue #10): accepts images only — many allowed (a Static Media
    // Reference image or another Image Generation Node's output), never
    // video (CONTEXT.md: video -> Image Generation Node is never allowed).
    image: ["image"],
  },
  videoGeneration: {
    text: ["text"],
    // startFrame / endFrame (issue #11): exactly one image each.
    startFrame: ["image"],
    endFrame: ["image"],
    // imageReference (issue #11): many images allowed.
    imageReference: ["image"],
    // video (issue #11): exactly one video. Connecting it is mutually
    // exclusive with startFrame/endFrame/imageReference — enforced below,
    // not here, since it depends on what else is already connected.
    video: ["video"],
  },
};

// Handles that accept only a single incoming edge (CONTEXT.md: start frame
// and end frame accept exactly one image; video accepts exactly one video).
const SINGLE_CONNECTION_HANDLES: Partial<Record<NodeTypeKey, string[]>> = {
  videoGeneration: ["startFrame", "endFrame", "video"],
};

// Video-exclusivity (CONTEXT.md / issue #11): connecting a video blocks
// startFrame/endFrame/imageReference, and vice versa — only `text` may
// coexist with a connected video.
const VIDEO_EXCLUSIVE_HANDLES = ["startFrame", "endFrame", "imageReference", "video"];

export function isConnectionAllowed(attempt: ConnectionAttempt): boolean {
  const sourceDataType = SOURCE_DATA_TYPE[attempt.sourceType] ?? attempt.sourceDataType;
  if (!sourceDataType) return false;

  const handles = TARGET_HANDLES[attempt.targetType];
  if (!handles) return false; // e.g. a Reference target: no inbound edges allowed

  if (attempt.targetHandle === null) return false;
  const acceptedTypes = handles[attempt.targetHandle];
  if (!acceptedTypes) return false; // unknown/unsupported handle

  if (!acceptedTypes.includes(sourceDataType)) return false;

  const edgesOnTarget = attempt.existingEdges.filter((edge) => edge.target === attempt.targetId);

  const singleHandles = SINGLE_CONNECTION_HANDLES[attempt.targetType];
  if (singleHandles?.includes(attempt.targetHandle)) {
    const alreadyConnected = edgesOnTarget.some(
      (edge) => edge.targetHandle === attempt.targetHandle,
    );
    if (alreadyConnected) return false;
  }

  if (
    attempt.targetType === "videoGeneration" &&
    VIDEO_EXCLUSIVE_HANDLES.includes(attempt.targetHandle)
  ) {
    if (attempt.targetHandle === "video") {
      // Connecting a video is blocked if any frame/image-reference is
      // already connected.
      const hasFrameOrImageRef = edgesOnTarget.some((edge) =>
        ["startFrame", "endFrame", "imageReference"].includes(edge.targetHandle ?? ""),
      );
      if (hasFrameOrImageRef) return false;
    } else {
      // Connecting a frame/image-reference is blocked if a video is
      // already connected.
      const hasVideo = edgesOnTarget.some((edge) => edge.targetHandle === "video");
      if (hasVideo) return false;
    }
  }

  return true;
}
