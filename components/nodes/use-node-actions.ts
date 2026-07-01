import { useReactFlow } from "@xyflow/react";
import { duplicateNode } from "@/lib/duplicate-node";

// Shared by every node type's NodeActionsMenu (the header "⋮" button):
// duplicate/delete don't care what kind of node they're acting on, so this
// is one small hook rather than four copies of the same two calls.
export function useNodeActions(id: string) {
  const { getNode, getEdges, addNodes, addEdges, deleteElements } = useReactFlow();

  function duplicate() {
    const node = getNode(id);
    if (!node) return;
    const { node: clone, edges } = duplicateNode(node, getEdges());
    addNodes([clone]);
    addEdges(edges);
  }

  function remove() {
    void deleteElements({ nodes: [{ id }] });
  }

  return { duplicate, remove };
}
