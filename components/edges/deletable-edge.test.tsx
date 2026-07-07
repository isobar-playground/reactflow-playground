import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import { DeletableEdge } from "./deletable-edge";

// DeletableEdge (ADR-0004 / issue #19): the app's first custom edge type,
// wired in as edgeTypes = { default: DeletableEdge } on CanvasEditor's
// <ReactFlow>. Renders the same bezier path the default edge always has,
// plus a hover-revealed "×" button at the midpoint that deletes the edge
// immediately via useReactFlow().deleteElements. Mounted through a minimal
// real <ReactFlow> (rather than bare EdgeProps, unlike
// components/nodes/handle-badge.test.tsx's Handle-only pattern) because
// EdgeLabelRenderer's button portals into a DOM node React Flow itself
// creates on mount — it renders nothing without one.

const nodes: Node[] = [
  { id: "n1", position: { x: 0, y: 0 }, data: {} },
  { id: "n2", position: { x: 200, y: 0 }, data: {} },
];

function renderEdge(edgeOverrides: Partial<Edge> = {}) {
  const edges: Edge[] = [{ id: "e1", source: "n1", target: "n2", ...edgeOverrides }];
  return render(
    <ReactFlowProvider>
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={nodes} edges={edges} edgeTypes={{ default: DeletableEdge }} />
      </div>
    </ReactFlowProvider>,
  );
}

describe("DeletableEdge", () => {
  it("renders semantic data-type treatment when the edge carries a data type", () => {
    const { container, getByLabelText } = renderEdge({ data: { dataType: "video" } });

    expect(getByLabelText("video edge")).toBeInTheDocument();
    expect(container.querySelector('[data-edge-data-type="video"]')).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-video")).toBeInTheDocument();
  });

  it("hides the delete button before hover", () => {
    const { queryByRole } = renderEdge();

    expect(queryByRole("button", { name: "Delete edge" })).not.toBeInTheDocument();
  });

  it("reveals the delete button on mouseEnter over the edge's interactive group", () => {
    const { container, getByRole } = renderEdge();

    const group = container.querySelector('[data-testid="deletable-edge-interaction"]') as HTMLElement;
    fireEvent.mouseEnter(group);

    expect(getByRole("button", { name: "Delete edge" })).toBeInTheDocument();
  });

  it("hides the delete button again on mouseLeave", () => {
    const { container, queryByRole } = renderEdge();

    const group = container.querySelector('[data-testid="deletable-edge-interaction"]') as HTMLElement;
    fireEvent.mouseEnter(group);
    fireEvent.mouseLeave(group);

    expect(queryByRole("button", { name: "Delete edge" })).not.toBeInTheDocument();
  });
});
