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
import { ImageGenerationNode, type ImageGenerationNodeData } from "./image-generation-node";
import { StaticTextReferenceNode } from "./static-text-reference-node";
import { StaticMediaReferenceNode } from "./static-media-reference-node";
import type { Model } from "@/lib/fal-models";
import nanoBanana2EditSchema from "@/lib/__fixtures__/nano-banana-2-edit.json";

vi.mock("@/app/models-actions", () => ({
  approvedModelsForKind: vi.fn().mockResolvedValue([]),
}));

const nodeTypes = {
  imageGeneration: ImageGenerationNode,
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
  data: ImageGenerationNodeData = { prompt: "", history: { entries: [], activeId: null } },
) {
  return renderInCanvas([
    {
      id: "n1",
      type: "imageGeneration",
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

describe("ImageGenerationNode layout", () => {
  it("renders a title, a prompt field, and a Generate button", () => {
    renderNode();

    expect(screen.getByText("Image Generation Node")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/prompt/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("renders a source output handle", () => {
    const { container } = renderNode();

    const sourceHandles = container.querySelectorAll(".react-flow__handle.source");
    expect(sourceHandles).toHaveLength(1);
  });

  it("lets the user type into the prompt field", async () => {
    const user = userEvent.setup();
    renderNode();

    const prompt = screen.getByPlaceholderText(/prompt/i);
    await user.type(prompt, "a cat");

    expect(prompt).toHaveValue("a cat");
  });

});

describe("ImageGenerationNode generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state then the placeholder image after clicking Generate", async () => {
    let resolveGeneration!: (result: generationMock.ImagePlaceholderResult) => void;
    vi.spyOn(generationMock, "generateImagePlaceholder").mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(screen.getAllByText(/generating/i).length).toBeGreaterThan(0);

    resolveGeneration({ kind: "image", url: "https://picsum.photos/seed/abc/768/768" });

    await screen.findByRole("img", { name: /output/i });
    expect(screen.queryByText(/generating/i)).not.toBeInTheDocument();
    const image = await screen.findByRole("img", { name: /output/i });
    expect(image).toHaveAttribute("src", "https://picsum.photos/seed/abc/768/768");
  });

  it("changes the button label to Regenerate after the first output exists", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/abc/768/768",
    });
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});

describe("ImageGenerationNode history carousel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no carousel after the first generation", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/a/768/768",
    });
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });

    expect(screen.queryAllByRole("button", { name: /history/i })).toHaveLength(0);
  });

  it("reveals a carousel with two thumbnails after the second generation", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/a/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/b/768/768" });
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /output/i })).toHaveAttribute(
        "src",
        "https://picsum.photos/seed/b/768/768",
      );
    });

    const thumbnails = screen.getAllByRole("img", { name: /history entry/i });
    expect(thumbnails).toHaveLength(2);
  });

  it("clicking an older thumbnail sets it as the active output and restores its prompt, without regenerating", async () => {
    const generate = vi
      .spyOn(generationMock, "generateImagePlaceholder")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/a/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/b/768/768" });
    const user = userEvent.setup();
    renderNode();

    const promptField = screen.getByPlaceholderText(/prompt/i);
    await user.type(promptField, "first prompt");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });

    await user.clear(promptField);
    await user.type(promptField, "second prompt");
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /output/i })).toHaveAttribute(
        "src",
        "https://picsum.photos/seed/b/768/768",
      );
    });

    expect(generate).toHaveBeenCalledTimes(2);

    const thumbnails = screen.getAllByRole("img", { name: /history entry/i });
    await user.click(thumbnails[0]);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(promptField).toHaveValue("first prompt");
    const mainOutput = screen.getByRole("img", { name: /output/i });
    expect(mainOutput).toHaveAttribute("src", "https://picsum.photos/seed/a/768/768");
  });

  it("has no length limit on history entries", async () => {
    const generate = vi.spyOn(generationMock, "generateImagePlaceholder");
    for (let i = 0; i < 5; i++) {
      generate.mockResolvedValueOnce({ kind: "image", url: `https://picsum.photos/seed/${i}/768/768` });
    }
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: "Regenerate" }));
      await screen.findByRole("button", { name: "Regenerate" });
    }

    const thumbnails = screen.getAllByRole("img", { name: /history entry/i });
    expect(thumbnails).toHaveLength(5);
  });
});

describe("ImageGenerationNode persistence", () => {
  it("restores a saved prompt and active output without regenerating", () => {
    renderNode({
      prompt: "saved prompt",
      history: {
        entries: [{ id: "a", prompt: "saved prompt", output: { kind: "image", url: "https://picsum.photos/seed/xyz/768/768" } }],
        activeId: "a",
      },
    });

    expect(screen.getByPlaceholderText(/prompt/i)).toHaveValue("saved prompt");
    const image = screen.getByRole("img", { name: /output/i });
    expect(image).toHaveAttribute("src", "https://picsum.photos/seed/xyz/768/768");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  // ADR-0002: node `data` is the single source of truth for persisted canvas
  // content, so typing into the prompt field must write through to
  // `data.prompt` — not just local component state — otherwise it never
  // reaches autosave. Verified via getNode(id), not the DOM value alone.
  it("writes a typed prompt through to node data", async () => {
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
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
    await user.type(prompt, "a cat");

    await waitFor(() => {
      expect((getNodeRef?.("n1")?.data as ImageGenerationNodeData).prompt).toBe("a cat");
    });
  });

  // ADR-0002 / issue #16: History and the Active Output must live in
  // `data.history`, not local component state, or they vanish on reload.
  // Verified via getNode(id), not the DOM alone.
  it("writes a generated History entry through to node data", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/abc/768/768",
    });
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "a cat", history: { entries: [], activeId: null } },
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
    await screen.findByRole("img", { name: /output/i });

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.history.activeId).toBe(data.history.entries[0].id);
      expect(data.history.entries[0].output.url).toBe("https://picsum.photos/seed/abc/768/768");
    });
  });

  it("writes the restored prompt and activeId through to node data when selecting an older History entry", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/a/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/b/768/768" });
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
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
    await screen.findByRole("img", { name: /output/i });

    await user.clear(promptField);
    await user.type(promptField, "second prompt");
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.history.entries).toHaveLength(2);
    });

    const thumbnails = screen.getAllByRole("img", { name: /history entry/i });
    await user.click(thumbnails[0]);

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.prompt).toBe("first prompt");
      expect(data.history.activeId).toBe(data.history.entries[0].id);
      expect(data.history.entries).toHaveLength(2);
    });
  });
});

describe("ImageGenerationNode text handle and Resolved Prompt", () => {
  function renderWithTextRef(nodes: Node[], edges: Edge[]) {
    return render(
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
      </ReactFlowProvider>,
    );
  }

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
        type: "imageGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "in a driveway", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [
      {
        id: "e1",
        source: "ref1",
        target: "gen1",
        targetHandle: "text",
      },
    ];

    renderWithTextRef(nodes, edges);

    expect(screen.getByText("a red car in a driveway")).toBeInTheDocument();
  });

  it("concatenates multiple connected text references in edge order before the local prompt", () => {
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
        id: "ref2",
        type: "staticTextReference",
        position: { x: 0, y: 200 },
        initialWidth: 200,
        initialHeight: 100,
        data: { text: "a happy dog" },
      },
      {
        id: "gen1",
        type: "imageGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "combined", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "ref1", target: "gen1", targetHandle: "text" },
      { id: "e2", source: "ref2", target: "gen1", targetHandle: "text" },
    ];

    renderWithTextRef(nodes, edges);

    expect(screen.getByText("a red car a happy dog combined")).toBeInTheDocument();
  });
});

describe("ImageGenerationNode variant cloning (issue #12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a variant counter defaulting to 1", () => {
    renderNode();

    expect(screen.getByRole("spinbutton", { name: /variant/i })).toHaveValue(1);
  });

  it("clones (count - 1) siblings beside the node when the counter is above one and Generate is clicked", async () => {
    const generate = vi
      .spyOn(generationMock, "generateImagePlaceholder")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/c1/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/c2/768/768" });
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "imageGeneration",
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
      expect(document.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(3);
    });
    await waitFor(() => {
      expect(screen.getAllByRole("img", { name: "Generation output" })).toHaveLength(2);
    });
    const outputs = screen.getAllByRole("img", { name: "Generation output" });
    expect(outputs.map((img) => img.getAttribute("src")).sort()).toEqual([
      "https://picsum.photos/seed/c1/768/768",
      "https://picsum.photos/seed/c2/768/768",
    ]);
  });

  it("resets the variant counter to 1 after cloning", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/c1/768/768",
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
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/solo/768/768",
    });
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: "Generate" }));

    const images = await screen.findAllByRole("img", { name: "Generation output" });
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "https://picsum.photos/seed/solo/768/768");
  });

  it("wires each clone to the original's incoming Static Text Reference, without duplicating any outgoing edge", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/c1/768/768",
    });
    const user = userEvent.setup();

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
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
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
        {
          id: "downstream",
          type: "imageGeneration",
          position: { x: 600, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null } },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([
        { id: "e1", source: "ref1", target: "gen1", targetHandle: "text" },
        { id: "e2", source: "gen1", target: "downstream", targetHandle: "image" },
      ]);
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

    // Two nodes of type imageGeneration exist (gen1 and downstream); scope
    // to gen1's own counter/button via its data-node-id.
    const gen1Container = document.querySelector('[data-node-id="gen1"]') as HTMLElement;
    const counter = within(gen1Container).getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(within(gen1Container).getByRole("button", { name: "Generate" }));

    // The two clones are new imageGeneration nodes distinct from gen1 and
    // downstream; each should show the Resolved Prompt from the inherited
    // text edge, proving it was wired to a fresh incoming edge — not to
    // downstream, which never had a text edge in the first place.
    await waitFor(() => {
      const nodeContainers = Array.from(
        document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
      );
      const cloneContainers = nodeContainers.filter(
        (el) => !["gen1", "downstream", "ref1"].includes(el.dataset.id ?? ""),
      );
      expect(cloneContainers).toHaveLength(2);
      for (const clone of cloneContainers) {
        expect(within(clone).getByText("a red car")).toBeInTheDocument();
      }
    });

    // downstream never had a text edge, and outgoing edges from gen1 are
    // never duplicated onto a clone — it must still show no Resolved Prompt.
    const downstreamContainer = document.querySelector('[data-node-id="downstream"]') as HTMLElement;
    expect(within(downstreamContainer).queryByText(/resolved prompt/i)).not.toBeInTheDocument();
  });
});

describe("ImageGenerationNode mode (issue #10)", () => {
  function renderWithNodes(nodes: Node[], edges: Edge[]) {
    return render(
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
      </ReactFlowProvider>,
    );
  }

  it("shows the text-to-image mode label when no image is connected", () => {
    renderNode();

    expect(screen.getByText("Text → Image")).toBeInTheDocument();
  });

  it("switches to the image-to-image (edit) mode label when an image is connected to the image handle", () => {
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
        type: "imageGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "media1", target: "gen1", targetHandle: "image" },
    ];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("Image → Image (Edit)")).toBeInTheDocument();
    expect(screen.queryByText("Text → Image")).not.toBeInTheDocument();
  });

  it("stays in text-to-image mode when only the text handle has connections (image handle empty)", () => {
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
        type: "imageGeneration",
        position: { x: 300, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "", history: { entries: [], activeId: null } },
      },
    ];
    const edges: Edge[] = [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }];

    renderWithNodes(nodes, edges);

    expect(screen.getByText("Text → Image")).toBeInTheDocument();
  });
});

describe("ImageGenerationNode Model picker (issue #29)", () => {
  const flux: Model = {
    endpointId: "fal-ai/flux/dev",
    name: "FLUX.1 [dev]",
    category: "text-to-image",
    description: "",
    tags: [],
  };
  const editModel: Model = {
    endpointId: "fal-ai/edit/model",
    name: "Edit Model",
    category: "image-to-image",
    description: "",
    tags: [],
  };

  // Issue #30 / ADR-0008: selecting a Model now also fetches its schema to
  // derive and snapshot handles. These #29-era tests only care about the
  // model/label bookkeeping, so stub a schema with no media inputs to keep
  // them focused (and network-free).
  beforeEach(() => {
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only Approved image-output Models fetched via approvedModelsForKind", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux, editModel]);
    renderNode();

    expect(modelsActions.approvedModelsForKind).toHaveBeenCalledWith("image");
    expect(await screen.findByRole("option", { name: "FLUX.1 [dev]" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Edit Model" })).toBeInTheDocument();
  });

  it("shows a 'select a model' state before a Model is chosen", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux]);
    renderNode();

    await screen.findByRole("option", { name: "FLUX.1 [dev]" });
    expect(screen.getByText(/select a model to configure/i)).toBeInTheDocument();
  });

  it("shows an empty hint pointing at /models when there are no Approved image Models", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([]);
    renderNode();

    const hint = await screen.findByText(/no approved.*models/i);
    expect(hint).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /models/i });
    expect(link).toHaveAttribute("href", "/models");
  });

  it("selecting a Model stores endpointId, name and category in node data via updateNodeData", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux, editModel]);
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
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

    await screen.findByRole("option", { name: "FLUX.1 [dev]" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/flux/dev");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.model).toEqual({
        endpointId: "fal-ai/flux/dev",
        name: "FLUX.1 [dev]",
        category: "text-to-image",
        handles: [],
        hasNegativePrompt: false,
      });
    });
  });

  it("shows the selected Model's category as the node's label instead of the connection-derived mode", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux, editModel]);
    const user = userEvent.setup();
    renderNode();

    await screen.findByRole("option", { name: "FLUX.1 [dev]" });
    expect(screen.getByText("Text → Image")).toBeInTheDocument();

    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/edit/model");

    await waitFor(() => {
      expect(screen.getByText("Image → Image")).toBeInTheDocument();
    });
  });

  it("restores a saved Model selection on reload without refetching the picker's answer", () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux]);
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/flux/dev",
        name: "FLUX.1 [dev]",
        category: "text-to-image",
        handles: [],
        hasNegativePrompt: false,
      },
    });

    expect(screen.getByText("Text → Image")).toBeInTheDocument();
    expect(screen.queryByText(/select a model/i)).not.toBeInTheDocument();
  });

  it("preserves the selected Model when the node is cloned as a Variant", async () => {
    vi.spyOn(generationMock, "generateImagePlaceholder").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/c1/768/768",
    });
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux]);
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "imageGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: {
          prompt: "",
          history: { entries: [], activeId: null },
          model: { endpointId: "fal-ai/flux/dev", name: "FLUX.1 [dev]", category: "text-to-image", handles: [] },
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
    const labels = screen.getAllByText("Text → Image");
    expect(labels).toHaveLength(2);
  });
});

describe("ImageGenerationNode schema-derived Input Handles (issue #30)", () => {
  const flux: Model = {
    endpointId: "fal-ai/flux/dev",
    name: "FLUX.1 [dev]",
    category: "text-to-image",
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
    // Still exactly one output (source) handle.
    expect(container.querySelectorAll(".react-flow__handle.source")).toHaveLength(1);
  });

  it("fetches the selected Model's schema and snapshots the resolved handles into node data", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([flux]);
    const fetchSchema = vi
      .spyOn(falSchema, "fetchModelInputSchema")
      .mockResolvedValue(nanoBanana2EditSchema);
    const user = userEvent.setup();
    let getNodeRef: ((id: string) => Node | undefined) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
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

    await screen.findByRole("option", { name: "FLUX.1 [dev]" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/flux/dev");

    expect(fetchSchema).toHaveBeenCalledWith("fal-ai/flux/dev");

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.model?.handles).toEqual(
        expect.arrayContaining([
          { handleId: "image_urls", label: "image_urls", dataType: "image", many: true },
          { handleId: "video_url", label: "video_url", dataType: "video", many: false },
        ]),
      );
    });
  });

  it("renders a handle for each snapshotted entry, including a video handle from an image Model's schema", async () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/nano-banana-2/edit",
        name: "Nano Banana 2 Edit",
        category: "image-to-image",
        handles: [
          { handleId: "image_urls", label: "image_urls", dataType: "image", many: true },
          { handleId: "video_url", label: "video_url", dataType: "video", many: false },
        ],
        hasNegativePrompt: false,
      },
    });

    expect(
      document.querySelector('.react-flow__handle[data-handleid="image_urls"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('.react-flow__handle[data-handleid="video_url"]'),
    ).not.toBeNull();
    expect(document.querySelector('.react-flow__handle[data-handleid="text"]')).not.toBeNull();
  });

  it("renders handles from the snapshot on reload without re-contacting FAL", () => {
    const fetchSchema = vi.spyOn(falSchema, "fetchModelInputSchema");
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/nano-banana-2/edit",
        name: "Nano Banana 2 Edit",
        category: "image-to-image",
        handles: [{ handleId: "image_urls", label: "image_urls", dataType: "image", many: true }],
        hasNegativePrompt: false,
      },
    });

    expect(document.querySelector('.react-flow__handle[data-handleid="image_urls"]')).not.toBeNull();
    expect(fetchSchema).not.toHaveBeenCalled();
  });
});

describe("ImageGenerationNode negative-prompt config field (issue #32)", () => {
  const negativePromptModel: Model = {
    endpointId: "fal-ai/has-negative-prompt",
    name: "Has Negative Prompt",
    category: "text-to-image",
    description: "",
    tags: [],
  };
  const noNegativePromptModel: Model = {
    endpointId: "fal-ai/flux/dev",
    name: "FLUX.1 [dev]",
    category: "text-to-image",
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
        endpointId: "fal-ai/has-negative-prompt",
        name: "Has Negative Prompt",
        category: "text-to-image",
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
        endpointId: "fal-ai/flux/dev",
        name: "FLUX.1 [dev]",
        category: "text-to-image",
        handles: [],
        hasNegativePrompt: false,
      },
    });

    expect(screen.queryByLabelText(/negative prompt/i)).not.toBeInTheDocument();
  });

  it("fetches the selected Model's schema and derives hasNegativePrompt, snapshotting it into node data", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([negativePromptModel]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({
      paths: {
        "/fal-ai/has-negative-prompt": {
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
            },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderNode();

    await screen.findByRole("option", { name: "Has Negative Prompt" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/has-negative-prompt");

    expect(await screen.findByLabelText(/negative prompt/i)).toBeInTheDocument();
  });

  it("does not show the field for a Model whose schema lacks negative_prompt", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([noNegativePromptModel]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    const user = userEvent.setup();
    renderNode();

    await screen.findByRole("option", { name: "FLUX.1 [dev]" });
    const picker = screen.getByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/flux/dev");

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
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: {
            prompt: "",
            history: { entries: [], activeId: null },
            model: {
              endpointId: "fal-ai/has-negative-prompt",
              name: "Has Negative Prompt",
              category: "text-to-image",
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
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.negativePrompt).toBe("blurry, low quality");
    });
  });

  it("persists the negative-prompt value on reload", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/has-negative-prompt",
        name: "Has Negative Prompt",
        category: "text-to-image",
        handles: [],
        hasNegativePrompt: true,
      },
      negativePrompt: "blurry, low quality",
    });

    expect(screen.getByLabelText(/negative prompt/i)).toHaveValue("blurry, low quality");
  });

  it("does not include the negative prompt in the Resolved Prompt preview", () => {
    renderNode({
      prompt: "a cat",
      history: { entries: [], activeId: null },
      model: {
        endpointId: "fal-ai/has-negative-prompt",
        name: "Has Negative Prompt",
        category: "text-to-image",
        handles: [],
        hasNegativePrompt: true,
      },
      negativePrompt: "blurry, low quality",
    });

    const resolvedPromptHeading = screen.getByText("Resolved Prompt");
    const resolvedPromptBlock = resolvedPromptHeading.parentElement as HTMLElement;
    expect(within(resolvedPromptBlock).getByText("a cat")).toBeInTheDocument();
    expect(within(resolvedPromptBlock).queryByText(/blurry/i)).not.toBeInTheDocument();
  });
});
