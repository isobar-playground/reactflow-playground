import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import * as libraryActions from "@/app/library-actions";
import { StaticMediaReferenceNode, type StaticMediaReferenceNodeData } from "./static-media-reference-node";

const nodeTypes = { staticMediaReference: StaticMediaReferenceNode };

// Node data write-through (ADR-0002) only round-trips back into the
// component when React Flow's nodes/edges are owned by useNodesState/
// useEdgesState with onNodesChange wired through — the same way
// components/canvas-editor.tsx wires the real canvas, and the same pattern
// static-text-reference-node.test.tsx uses. A static `nodes={[...]}` literal
// has nowhere for an internal updateNodeData change to flow back to.
function renderInCanvas(initialNodes: Node[], initialEdges: Edge[] = []) {
  let latestNodes: Node[] = initialNodes;

  function TestCanvas() {
    const [nodes, , onNodesChange] = useNodesState<Node>(initialNodes);
    const [edges, , onEdgesChange] = useEdgesState<Edge>(initialEdges);
    latestNodes = nodes;
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

  const utils = render(
    <ReactFlowProvider>
      <TestCanvas />
    </ReactFlowProvider>,
  );

  return { ...utils, getNodes: () => latestNodes };
}

function renderNode(data: StaticMediaReferenceNodeData = { asset: null }) {
  return renderInCanvas([
    {
      id: "n1",
      type: "staticMediaReference",
      position: { x: 0, y: 0 },
      // jsdom has no layout engine, so give the node an explicit size —
      // otherwise @xyflow/react never marks it "measured" and renders it
      // `visibility: hidden`, which accessible queries correctly skip.
      initialWidth: 260,
      initialHeight: 220,
      data,
    },
  ]);
}

describe("StaticMediaReferenceNode layout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ADR-0003: a Static Media Reference's output data type isn't known until
  // an asset is chosen, so it has no connectable output at all before then
  // — rendering an always-present Handle would offer a connection the graph
  // already refuses (connection-rules.ts rejects a null sourceDataType).
  it("renders no handle at all until an asset is chosen", () => {
    const { container } = renderNode();

    expect(container.querySelectorAll(".react-flow__handle")).toHaveLength(0);
  });

  it("renders exactly one handle, marked as a source (output only), once an asset is chosen", () => {
    const { container } = renderNode({
      asset: { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    });

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles).toHaveLength(1);
    expect(handles[0]).toHaveClass("source");
    expect(handles[0]).not.toHaveClass("target");
  });

  it("shows a prompt to choose an asset when none is selected yet", () => {
    renderNode();

    expect(screen.getByRole("button", { name: /choose asset/i })).toBeInTheDocument();
  });

  it("displays the chosen image asset", () => {
    renderNode({
      asset: { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    });

    const image = screen.getByRole("img", { name: "cat.png" });
    expect(image).toHaveAttribute("src", "https://blob.example/cat.png");
  });

  it("displays the chosen video asset with a video element", () => {
    const { container } = renderNode({
      asset: { url: "https://blob.example/clip.mp4", name: "clip.mp4", type: "video", uploadedAt: "2024-01-01" },
    });

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "https://blob.example/clip.mp4");
  });
});

describe("StaticMediaReferenceNode picker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists assets via the listAssetsAction server action, not a browser-side Asset Library call", async () => {
    const listSpy = vi.spyOn(libraryActions, "listAssetsAction").mockResolvedValue([
      { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    ]);
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: /choose asset/i }));

    expect(await screen.findByRole("button", { name: "cat.png" })).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalled();
  });

  it("selecting a library asset writes it through to the node's data.asset", async () => {
    vi.spyOn(libraryActions, "listAssetsAction").mockResolvedValue([
      { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    ]);
    const user = userEvent.setup();
    const { getNodes } = renderNode();

    await user.click(screen.getByRole("button", { name: /choose asset/i }));
    await user.click(await screen.findByRole("button", { name: "cat.png" }));

    expect(await screen.findByRole("img", { name: "cat.png" })).toHaveAttribute(
      "src",
      "https://blob.example/cat.png",
    );
    const [node] = getNodes();
    expect((node.data as StaticMediaReferenceNodeData).asset).toMatchObject({
      url: "https://blob.example/cat.png",
      name: "cat.png",
    });
  });

  it("uploads a new asset via the uploadAssetAction server action and writes it through to data.asset", async () => {
    vi.spyOn(libraryActions, "listAssetsAction").mockResolvedValue([]);
    const uploadSpy = vi.spyOn(libraryActions, "uploadAssetAction").mockResolvedValue({
      url: "https://blob.example/new-dog.png",
      name: "dog.png",
      type: "image",
      uploadedAt: "2024-01-02",
    });
    const user = userEvent.setup();
    const { getNodes } = renderNode();

    await user.click(screen.getByRole("button", { name: /choose asset/i }));
    const file = new File(["bytes"], "dog.png", { type: "image/png" });
    const input = await screen.findByLabelText(/upload/i);
    await user.upload(input, file);

    expect(await screen.findByRole("img", { name: "dog.png" })).toHaveAttribute(
      "src",
      "https://blob.example/new-dog.png",
    );
    expect(uploadSpy).toHaveBeenCalledWith(file);
    const [node] = getNodes();
    expect((node.data as StaticMediaReferenceNodeData).asset).toMatchObject({
      url: "https://blob.example/new-dog.png",
      name: "dog.png",
    });
  });
});

describe("StaticMediaReferenceNode typeHint (Handle-Spawned Node, ADR-0003)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A Handle-Spawned Static Media Reference (issue #17) opens its Asset
  // Picker immediately with a type hint restricting the choice to the
  // dragged handle's data type, so the user can't pick a mismatched asset.
  it("excludes assets that don't match forcedOpenTypeHint from the rendered grid", async () => {
    vi.spyOn(libraryActions, "listAssetsAction").mockResolvedValue([
      { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
      { url: "https://blob.example/clip.mp4", name: "clip.mp4", type: "video", uploadedAt: "2024-01-01" },
    ]);
    renderInCanvas(
      [
        {
          id: "n1",
          type: "staticMediaReference",
          position: { x: 0, y: 0 },
          initialWidth: 260,
          initialHeight: 220,
          data: { asset: null, forcedOpenTypeHint: "video" },
        },
      ],
    );

    expect(await screen.findByRole("button", { name: "clip.mp4" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "cat.png" })).not.toBeInTheDocument();
    });
  });

  it("opens the picker immediately (forced open) when data.forcedOpenTypeHint is set, without a click", async () => {
    vi.spyOn(libraryActions, "listAssetsAction").mockResolvedValue([]);
    renderInCanvas(
      [
        {
          id: "n1",
          type: "staticMediaReference",
          position: { x: 0, y: 0 },
          initialWidth: 260,
          initialHeight: 220,
          data: { asset: null, forcedOpenTypeHint: "image" },
        },
      ],
    );

    expect(await screen.findByText(/choose an asset/i)).toBeInTheDocument();
  });
});
