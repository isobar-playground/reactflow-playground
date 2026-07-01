import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { HandleBadge } from "./handle-badge";

// HandleBadge (CONTEXT.md / PRD issue #17): wraps React Flow's Handle in a
// larger, legible circle with a glyph for its data type — literal "T" for
// text, an image icon for image, a video icon for video — applied
// consistently across all four node types' input and output handles.

function renderBadge(props: Partial<React.ComponentProps<typeof HandleBadge>> = {}) {
  return render(
    <ReactFlowProvider>
      <HandleBadge type="source" position={Position.Right} dataType="text" {...props} />
    </ReactFlowProvider>,
  );
}

describe("HandleBadge", () => {
  it("renders a literal T glyph for a text handle", () => {
    const { getByText } = renderBadge({ dataType: "text" });

    expect(getByText("T")).toBeInTheDocument();
  });

  it("renders an image icon (not the T glyph) for an image handle", () => {
    const { container, queryByText } = renderBadge({ dataType: "image" });

    expect(queryByText("T")).not.toBeInTheDocument();
    expect(container.querySelector("svg.lucide-image")).toBeInTheDocument();
  });

  it("renders a video icon (not the T glyph) for a video handle", () => {
    const { container, queryByText } = renderBadge({ dataType: "video" });

    expect(queryByText("T")).not.toBeInTheDocument();
    expect(container.querySelector("svg.lucide-video")).toBeInTheDocument();
  });

  it("surfaces a passed title as the handle's title attribute, for handles that would otherwise be ambiguous", () => {
    const { container } = renderBadge({ title: "start frame" });

    expect(container.querySelector('[title="start frame"]')).toBeInTheDocument();
  });

  it("renders as a source handle when type is source", () => {
    const { container } = renderBadge({ type: "source" });

    const handle = container.querySelector(".react-flow__handle");
    expect(handle).toHaveClass("source");
    expect(handle).not.toHaveClass("target");
  });

  it("renders as a target handle when type is target", () => {
    const { container } = renderBadge({ type: "target" });

    const handle = container.querySelector(".react-flow__handle");
    expect(handle).toHaveClass("target");
    expect(handle).not.toHaveClass("source");
  });
});
