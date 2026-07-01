import { describe, it, expect, vi, afterEach } from "vitest";
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
import * as generationMock from "@/lib/generation-mock";
import { VideoGenerationNode, type VideoGenerationNodeData } from "./video-generation-node";
import { StaticTextReferenceNode } from "./static-text-reference-node";
import { StaticMediaReferenceNode } from "./static-media-reference-node";

const nodeTypes = {
  videoGeneration: VideoGenerationNode,
  staticTextReference: StaticTextReferenceNode,
  staticMediaReference: StaticMediaReferenceNode,
};

function renderNode(
  data: VideoGenerationNodeData = { prompt: "", history: { entries: [], activeId: null } },
) {
  const nodes = [
    {
      id: "n1",
      type: "videoGeneration",
      position: { x: 0, y: 0 },
      // jsdom has no layout engine, so give the node an explicit size —
      // otherwise @xyflow/react never marks it "measured" and renders it
      // `visibility: hidden`, which accessible queries correctly skip.
      initialWidth: 400,
      initialHeight: 500,
      data,
    },
  ];
  return render(
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} />
    </ReactFlowProvider>,
  );
}

function renderWithNodes(nodes: Node[], edges: Edge[]) {
  return render(
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
    </ReactFlowProvider>,
  );
}

describe("VideoGenerationNode layout", () => {
  it("renders a title, a prompt field, and a Generate button", () => {
    renderNode();

    expect(screen.getByText("Video Generation Node")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/prompt/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("renders a source output handle plus the five named target handles", () => {
    const { container } = renderNode();

    const sourceHandles = container.querySelectorAll(".react-flow__handle.source");
    expect(sourceHandles).toHaveLength(1);

    for (const handleId of ["text", "startFrame", "endFrame", "imageReference", "video"]) {
      expect(
        container.querySelector(`.react-flow__handle[data-handleid="${handleId}"]`),
      ).not.toBeNull();
    }
  });
});

describe("VideoGenerationNode generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state then plays the looping placeholder video after clicking Generate", async () => {
    let resolveGeneration!: (result: generationMock.VideoPlaceholderResult) => void;
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    const user = userEvent.setup();
    const { container } = renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(screen.getAllByText(/generating/i).length).toBeGreaterThan(0);

    resolveGeneration({ kind: "video", url: "/sample-video.mp4" });

    await waitFor(() => {
      expect(container.querySelector("video")).not.toBeNull();
    });
    expect(screen.queryByText(/generating/i)).not.toBeInTheDocument();
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "/sample-video.mp4");
    expect(video).toHaveAttribute("loop");
  });

  it("changes the button label to Regenerate after the first output exists", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});

describe("VideoGenerationNode mode (issue #11)", () => {
  it("shows the text-to-video mode label when nothing else is connected", () => {
    renderNode();

    expect(screen.getByText("Text → Video")).toBeInTheDocument();
  });

  it("switches to image-to-video when a startFrame is connected", () => {
    const nodes: Node[] = [
      {
        id: "media1",
        type: "staticMediaReference",
        position: { x: 0, y: 0 },
        initialWidth: 200,
        initialHeight: 200,
        data: { asset: { url: "https://example.com/a.png", name: "a.png", type: "image" } },
      },
      {
        id: "gen1",
        type: "videoGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [{ id: "e1", source: "media1", target: "gen1", targetHandle: "startFrame" }];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("Image → Video")).toBeInTheDocument();
  });

  it("switches to image-to-video when an imageReference is connected", () => {
    const nodes: Node[] = [
      {
        id: "media1",
        type: "staticMediaReference",
        position: { x: 0, y: 0 },
        initialWidth: 200,
        initialHeight: 200,
        data: { asset: { url: "https://example.com/a.png", name: "a.png", type: "image" } },
      },
      {
        id: "gen1",
        type: "videoGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "media1", target: "gen1", targetHandle: "imageReference" },
    ];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("Image → Video")).toBeInTheDocument();
  });

  it("switches to video-to-video when a video is connected", () => {
    const nodes: Node[] = [
      {
        id: "media1",
        type: "staticMediaReference",
        position: { x: 0, y: 0 },
        initialWidth: 200,
        initialHeight: 200,
        data: { asset: { url: "https://example.com/a.mp4", name: "a.mp4", type: "video" } },
      },
      {
        id: "gen1",
        type: "videoGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [{ id: "e1", source: "media1", target: "gen1", targetHandle: "video" }];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("Video → Video")).toBeInTheDocument();
  });
});

describe("VideoGenerationNode text handle and Resolved Prompt", () => {
  it("shows the Resolved Prompt preview combining a connected Static Text Reference with the local prompt", () => {
    const nodes: Node[] = [
      {
        id: "ref1",
        type: "staticTextReference",
        position: { x: 0, y: 0 },
        initialWidth: 200,
        initialHeight: 100,
        data: { text: "a red car" },
      },
      {
        id: "gen1",
        type: "videoGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "driving fast", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("a red car driving fast")).toBeInTheDocument();
  });
});

// Variant cloning (issue #12) adds sibling nodes to the graph via
// useReactFlow's addNodes/addEdges from inside the node component. That only
// takes effect when the surrounding <ReactFlow> is wired the same way
// components/canvas-editor.tsx wires it — nodes/edges owned by
// useNodesState/useEdgesState with onNodesChange/onEdgesChange passed
// through — unlike the static `nodes={[...]}` literal renderNode uses above.
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

describe("VideoGenerationNode variant cloning (issue #12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a variant counter defaulting to 1", () => {
    renderNode();

    expect(screen.getByRole("spinbutton", { name: /variant/i })).toHaveValue(1);
  });

  it("clones the node into that many independent nodes when the counter is above one and Generate is clicked", async () => {
    const generate = vi
      .spyOn(generationMock, "generateVideoPlaceholder")
      .mockResolvedValue({ kind: "video", url: "/sample-video.mp4" });
    const user = userEvent.setup();
    const { container } = renderInCanvas([
      {
        id: "n1",
        type: "videoGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null } },
      },
    ]);

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(3);
    });

    // Three sibling nodes now exist in the graph, each with its own freshly
    // generated video output — not a copy of any shared History.
    await waitFor(() => {
      expect(container.querySelectorAll("video")).toHaveLength(3);
    });
  });

  it("resets the variant counter to 1 after cloning", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    renderNode();

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(counter).toHaveValue(1);
    });
  });

  it("behaves exactly as a normal Generate when the counter is left at 1 (no cloning)", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    const { container } = renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(container.querySelectorAll("video")).toHaveLength(1);
    });
  });

  it("wires each clone to the original's incoming Static Text Reference, without duplicating any outgoing edge", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();

    renderInCanvas(
      [
        {
          id: "ref1",
          type: "staticTextReference",
          position: { x: -300, y: 0 },
          initialWidth: 200,
          initialHeight: 100,
          data: { text: "a red car" },
        },
        {
          id: "gen1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
      ],
      [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }],
    );

    const gen1Container = document.querySelector('[data-node-id="gen1"]') as HTMLElement;
    const counter = within(gen1Container).getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(within(gen1Container).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      const nodeContainers = Array.from(
        document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
      );
      const cloneContainers = nodeContainers.filter(
        (el) => !["gen1", "ref1"].includes(el.dataset.id ?? ""),
      );
      expect(cloneContainers).toHaveLength(2);
      for (const clone of cloneContainers) {
        expect(within(clone).getByText("a red car")).toBeInTheDocument();
      }
    });
  });
});

describe("VideoGenerationNode persistence", () => {
  it("restores a saved prompt and active video output without regenerating", () => {
    const { container } = renderNode({
      prompt: "saved prompt",
      history: {
        entries: [{ id: "a", prompt: "saved prompt", output: { kind: "video", url: "/sample-video.mp4" } }],
        activeId: "a",
      },
    });

    expect(screen.getByPlaceholderText(/prompt/i)).toHaveValue("saved prompt");
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "/sample-video.mp4");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});
