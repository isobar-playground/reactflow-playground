import type { Edge, Node } from "@xyflow/react";
import type { NodeHistory } from "./node-history";

// variant-clone (CONTEXT.md / issue #12): a Generation Node's variant count,
// set above one and Generated, clones the node into that many independent
// nodes. Each clone inherits only the original's incoming reference edges
// (outgoing edges are never duplicated — CONTEXT.md), is laid out beside the
// original with an offset, and starts with its own fresh History rather than
// a copy of the original's. Pure/framework-agnostic like connection-rules.ts
// and node-history.ts: the caller (the node component) supplies fresh ids
// and each clone's freshly generated output, and pushes the result into the
// canvas's node/edge state.

const CLONE_OFFSET_X = 40;
const CLONE_OFFSET_Y = 420;

export interface CloneResult {
  nodes: Node[];
  edges: Edge[];
}

export function cloneVariants(original: Node, edges: Edge[], count: number): CloneResult {
  const incomingEdges = edges.filter((edge) => edge.target === original.id);

  const clones: Node[] = [];
  const clonedEdges: Edge[] = [];

  for (let i = 0; i < count; i++) {
    const cloneId = crypto.randomUUID();
    const emptyHistory: NodeHistory = { entries: [], activeId: null };

    clones.push({
      ...original,
      id: cloneId,
      position: {
        x: original.position.x + CLONE_OFFSET_X * (i + 1),
        y: original.position.y + CLONE_OFFSET_Y * (i + 1),
      },
      data: {
        ...original.data,
        history: emptyHistory,
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
