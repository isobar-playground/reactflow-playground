import type { Edge, Node } from "@xyflow/react";

const DUPLICATE_OFFSET_X = 40;
const DUPLICATE_OFFSET_Y = 40;

export interface DuplicateResult {
  node: Node;
  edges: Edge[];
}

// Manual "Duplicate" (node context menu), distinct from variant cloning
// (lib/variant-clone.ts, CONTEXT.md's Variant/Clone): copies the node's data
// as-is rather than resetting History, since this isn't "generate another
// variant" — it's "give me another one just like this", and applies to any
// node type, not just Generation Nodes. Like variant cloning, only incoming
// edges are inherited so the duplicate never doubles up on a downstream
// single-input handle the original already occupies.
export function duplicateNode(original: Node, edges: Edge[]): DuplicateResult {
  const cloneId = crypto.randomUUID();
  const incomingEdges = edges.filter((edge) => edge.target === original.id);

  const node: Node = {
    ...original,
    id: cloneId,
    position: {
      x: original.position.x + DUPLICATE_OFFSET_X,
      y: original.position.y + DUPLICATE_OFFSET_Y,
    },
    selected: false,
  };

  const clonedEdges = incomingEdges.map((edge) => ({
    ...edge,
    id: crypto.randomUUID(),
    target: cloneId,
  }));

  return { node, edges: clonedEdges };
}
