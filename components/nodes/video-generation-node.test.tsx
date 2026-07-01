import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
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
