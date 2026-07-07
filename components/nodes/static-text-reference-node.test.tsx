import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import { StaticTextReferenceNode } from "./static-text-reference-node";
import { ImageGenerationNode } from "./image-generation-node";
import * as realGeneration from "@/lib/real-generation";

vi.mock("@/lib/real-generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/real-generation")>();
  return {
    ...actual,
    runImageGeneration: vi.fn(),
  };
});

const nodeTypes = {
  staticTextReference: StaticTextReferenceNode,
  imageGeneration: ImageGenerationNode,
};

// Node data write-through (ADR-0002) only round-trips back into a controlled
// input when React Flow's nodes/edges are owned by useNodesState/
// useEdgesState with onNodesChange/onEdgesChange wired through — the same
// way components/canvas-editor.tsx wires the real canvas. A static
// `nodes={[...]}` literal has nowhere for an internal updateNodeData change
// to flow back to, so it can't observe write-through.
function renderInCanvas(initialNodes: Node[], initialEdges: Edge[] = []) {
  function TestCanvas() {
    const [nodes, , onNodesChange] = useNodesState<Node>(initialNodes);
    const [edges, , onEdgesChange] = useEdgesState<Edge>(initialEdges);
    return (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
      />
    );
  }
  return render(
    <ReactFlowProvider>
      <TestCanvas />
    </ReactFlowProvider>,
  );
}

function renderNode(data: { text: string } = { text: "" }) {
  return renderInCanvas([
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
  ]);
}

describe("StaticTextReferenceNode", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("presents itself as a compact text source", () => {
    const { container } = renderNode({ text: "hello" });

    const node = container.querySelector('[data-node-id="n1"]');
    expect(node).toHaveClass("w-56");
    expect(screen.getByText("Text source")).toBeInTheDocument();
    expect(screen.getAllByText("T").length).toBeGreaterThan(0);
  });

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

  // ADR-0002: node data is the single source of truth for persisted canvas
  // content. Typing must write through to the node's `data.text`, not just
  // local component state — verified here through a downstream consumer
  // submitting its Resolved Prompt from useNodesData(...).data.text, the
  // same way a reload or another node would observe it, rather than
  // asserting on the DOM value alone.
  it("writes typed text through to node data, observable by a connected consumer", async () => {
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    const user = userEvent.setup();
    const nodes: Node[] = [
      {
        id: "ref1",
        type: "staticTextReference",
        position: { x: 0, y: 0 },
        initialWidth: 200,
        initialHeight: 100,
        data: { text: "" },
      },
      {
        id: "gen1",
        type: "imageGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: {
          prompt: "",
          history: { entries: [], activeId: null },
          model: {
            endpointId: "fal-ai/flux/dev",
            name: "FLUX.1 [dev]",
            category: "text-to-image",
            handles: [],
            hasNegativePrompt: false,
          },
        },
      },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "ref1", target: "gen1", targetHandle: "text" },
    ];

    renderInCanvas(nodes, edges);

    const textarea = screen.getByPlaceholderText("Enter text…");
    await user.type(textarea, "a red car");

    const gen1Container = document.querySelector('[data-node-id="gen1"]') as HTMLElement;
    await user.click(within(gen1Container).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ endpointId: "fal-ai/flux/dev", prompt: "a red car" }),
        expect.anything(),
      );
    });
  });
});
