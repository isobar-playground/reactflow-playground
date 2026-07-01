import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { StaticTextReferenceNode } from "./static-text-reference-node";

const nodeTypes = { staticTextReference: StaticTextReferenceNode };

function renderNode(data: { text: string } = { text: "" }) {
  const nodes = [
    {
      id: "n1",
      type: "staticTextReference",
      position: { x: 0, y: 0 },
      // jsdom has no layout engine, so give the node an explicit size —
      // otherwise @xyflow/react never marks it "measured" and renders it
      // `visibility: hidden`, which accessible queries correctly skip.
      initialWidth: 200,
      initialHeight: 100,
      data,
    },
  ];
  return render(
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} />
    </ReactFlowProvider>,
  );
}

describe("StaticTextReferenceNode", () => {
  it("renders a textarea for entering text", () => {
    renderNode({ text: "hello" });

    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("renders exactly one handle, marked as a source (output only)", () => {
    const { container } = renderNode();

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles).toHaveLength(1);
    expect(handles[0]).toHaveClass("source");
    expect(handles[0]).not.toHaveClass("target");
  });

  it("lets the user type text into the field", async () => {
    const user = userEvent.setup();
    renderNode({ text: "" });

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "abc");

    expect(textarea).toHaveValue("abc");
  });
});
