// canvas-cost (CONTEXT.md's Actual Cost: "a canvas also shows the running
// sum of all its nodes' Actual Costs", issue #42): a pure module summing
// Actual Cost across every History entry of every node on the canvas.
// Purely derived from node data on the fly — never persisted as an
// aggregate (CONTEXT.md) — so the canvas editor recomputes it from React
// Flow's own `nodes` state on every render instead of tracking a running
// total in its own state.
//
// Nodes are read structurally (a `data.history.entries[].actualCost`
// shape) rather than importing ImageGenerationNodeData/
// VideoGenerationNodeData, so this module has no dependency on the node
// components and works for either Generation Node kind — and harmlessly
// contributes nothing for any node type with no `history` at all (e.g.
// References).
export interface CanvasCostHistoryEntryLike {
  actualCost?: number;
}

export interface CanvasCostNodeLike {
  data?: {
    history?: {
      entries?: CanvasCostHistoryEntryLike[];
    };
  };
}

// Returns undefined when nothing on the canvas has a recorded cost —
// mirrors computeActualCost's own convention (lib/actual-cost.ts) so the
// editor can render nothing rather than a misleading "$0.00" on a canvas
// with no costs yet (CONTEXT.md / issue #42: "a canvas with no costs shows
// no total").
export function totalActualCost(nodes: CanvasCostNodeLike[]): number | undefined {
  let total: number | undefined;
  for (const node of nodes) {
    for (const entry of node.data?.history?.entries ?? []) {
      if (entry.actualCost === undefined) continue;
      total = (total ?? 0) + entry.actualCost;
    }
  }
  return total;
}
