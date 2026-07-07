import type { Edge, Node } from "@xyflow/react";
import { branchHistoryToActive, type NodeHistory } from "./node-history";

// variant-clone (CONTEXT.md / issue #12, extended by PRD #69 / ADR-0013): a
// Generation Node's variant count, set above one and Generated, clones the
// node into that many independent nodes. Each clone inherits only the
// original's incoming reference edges (outgoing edges are never duplicated —
// CONTEXT.md), is laid out beside the original with an offset. Its inherited
// History is the original's History up to its Active Output
// (branchHistoryToActive): on a first-generation Variant that's still empty
// (nothing yet to inherit), but on an Edit each clone continues the
// original's chain up to the branch point rather than starting fresh — this
// is how a branch (Variant, or an Edit taken from a non-newest entry) stays
// on the canvas as a sibling node instead of turning a node's History into a
// tree. Pure/framework-agnostic like connection-rules.ts and node-history.ts:
// the caller (the node component) supplies fresh ids and each clone's own
// generated output, and pushes the result into the canvas's node/edge state.

const CLONE_OFFSET_X = 40;
const CLONE_OFFSET_Y = 420;

export interface CloneResult {
  nodes: Node[];
  edges: Edge[];
}

export function cloneVariants(original: Node, edges: Edge[], count: number): CloneResult {
  const incomingEdges = edges.filter((edge) => edge.target === original.id);
  const originalHistory = (original.data as { history?: NodeHistory }).history ?? {
    entries: [],
    activeId: null,
  };
  const inheritedHistory = branchHistoryToActive(originalHistory);

  const clones: Node[] = [];
  const clonedEdges: Edge[] = [];

  for (let i = 0; i < count; i++) {
    const cloneId = crypto.randomUUID();

    clones.push({
      ...original,
      id: cloneId,
      position: {
        x: original.position.x + CLONE_OFFSET_X * (i + 1),
        y: original.position.y + CLONE_OFFSET_Y * (i + 1),
      },
      data: {
        ...original.data,
        history: inheritedHistory,
      },
      selected: false,
    });

    for (const edge of incomingEdges) {
      clonedEdges.push({
        ...edge,
        id: crypto.randomUUID(),
        target: cloneId,
      });
    }
  }

  return { nodes: clones, edges: clonedEdges };
}
