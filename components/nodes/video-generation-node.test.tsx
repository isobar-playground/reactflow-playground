import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import * as generationMock from "@/lib/generation-mock";
import * as modelsActions from "@/app/models-actions";
import * as falSchema from "@/lib/fal-schema";
import * as falPricing from "@/lib/fal-pricing";
import { VideoGenerationNode, type VideoGenerationNodeData } from "./video-generation-node";
import { StaticTextReferenceNode } from "./static-text-reference-node";
import { StaticMediaReferenceNode } from "./static-media-reference-node";
import type { Model } from "@/lib/fal-models";

vi.mock("@/app/models-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/models-actions")>();
  return {
    ...actual,
    approvedModelsForKind: vi.fn().mockResolvedValue([]),
  };
});

const nodeTypes = {
  videoGeneration: VideoGenerationNode,
  staticTextReference: StaticTextReferenceNode,
  staticMediaReference: StaticMediaReferenceNode,
};

// Node data write-through (ADR-0002) only round-trips back into a controlled
// input when React Flow's nodes/edges are owned by useNodesState/
// useEdgesState with onNodesChange/onEdgesChange wired through — the same
// way components/canvas-editor.tsx wires the real canvas. A static
// `nodes={[...]}` literal has nowhere for an internal updateNodeData/addNodes
// change to flow back to.
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

function renderNode(
  data: VideoGenerationNodeData = { prompt: "", history: { entries: [], activeId: null } },
) {
  return renderInCanvas([
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
  ]);
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

  it("renders a source output handle and no target handles before a Model is selected", () => {
    const { container } = renderNode();

    const sourceHandles = container.querySelectorAll(".react-flow__handle.source");
    expect(sourceHandles).toHaveLength(1);
    const targetHandles = container.querySelectorAll(".react-flow__handle.target");
    expect(targetHandles).toHaveLength(0);
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
  it("falls back to the connection-derived text-to-video label when no Model is selected", () => {
    renderNode();

    expect(screen.getByText("Text → Video")).toBeInTheDocument();
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
        data: {
          prompt: "driving fast",
          history: { entries: [], activeId: null },
          model: {
            endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
            name: "Kling Video",
            category: "image-to-video",
            handles: [],
          },
        },
      },
    ];
    const edges: Edge[] = [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("a red car driving fast")).toBeInTheDocument();
  });
});

describe("VideoGenerationNode variant cloning (issue #12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a variant counter defaulting to 1", () => {
    renderNode();

    expect(screen.getByRole("spinbutton", { name: /variant/i })).toHaveValue(1);
  });

  it("clones (count - 1) siblings beside the node when the counter is above one and Generate is clicked", async () => {
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

    // A counter of 3 means 3 variants *total* — this node counts as one of
    // them, so only 2 new siblings are cloned beside it.
    await waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(3);
    });
    await waitFor(() => {
      expect(container.querySelectorAll("video")).toHaveLength(2);
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
    await user.type(counter, "3");
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

  // ADR-0002: node `data` is the single source of truth for persisted canvas
  // content, so typing into the prompt field must write through to
  // `data.prompt` — not just local component state. Verified via
  // getNode(id), not the DOM value alone.
  it("writes a typed prompt through to node data", async () => {
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNode } = useReactFlow();
      getNodeRef = getNode as (id: string) => Node | undefined;
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    const prompt = screen.getByPlaceholderText(/prompt/i);
    await user.type(prompt, "driving fast");

    await waitFor(() => {
      expect((getNodeRef?.("n1")?.data as VideoGenerationNodeData).prompt).toBe("driving fast");
    });
  });

  // ADR-0002 / issue #16: History and the Active Output must live in
  // `data.history`, not local component state, or they vanish on reload.
  // Verified via getNode(id), not the DOM alone.
  it("writes a generated History entry through to node data", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "driving fast", history: { entries: [], activeId: null } },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNode } = useReactFlow();
      getNodeRef = getNode as (id: string) => Node | undefined;
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.history.activeId).toBe(data.history.entries[0].id);
      expect(data.history.entries[0].output.url).toBe("/sample-video.mp4");
    });
  });

  it("writes the restored prompt and activeId through to node data when selecting an older History entry", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder")
      .mockResolvedValueOnce({ kind: "video", url: "/sample-video-a.mp4" })
      .mockResolvedValueOnce({ kind: "video", url: "/sample-video-b.mp4" });
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNode } = useReactFlow();
      getNodeRef = getNode as (id: string) => Node | undefined;
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    const promptField = screen.getByPlaceholderText(/prompt/i);
    await user.type(promptField, "first prompt");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
    });

    await user.clear(promptField);
    await user.type(promptField, "second prompt");
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.history.entries).toHaveLength(2);
    });

    // Video History thumbnails render as <video>, not <img> — query by the
    // history carousel container instead of the img role.
    const historyButtons = screen.getAllByRole("button").filter((btn) =>
      btn.querySelector("video"),
    );
    await user.click(historyButtons[0]);

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.prompt).toBe("first prompt");
      expect(data.history.activeId).toBe(data.history.entries[0].id);
      expect(data.history.entries).toHaveLength(2);
    });
  });
});

describe("VideoGenerationNode Model picker (issue #31)", () => {
  const kling: Model = {
    endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
    name: "Kling Video v3 Pro",
    category: "image-to-video",
    description: "",
    tags: [],
  };
  const veo: Model = {
    endpointId: "fal-ai/veo/text-to-video",
    name: "Veo Text-to-Video",
    category: "text-to-video",
    description: "",
    tags: [],
  };

  // Mirrors ImageGenerationNode's #29/#30 tests: selecting a Model also
  // fetches its schema to derive and snapshot handles, and (issue #37) its
  // pricing entry, so stub both with no media inputs / no pricing to keep
  // the picker/label bookkeeping tests focused and network-free.
  beforeEach(() => {
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only Approved video-output Models fetched via approvedModelsForKind", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling, veo]);
    renderNode();

    expect(modelsActions.approvedModelsForKind).toHaveBeenCalledWith("video");
    expect(await screen.findByRole("option", { name: "Kling Video v3 Pro" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Veo Text-to-Video" })).toBeInTheDocument();
  });

  it("shows a 'select a model' state before a Model is chosen", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    renderNode();

    await screen.findByRole("option", { name: "Kling Video v3 Pro" });
    expect(screen.getByText(/select a model to configure/i)).toBeInTheDocument();
  });

  it("shows an empty hint pointing at /models when there are no Approved video Models", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([]);
    renderNode();

    const hint = await screen.findByText(/no approved.*models/i);
    expect(hint).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /models/i });
    expect(link).toHaveAttribute("href", "/models");
  });

  it("selecting a Model stores endpointId, name and category in node data via updateNodeData", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling, veo]);
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNode } = useReactFlow();
      getNodeRef = getNode as (id: string) => Node | undefined;
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    await screen.findByRole("option", { name: "Kling Video v3 Pro" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/kling-video/v3/pro/image-to-video");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.model).toEqual({
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: false,
        pricing: null,
        defaultDurationSeconds: undefined,
      });
    });
  });

  it("shows the selected Model's category as the node's label instead of the connection-derived mode", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling, veo]);
    const user = userEvent.setup();
    renderNode();

    await screen.findByRole("option", { name: "Kling Video v3 Pro" });
    expect(screen.getByText("Text → Video")).toBeInTheDocument();

    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/kling-video/v3/pro/image-to-video");

    await waitFor(() => {
      expect(screen.getByText("Image → Video")).toBeInTheDocument();
    });
  });

  it("restores a saved Model selection on reload without refetching the picker's answer", () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: false,
      },
    });

    expect(screen.getByText("Image → Video")).toBeInTheDocument();
    expect(screen.queryByText(/select a model/i)).not.toBeInTheDocument();
  });

  it("preserves the selected Model when the node is cloned as a Variant", async () => {
    vi.spyOn(generationMock, "generateVideoPlaceholder").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "videoGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: {
          prompt: "",
          history: { entries: [], activeId: null },
          model: {
            endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
            name: "Kling Video v3 Pro",
            category: "image-to-video",
            handles: [],
          },
        },
      },
    ]);

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(document.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(2);
    });
    const labels = screen.getAllByText("Image → Video");
    expect(labels).toHaveLength(2);
  });
});

describe("VideoGenerationNode schema-derived Input Handles (issue #31)", () => {
  const kling: Model = {
    endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
    name: "Kling Video v3 Pro",
    category: "image-to-video",
    description: "",
    tags: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders no input handles before a Model is selected", () => {
    const { container } = renderNode();

    const targetHandles = container.querySelectorAll(".react-flow__handle.target");
    expect(targetHandles).toHaveLength(0);
    expect(container.querySelectorAll(".react-flow__handle.source")).toHaveLength(1);
  });

  it("fetches the selected Model's schema and snapshots the resolved handles into node data", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    const fetchSchema = vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({
      paths: {
        "/fal-ai/kling-video/v3/pro/image-to-video": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/KlingInput" } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          KlingInput: {
            properties: {
              start_image_url: { type: "string" },
              end_image_url: { type: "string" },
            },
          },
        },
      },
    });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNode } = useReactFlow();
      getNodeRef = getNode as (id: string) => Node | undefined;
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    await screen.findByRole("option", { name: "Kling Video v3 Pro" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/kling-video/v3/pro/image-to-video");

    expect(fetchSchema).toHaveBeenCalledWith("fal-ai/kling-video/v3/pro/image-to-video");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.model?.handles).toEqual(
        expect.arrayContaining([
          { handleId: "start_image_url", label: "start_image_url", dataType: "image", many: false },
          { handleId: "end_image_url", label: "end_image_url", dataType: "image", many: false },
        ]),
      );
    });
  });

  it("renders a handle for each snapshotted entry", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [
          { handleId: "start_image_url", label: "start_image_url", dataType: "image", many: false },
          { handleId: "end_image_url", label: "end_image_url", dataType: "image", many: false },
        ],
        hasNegativePrompt: false,
      },
    });

    expect(
      document.querySelector('.react-flow__handle[data-handleid="start_image_url"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('.react-flow__handle[data-handleid="end_image_url"]'),
    ).not.toBeNull();
    expect(document.querySelector('.react-flow__handle[data-handleid="text"]')).not.toBeNull();
  });

  it("renders handles from the snapshot on reload without re-contacting FAL", () => {
    const fetchSchema = vi.spyOn(falSchema, "fetchModelInputSchema");
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [
          { handleId: "start_image_url", label: "start_image_url", dataType: "image", many: false },
        ],
        hasNegativePrompt: false,
      },
    });

    expect(
      document.querySelector('.react-flow__handle[data-handleid="start_image_url"]'),
    ).not.toBeNull();
    expect(fetchSchema).not.toHaveBeenCalled();
  });
});

describe("VideoGenerationNode edge reconciliation on Model change (issue #33)", () => {
  const kling: Model = {
    endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
    name: "Kling Video v3 Pro",
    category: "image-to-video",
    description: "",
    tags: [],
  };
  const textToVideoModel: Model = {
    endpointId: "fal-ai/text-to-video-only",
    name: "Text To Video Only",
    category: "text-to-video",
    description: "",
    tags: [],
  };

  const klingSchema = {
    paths: {
      "/fal-ai/kling-video/v3/pro/image-to-video": {
        post: {
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/KlingInput" } } },
          },
        },
      },
    },
    components: {
      schemas: {
        KlingInput: {
          properties: {
            start_image_url: { type: "string" },
            end_image_url: { type: "string" },
          },
        },
      },
    },
  };
  // A Model whose schema has no media inputs at all (pure text-to-video) —
  // switching to it should drop an edge into start_image_url, since that
  // handle no longer exists.
  const textToVideoSchema = {
    paths: {
      "/fal-ai/text-to-video-only": {
        post: {
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/T2VInput" } } },
          },
        },
      },
    },
    components: {
      schemas: {
        T2VInput: { properties: { prompt: { type: "string" } } },
      },
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithConnectedReferences(initialModel: VideoGenerationNodeData["model"]) {
    const user = userEvent.setup();
    let getEdgesRef: (() => Edge[]) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "media1",
          type: "staticMediaReference",
          position: { x: -300, y: 0 },
          initialWidth: 200,
          initialHeight: 200,
          data: { asset: { id: "a1", type: "image", url: "https://example.com/a.png", name: "a.png" } },
        },
        {
          id: "text1",
          type: "staticTextReference",
          position: { x: -300, y: 300 },
          initialWidth: 200,
          initialHeight: 150,
          data: { text: "a description" },
        },
        {
          id: "gen1",
          type: "videoGeneration",
          position: { x: 200, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null }, model: initialModel },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([
        { id: "e-media", source: "media1", target: "gen1", targetHandle: "start_image_url" },
        { id: "e-text", source: "text1", target: "gen1", targetHandle: "text" },
      ]);
      const { getEdges } = useReactFlow();
      getEdgesRef = getEdges as () => Edge[];
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    return { user, getEdgesRef: () => getEdgesRef! };
  }

  it("drops an input edge whose handle is absent from the newly-selected Model's schema", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling, textToVideoModel]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockImplementation(async (endpointId: string) =>
      endpointId === "fal-ai/kling-video/v3/pro/image-to-video" ? klingSchema : textToVideoSchema,
    );
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const { user, getEdgesRef } = renderWithConnectedReferences({
      endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
      name: "Kling Video v3 Pro",
      category: "image-to-video",
      handles: [{ handleId: "start_image_url", label: "start_image_url", dataType: "image", many: false }],
      hasNegativePrompt: false,
    });

    expect(getEdgesRef()()).toHaveLength(2);

    const picker = await screen.findByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/text-to-video-only");

    await waitFor(() => {
      expect(getEdgesRef()().map((e) => e.id)).toEqual(["e-text"]);
    });
  });

  it("keeps input edges whose handle is still present and type-compatible after re-selecting the same Model", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue(klingSchema);
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const { user, getEdgesRef } = renderWithConnectedReferences({
      endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
      name: "Kling Video v3 Pro",
      category: "image-to-video",
      handles: [{ handleId: "start_image_url", label: "start_image_url", dataType: "image", many: false }],
      hasNegativePrompt: false,
    });

    const picker = await screen.findByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/kling-video/v3/pro/image-to-video");

    await waitFor(() => {
      expect(getEdgesRef()().map((e) => e.id).sort()).toEqual(["e-media", "e-text"]);
    });
  });
});

describe("VideoGenerationNode negative-prompt config field (issue #32)", () => {
  const kling: Model = {
    endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
    name: "Kling Video v3 Pro",
    category: "image-to-video",
    description: "",
    tags: [],
  };
  const veo: Model = {
    endpointId: "fal-ai/veo",
    name: "Veo",
    category: "text-to-video",
    description: "",
    tags: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no negative-prompt field before a Model is selected", () => {
    renderNode();

    expect(screen.queryByLabelText(/negative prompt/i)).not.toBeInTheDocument();
  });

  it("shows the negative-prompt field once a selected Model's schema has hasNegativePrompt: true", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: true,
      },
    });

    expect(screen.getByLabelText(/negative prompt/i)).toBeInTheDocument();
  });

  it("hides the negative-prompt field for a selected Model whose schema has no negative_prompt", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/veo",
        name: "Veo",
        category: "text-to-video",
        handles: [],
        hasNegativePrompt: false,
      },
    });

    expect(screen.queryByLabelText(/negative prompt/i)).not.toBeInTheDocument();
  });

  it("fetches the selected Model's schema and derives hasNegativePrompt, snapshotting it into node data", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({
      paths: {
        "/fal-ai/kling-video/v3/pro/image-to-video": {
          post: {
            requestBody: {
              content: { "application/json": { schema: { $ref: "#/components/schemas/In" } } },
            },
          },
        },
      },
      components: {
        schemas: {
          In: {
            properties: {
              prompt: { type: "string" },
              negative_prompt: { type: "string" },
              start_image_url: { type: "string" },
            },
          },
        },
      },
    });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const user = userEvent.setup();
    renderNode();

    await screen.findByRole("option", { name: "Kling Video v3 Pro" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/kling-video/v3/pro/image-to-video");

    expect(await screen.findByLabelText(/negative prompt/i)).toBeInTheDocument();
  });

  it("does not show the field for a Model whose schema lacks negative_prompt", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([veo]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const user = userEvent.setup();
    renderNode();

    await screen.findByRole("option", { name: "Veo" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/veo");

    await waitFor(() => {
      expect(screen.queryByText(/select a model to configure/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/negative prompt/i)).not.toBeInTheDocument();
  });

  it("stores the negative-prompt value in node data via updateNodeData", async () => {
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: {
            prompt: "",
            history: { entries: [], activeId: null },
            model: {
              endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
              name: "Kling Video v3 Pro",
              category: "image-to-video",
              handles: [],
              hasNegativePrompt: true,
            },
          },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNode } = useReactFlow();
      getNodeRef = getNode as (id: string) => Node | undefined;
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
    render(
      <ReactFlowProvider>
        <TestCanvas />
      </ReactFlowProvider>,
    );

    const field = screen.getByLabelText(/negative prompt/i);
    await user.type(field, "blurry, low quality");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.negativePrompt).toBe("blurry, low quality");
    });
  });

  it("persists the negative-prompt value on reload", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: true,
      },
      negativePrompt: "blurry, low quality",
    });

    expect(screen.getByLabelText(/negative prompt/i)).toHaveValue("blurry, low quality");
  });

  it("does not include the negative prompt in the Resolved Prompt preview", () => {
    renderNode({
      prompt: "a dog running",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: true,
      },
      negativePrompt: "blurry, low quality",
    });

    const resolvedPromptHeading = screen.getByText("Resolved Prompt");
    const resolvedPromptBlock = resolvedPromptHeading.parentElement as HTMLElement;
    expect(within(resolvedPromptBlock).getByText("a dog running")).toBeInTheDocument();
    expect(within(resolvedPromptBlock).queryByText(/blurry/i)).not.toBeInTheDocument();
  });
});

// Estimated Price (CONTEXT.md / ADR-0009, issue #37): shown next to Generate
// once the selected Model has a snapshotted pricing entry — for video,
// per-second pricing is the common case, using the schema's default
// duration.
describe("VideoGenerationNode Estimated Price (issue #37)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no estimate when the selected Model has no pricing snapshot", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: false,
      },
    });

    expect(screen.queryByText(/est\.?\s*~?\$/i)).not.toBeInTheDocument();
  });

  it("shows the estimate for a per-second-priced Model using the schema's default duration", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: false,
        pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" },
        defaultDurationSeconds: 5,
      },
    });

    expect(screen.getByText("Est. ~$0.70")).toBeInTheDocument();
  });

  it("updates the estimate live when the variant count changes", async () => {
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
        name: "Kling Video v3 Pro",
        category: "image-to-video",
        handles: [],
        hasNegativePrompt: false,
        pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" },
        defaultDurationSeconds: 5,
      },
    });

    expect(screen.getByText("Est. ~$0.70")).toBeInTheDocument();

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");

    expect(screen.getByText("Est. ~$1.40")).toBeInTheDocument();
  });
});
