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
import * as realGeneration from "@/lib/real-generation";
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

vi.mock("@/lib/real-generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/real-generation")>();
  return {
    ...actual,
    runVideoGeneration: vi.fn(),
    resumeVideoGeneration: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

const nodeTypes = {
  videoGeneration: VideoGenerationNode,
  staticTextReference: StaticTextReferenceNode,
  staticMediaReference: StaticMediaReferenceNode,
};

// A selected Model (CONTEXT.md / ADR-0009): Generate is disabled without one
// (issue #39), so every test that actually clicks Generate/Regenerate needs
// one in its node data — only the "no Model selected yet" tests omit it.
const testModel: VideoGenerationNodeData["model"] = {
  endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
  name: "Kling Video v3 Pro",
  category: "image-to-video",
  handles: [],
  hasNegativePrompt: false,
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

async function chooseModel(user: ReturnType<typeof userEvent.setup>, name: string) {
  const trigger = await screen.findByRole("button", { name: /video model picker/i });
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: (accessibleName) => accessibleName.includes(name) }));
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

  it("lets the user type into the prompt field", async () => {
    const user = userEvent.setup();
    renderNode();

    const prompt = screen.getByPlaceholderText(/prompt/i);
    await user.type(prompt, "a flying camera");

    expect(prompt).toHaveValue("a flying camera");
  });

  it("uses a media-first card with stable video preview space and compact generation metadata", () => {
    renderNode({
      prompt: "a flying camera",
      history: {
        entries: [
          {
            id: "a",
            prompt: "a flying camera",
            output: { kind: "video", url: "https://fal.media/a.mp4" },
            actualCost: 0.42,
          },
        ],
        activeId: "a",
      },
      model: {
        ...testModel,
        pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" },
        defaultDurationSeconds: 3,
      },
    });

    const node = document.querySelector('[data-node-id="n1"]') as HTMLElement;
    const preview = within(node).getByLabelText("Video generation preview");
    expect(preview).toHaveClass("aspect-video");
    const video = within(preview).getByLabelText("Generation video output");
    expect(video).toHaveAttribute("src", "https://fal.media/a.mp4");
    expect(video).toHaveAttribute("playsinline");
    expect(within(node).getAllByText("Kling Video v3 Pro").length).toBeGreaterThan(0);
    expect(within(node).getByText("Ready")).toBeInTheDocument();
    expect(within(node).getByText("Est. ~$0.42")).toBeInTheDocument();
    expect(within(node).getByText("$0.42")).toBeInTheDocument();
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
    let resolveGeneration!: (result: { kind: "video"; url: string }) => void;
    vi.spyOn(realGeneration, "runVideoGeneration").mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    const user = userEvent.setup();
    const { container } = renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

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
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});

describe("VideoGenerationNode advanced drawer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens and closes a node-level drawer with negative prompt, resolved prompt, model details, status, errors, and full History", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockRejectedValue(new Error("FAL queue rejected"));
    const user = userEvent.setup();
    renderNode({
      prompt: "local prompt",
      history: {
        entries: [
          {
            id: "a",
            prompt: "first prompt",
            output: { kind: "video", url: "https://fal.media/a.mp4" },
            actualCost: 0.2,
          },
          {
            id: "b",
            prompt: "second prompt",
            output: { kind: "video", url: "https://fal.media/b.mp4" },
            actualCost: 0.4,
          },
        ],
        activeId: "b",
      },
      model: {
        ...testModel,
        endpointId: "fal-ai/has-negative-prompt-video",
        name: "Has Negative Prompt Video",
        hasNegativePrompt: true,
        pricing: { unitPrice: 0.2, unit: "seconds", currency: "USD" },
      },
      negativePrompt: "shaky",
    });

    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Negative prompt")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
    const drawer = screen.getByRole("region", { name: "Advanced video generation settings" });
    expect(within(drawer).getByLabelText("Negative prompt")).toHaveValue("shaky");
    expect(within(drawer).getByText("local prompt")).toBeInTheDocument();
    expect(within(drawer).getByText("fal-ai/has-negative-prompt-video")).toBeInTheDocument();
    expect(within(drawer).getAllByText("Error").length).toBeGreaterThan(0);
    expect(within(drawer).getByText("FAL queue rejected")).toBeInTheDocument();
    expect(within(drawer).getByText("first prompt")).toBeInTheDocument();
    expect(within(drawer).getByText("second prompt")).toBeInTheDocument();
    expect(within(drawer).getByText("$0.20")).toBeInTheDocument();
    expect(within(drawer).getByText("$0.40")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close advanced settings" }));
    expect(screen.queryByRole("region", { name: "Advanced video generation settings" })).not.toBeInTheDocument();
  });

  it("edits the negative prompt through the advanced drawer and writes it to node data", async () => {
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
              endpointId: "fal-ai/has-negative-prompt-video",
              name: "Has Negative Prompt Video",
              category: "text-to-video",
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

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
    await user.type(screen.getByLabelText("Negative prompt"), "shaky, blurry");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.negativePrompt).toBe("shaky, blurry");
    });
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
      .spyOn(realGeneration, "runVideoGeneration")
      .mockResolvedValue({ kind: "video", url: "/sample-video.mp4" });
    const user = userEvent.setup();
    const { container } = renderInCanvas([
      {
        id: "n1",
        type: "videoGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null }, model: testModel },
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
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(counter).toHaveValue(1);
    });
  });

  it("behaves exactly as a normal Generate when the counter is left at 1 (no cloning)", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    const { container } = renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(container.querySelectorAll("video")).toHaveLength(1);
    });
  });

  it("wires each clone to the original's incoming Static Text Reference, without duplicating any outgoing edge", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
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
          data: { prompt: "", history: { entries: [], activeId: null }, model: testModel },
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
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
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
          data: { prompt: "driving fast", history: { entries: [], activeId: null }, model: testModel },
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
    vi.spyOn(realGeneration, "runVideoGeneration")
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
          data: { prompt: "", history: { entries: [], activeId: null }, model: testModel },
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
    thumbnailUrl: "https://fal.media/kling.png",
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
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([
      { ...kling, pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" } },
      veo,
    ]);
    const user = userEvent.setup();
    renderNode();

    expect(modelsActions.approvedModelsForKind).toHaveBeenCalledWith("video");
    await user.click(await screen.findByRole("button", { name: /video model picker/i }));
    expect(await screen.findByRole("option", { name: /Kling Video v3 Pro/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Veo Text-to-Video/ })).toBeInTheDocument();
    expect(screen.getByText(/image → video · kling · \$0.14 \/ second/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /model/i })).not.toBeInTheDocument();
  });

  it("shows a 'select a model' state before a Model is chosen", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling]);
    renderNode();

    await screen.findByRole("button", { name: /video model picker/i });
    expect(screen.getByText(/select a model to configure/i)).toBeInTheDocument();
  });

  it("shows an empty hint pointing at /models when there are no Approved video Models", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([]);
    renderNode();

    const hint = await screen.findByText(/no approved.*models/i);
    expect(hint).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /models workspace/i });
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

    await chooseModel(user, "Kling Video v3 Pro");

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

    await screen.findByRole("button", { name: /video model picker/i });
    expect(screen.getByText("Text → Video")).toBeInTheDocument();

    await chooseModel(user, "Kling Video v3 Pro");

    await waitFor(() => {
      expect(screen.getByText("Image → Video")).toBeInTheDocument();
    });
  });

  it("supports keyboard navigation and returns focus to the Model picker trigger after selection", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([kling, veo]);
    const user = userEvent.setup();
    renderNode();

    const trigger = await screen.findByRole("button", { name: /video model picker/i });
    trigger.focus();
    await user.keyboard("[Enter]");
    expect(screen.getByRole("listbox", { name: /video model options/i })).toBeInTheDocument();
    await user.keyboard("[Enter]");

    await waitFor(() => {
      expect(screen.getAllByText("Kling Video v3 Pro").length).toBeGreaterThan(0);
      expect(trigger).toHaveFocus();
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
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
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

    await chooseModel(user, "Kling Video v3 Pro");

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

    await chooseModel(user, "Text To Video Only");

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

    await chooseModel(user, "Kling Video v3 Pro");

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

  it("shows no negative-prompt field before a Model is selected", async () => {
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
    expect(screen.queryByLabelText(/negative prompt/i)).not.toBeInTheDocument();
  });

  it("shows the negative-prompt field in the advanced drawer once a selected Model's schema has hasNegativePrompt: true", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
    expect(screen.getByLabelText(/negative prompt/i)).toBeInTheDocument();
  });

  it("hides the negative-prompt field for a selected Model whose schema has no negative_prompt", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
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

    await chooseModel(user, "Kling Video v3 Pro");
    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));

    expect(await screen.findByLabelText(/negative prompt/i)).toBeInTheDocument();
  });

  it("does not show the field for a Model whose schema lacks negative_prompt", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([veo]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const user = userEvent.setup();
    renderNode();

    await chooseModel(user, "Veo");

    await waitFor(() => {
      expect(screen.queryByText(/select a model to configure/i)).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
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

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
    const field = screen.getByLabelText(/negative prompt/i);
    await user.type(field, "blurry, low quality");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.negativePrompt).toBe("blurry, low quality");
    });
  });

  it("persists the negative-prompt value on reload", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Open advanced settings" }));
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

// Real FAL generation via the queue API (CONTEXT.md / ADR-0009, issue #39 —
// the video-node equivalent of #36). lib/real-generation.ts is mocked here
// exactly like the old generation-mock module was — these tests only care
// about the node's own behavior (what it sends, what it persists, how it
// reacts to success/failure), not lib/real-generation's or the server
// actions' internals (covered by their own unit tests).
describe("VideoGenerationNode real generation (issue #39)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables Generate when no Model is selected", () => {
    renderNode();

    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("enables Generate once a Model is selected", () => {
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("submits the Resolved Prompt as `prompt`, and negative_prompt when the Model supports it", async () => {
    const run = vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "https://fal.media/out.mp4",
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
          data: {
            prompt: "driving fast",
            history: { entries: [], activeId: null },
            model: { ...testModel, hasNegativePrompt: true },
            negativePrompt: "blurry, low quality",
          },
        },
      ],
      [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }],
    );

    const gen1Container = document.querySelector('[data-node-id="gen1"]') as HTMLElement;
    await user.click(within(gen1Container).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
          prompt: "a red car driving fast",
          negativePrompt: "blurry, low quality",
        }),
        expect.anything(),
      );
    });
  });

  it("omits negativePrompt from the call when the Model's schema has no negative_prompt", async () => {
    const run = vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "https://fal.media/out.mp4",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "a car", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
          prompt: "a car",
          negativePrompt: undefined,
        }),
        expect.anything(),
      );
    });
  });

  it("writes the pending generation record into node data once FAL accepts the request, and clears it once it completes", async () => {
    const pending = {
      requestId: "req-1",
      statusUrl: "https://queue.fal.run/x/status",
      responseUrl: "https://queue.fal.run/x",
    };
    let resolveGeneration!: (result: { kind: "video"; url: string }) => void;
    vi.spyOn(realGeneration, "runVideoGeneration").mockImplementation(async (_input, options) => {
      options?.onPending?.(pending);
      return new Promise((resolve) => {
        resolveGeneration = resolve;
      });
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
          data: { prompt: "a car", history: { entries: [], activeId: null }, model: testModel },
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
      expect(data.pendingGeneration).toEqual(pending);
    });

    resolveGeneration({ kind: "video", url: "https://fal.media/out.mp4" });

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.pendingGeneration).toBeNull();
    });
  });

  it("shows an error message and adds no History entry when the FAL generation fails", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockRejectedValue(
      new Error("FAL queue submit returned 422 for fal-ai/kling-video/v3/pro/image-to-video"),
    );
    const user = userEvent.setup();
    renderNode({ prompt: "a car", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/422/);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("clears a previous error once a subsequent Generate succeeds", async () => {
    const run = vi
      .spyOn(realGeneration, "runVideoGeneration")
      .mockRejectedValueOnce(new Error("moderation blocked the request"))
      .mockResolvedValueOnce({ kind: "video", url: "https://fal.media/out.mp4" });
    const user = userEvent.setup();
    renderNode({ prompt: "a car", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs one independent real generation per clone when generating variants", async () => {
    const run = vi
      .spyOn(realGeneration, "runVideoGeneration")
      .mockResolvedValueOnce({ kind: "video", url: "https://fal.media/c1.mp4" })
      .mockResolvedValueOnce({ kind: "video", url: "https://fal.media/c2.mp4" });
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "videoGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "a car", history: { entries: [], activeId: null }, model: testModel },
      },
    ]);

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ endpointId: "fal-ai/kling-video/v3/pro/image-to-video", prompt: "a car" }),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ endpointId: "fal-ai/kling-video/v3/pro/image-to-video", prompt: "a car" }),
    );
  });

  it("adds no History entry for a clone whose generation fails, while its sibling still gets one", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration")
      .mockResolvedValueOnce({ kind: "video", url: "https://fal.media/c1.mp4" })
      .mockRejectedValueOnce(new Error("FAL error"));
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "videoGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "a car", history: { entries: [], activeId: null }, model: testModel },
      },
    ]);

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(document.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(3);
    });
    // Only one clone got a real output; the other's failed generation added
    // no History entry, so it shows no video output at all.
    await waitFor(() => {
      expect(document.querySelectorAll("video")).toHaveLength(1);
    });
  });
});

// Resuming a pending generation after reload (CONTEXT.md / ADR-0009, issue
// #39 — the video-node equivalent of #38): a Generation Node whose data
// still holds a pendingGeneration record at mount time must pick polling
// back up rather than leaving the node stuck showing nothing, or losing
// track of a run FAL is billing regardless.
describe("VideoGenerationNode resumes a pending generation on mount (issue #39)", () => {
  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the in-progress state immediately, then lands the result in History and clears the pending record", async () => {
    let resolveResume!: (result: { kind: "video"; url: string }) => void;
    vi.spyOn(realGeneration, "resumeVideoGeneration").mockReturnValue(
      new Promise((resolve) => {
        resolveResume = resolve;
      }),
    );
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
            prompt: "a car",
            history: { entries: [], activeId: null },
            model: testModel,
            pendingGeneration: pending,
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

    expect(realGeneration.resumeVideoGeneration).toHaveBeenCalledWith(pending);
    expect(screen.getAllByText(/generating/i).length).toBeGreaterThan(0);

    resolveResume({ kind: "video", url: "https://fal.media/resumed.mp4" });

    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.history.entries[0].output.url).toBe("https://fal.media/resumed.mp4");
      expect(data.pendingGeneration).toBeNull();
    });
  });

  it("clears the pending record and shows the node's normal error state when FAL no longer recognizes the request", async () => {
    vi.spyOn(realGeneration, "resumeVideoGeneration").mockRejectedValue(
      new Error("FAL queue status returned 404"),
    );
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
            prompt: "a car",
            history: { entries: [], activeId: null },
            model: testModel,
            pendingGeneration: pending,
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

    expect(await screen.findByRole("alert")).toHaveTextContent(/404/);
    expect(screen.queryByText(/generating/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as VideoGenerationNodeData;
      expect(data.pendingGeneration).toBeNull();
      expect(data.history.entries).toHaveLength(0);
    });
    expect(realGeneration.resumeVideoGeneration).toHaveBeenCalledTimes(1);
  });

  it("does not call resumeVideoGeneration when the node has no pending record", () => {
    const resume = vi.spyOn(realGeneration, "resumeVideoGeneration");
    renderNode({ prompt: "a car", history: { entries: [], activeId: null }, model: testModel });

    expect(resume).not.toHaveBeenCalled();
  });
});

// Actual Cost (CONTEXT.md / ADR-0009, issue #41): mirrors
// components/nodes/image-generation-node.test.tsx's identical coverage —
// shown with the output once a generation completes, billable units × the
// Model's snapshotted unit price.
describe("VideoGenerationNode Actual Cost (issue #41)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the Actual Cost next to the output once a generation completes", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
      billableUnits: 5,
    });
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" } },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });

    expect(screen.getByText("$0.70")).toBeInTheDocument();
  });

  it("shows no Actual Cost when the result carries no billable-units header", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
    });
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" } },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });

    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("shows no Actual Cost when the Model has no pricing snapshot", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "/sample-video.mp4",
      billableUnits: 5,
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });

    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("shows each carousel entry's own Actual Cost as the active output is flipped through", async () => {
    vi.spyOn(realGeneration, "runVideoGeneration")
      .mockResolvedValueOnce({ kind: "video", url: "/sample-video-a.mp4", billableUnits: 2 })
      .mockResolvedValueOnce({ kind: "video", url: "/sample-video-b.mp4", billableUnits: 4 });
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.1, unit: "seconds", currency: "USD" } },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(document.querySelector("video")).toHaveAttribute("src", "/sample-video-b.mp4");
    });
    expect(screen.getAllByText("$0.40").length).toBeGreaterThan(0);

    const historyButtons = screen.getAllByRole("button").filter((btn) => btn.querySelector("video"));
    await user.click(historyButtons[0]);

    expect(screen.getAllByText("$0.20").length).toBeGreaterThan(0);
  });

  it("persists the Actual Cost across reload (survives via data.history)", () => {
    renderNode({
      prompt: "a car",
      history: {
        entries: [
          { id: "a", prompt: "a car", output: { kind: "video", url: "/sample-video.mp4" }, actualCost: 0.42 },
        ],
        activeId: "a",
      },
      model: testModel,
    });

    expect(screen.getByText("$0.42")).toBeInTheDocument();
  });
});

// Connected media inputs (issue #40 / ADR-0009, PRD #35): mirrors
// components/nodes/image-generation-node.test.tsx's identical coverage —
// this node's own tests only check that it gathers and forwards the right
// connections; lib/generation-payload.ts's own tests cover the actual
// handle->field mapping.
describe("VideoGenerationNode connected media inputs (issue #40)", () => {
  const imageToVideoModel: VideoGenerationNodeData["model"] = {
    endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
    name: "Kling v3 Pro",
    category: "image-to-video",
    handles: [{ handleId: "startFrame", label: "startFrame", dataType: "image", many: false }],
    hasNegativePrompt: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a Static Media Reference wired into a media handle as a media connection", async () => {
    const run = vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "https://fal.media/out.mp4",
    });
    const user = userEvent.setup();
    renderInCanvas(
      [
        {
          id: "media1",
          type: "staticMediaReference",
          position: { x: -300, y: 0 },
          initialWidth: 200,
          initialHeight: 200,
          data: { asset: { url: "/uploads/frame.png", name: "frame.png", type: "image" } },
        },
        {
          id: "gen1",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "a car driving", history: { entries: [], activeId: null }, model: imageToVideoModel },
        },
      ],
      [{ id: "e1", source: "media1", target: "gen1", targetHandle: "startFrame" }],
    );

    await user.click(within(document.querySelector('[data-node-id="gen1"]') as HTMLElement).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
          prompt: "a car driving",
          media: [
            expect.objectContaining({
              handle: expect.objectContaining({ handleId: "startFrame" }),
              sources: [
                expect.objectContaining({
                  type: "staticMediaReference",
                  data: { asset: { url: "/uploads/frame.png", name: "frame.png", type: "image" } },
                }),
              ],
            }),
          ],
        }),
        expect.anything(),
      );
    });
  });

  it("forwards an empty sources array for a media handle with nothing connected", async () => {
    const run = vi.spyOn(realGeneration, "runVideoGeneration").mockResolvedValue({
      kind: "video",
      url: "https://fal.media/out.mp4",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "a car driving", history: { entries: [], activeId: null }, model: imageToVideoModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          media: [expect.objectContaining({ handle: expect.objectContaining({ handleId: "startFrame" }), sources: [] })],
        }),
        expect.anything(),
      );
    });
  });
});
