// Pure data + logic behind the right-click "add node" context menu.
// See CONTEXT.md: four node types are listed as a flat list.

export type NodeTypeKey =
  | "staticMediaReference"
  | "staticTextReference"
  | "imageGeneration"
  | "videoGeneration";

export interface NodeTypeOption {
  type: NodeTypeKey;
  label: string;
}

export const NODE_TYPE_OPTIONS: NodeTypeOption[] = [
  { type: "staticMediaReference", label: "Static Media Reference" },
  { type: "staticTextReference", label: "Static Text Reference" },
  { type: "imageGeneration", label: "Image Generation Node" },
  { type: "videoGeneration", label: "Video Generation Node" },
];

// The always-open, centred onboarding menu is visible only on an empty
// canvas; it hides after the first node and returns if all nodes are
// deleted (issue #5 acceptance criteria).
export function shouldShowEmptyCanvasMenu(nodeCount: number): boolean {
  return nodeCount === 0;
}

export interface FlowPosition {
  x: number;
  y: number;
}

export interface NewFlowNode {
  id: string;
  type: NodeTypeKey;
  position: FlowPosition;
  data: Record<string, unknown>;
}

function initialDataFor(type: NodeTypeKey): Record<string, unknown> {
  switch (type) {
    case "staticTextReference":
      return { text: "" };
    case "imageGeneration":
      return { prompt: "", output: null };
    default:
      return {};
  }
}

// Builds a fresh React Flow node for the given type at the given flow
// position (the right-click point, or the canvas centre for the empty-state
// menu).
export function createNodeAt(type: NodeTypeKey, position: FlowPosition): NewFlowNode {
  return {
    id: crypto.randomUUID(),
    type,
    position,
    data: initialDataFor(type),
  };
}
