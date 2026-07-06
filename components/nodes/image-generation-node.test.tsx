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
import { ImageGenerationNode, type ImageGenerationNodeData } from "./image-generation-node";
import { StaticTextReferenceNode } from "./static-text-reference-node";
import { StaticMediaReferenceNode } from "./static-media-reference-node";
import type { Model } from "@/lib/fal-models";
import nanoBanana2EditSchema from "@/lib/__fixtures__/nano-banana-2-edit.json";
import fluxSchnellSchema from "@/lib/__fixtures__/flux-schnell.json";

vi.mock("@/app/models-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/models-actions")>();
  return {
    ...actual,
    approvedModelsForKind: vi.fn().mockResolvedValue([]),
  };
});

const nodeTypes = {
  imageGeneration: ImageGenerationNode,
  staticTextReference: StaticTextReferenceNode,
  staticMediaReference: StaticMediaReferenceNode,
};

// A selected Model (CONTEXT.md / ADR-0009): Generate is disabled without one
// (issue #36), so every test that actually clicks Generate/Regenerate needs
// one in its node data — only the "no Model selected yet" tests omit it.
const testModel: ImageGenerationNodeData["model"] = {
  endpointId: "fal-ai/flux/dev",
  name: "FLUX.1 [dev]",
  category: "text-to-image",
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
    let resolveGeneration!: (result: { kind: "image"; url: string }) => void;
    vi.spyOn(realGeneration, "runImageGeneration").mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(screen.getAllByText(/generating/i).length).toBeGreaterThan(0);

    resolveGeneration({ kind: "image", url: "https://picsum.photos/seed/abc/768/768" });

    await screen.findByRole("img", { name: /output/i });
    expect(screen.queryByText(/generating/i)).not.toBeInTheDocument();
    const image = await screen.findByRole("img", { name: /output/i });
    expect(image).toHaveAttribute("src", "https://picsum.photos/seed/abc/768/768");
  });

  it("changes the button label to Regenerate after the first output exists", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/abc/768/768",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});

describe("ImageGenerationNode history carousel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no carousel after the first generation", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/a/768/768",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });

    expect(screen.queryAllByRole("button", { name: /history/i })).toHaveLength(0);
  });

  it("reveals a carousel with two thumbnails after the second generation", async () => {
    vi.spyOn(realGeneration, "runImageGeneration")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/a/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/b/768/768" });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

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
      .spyOn(realGeneration, "runImageGeneration")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/a/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/b/768/768" });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

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
    const generate = vi.spyOn(realGeneration, "runImageGeneration");
    for (let i = 0; i < 5; i++) {
      generate.mockResolvedValueOnce({ kind: "image", url: `https://picsum.photos/seed/${i}/768/768` });
    }
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

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
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
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
          data: { prompt: "a cat", history: { entries: [], activeId: null }, model: testModel },
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
    vi.spyOn(realGeneration, "runImageGeneration")
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
    // The original runs its own generation (issue #47); each clone's run is
    // only *submitted* by the original (issue #48 / ADR-0011) and polled to
    // completion by the clone's own resume machinery.
    const generate = vi
      .spyOn(realGeneration, "runImageGeneration")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/c1/768/768" });
    let submissions = 0;
    const submit = vi
      .spyOn(realGeneration, "submitImageGeneration")
      .mockImplementation(async () => {
        submissions += 1;
        return {
          requestId: `req-${submissions}`,
          statusUrl: `https://queue.fal.run/x/status/${submissions}`,
          responseUrl: `https://queue.fal.run/x/${submissions}`,
        };
      });
    vi.spyOn(realGeneration, "resumeImageGeneration").mockImplementation(async (pending) => ({
      kind: "image",
      url: `https://picsum.photos/seed/c${pending.requestId === "req-1" ? 2 : 3}/768/768`,
    }));
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "imageGeneration",
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
    // them (and runs its own generation, issue #47), so only 2 new siblings
    // are cloned beside it, and 3 generations run in all: the original's own
    // full run plus one submit-only run per clone.
    await waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(document.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(3);
    });
    await waitFor(() => {
      expect(screen.getAllByRole("img", { name: "Generation output" })).toHaveLength(3);
    });
    const outputs = screen.getAllByRole("img", { name: "Generation output" });
    expect(outputs.map((img) => img.getAttribute("src")).sort()).toEqual([
      "https://picsum.photos/seed/c1/768/768",
      "https://picsum.photos/seed/c2/768/768",
      "https://picsum.photos/seed/c3/768/768",
    ]);
  });

  it("resets the variant counter to 1 after cloning", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/c1/768/768",
    });
    vi.spyOn(realGeneration, "submitImageGeneration").mockReturnValue(new Promise(() => {}));
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
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/solo/768/768",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    const images = await screen.findAllByRole("img", { name: "Generation output" });
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "https://picsum.photos/seed/solo/768/768");
  });

  it("wires each clone to the original's incoming Static Text Reference, without duplicating any outgoing edge", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/c1/768/768",
    });
    vi.spyOn(realGeneration, "submitImageGeneration").mockReturnValue(new Promise(() => {}));
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
          data: { prompt: "", history: { entries: [], activeId: null }, model: testModel },
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

  // Issue #30 / ADR-0008 (and issue #37 for pricing): selecting a Model now
  // also fetches its schema to derive and snapshot handles, and its pricing
  // entry. These #29-era tests only care about the model/label bookkeeping,
  // so stub both with no media inputs / no pricing to keep them focused
  // (and network-free).
  beforeEach(() => {
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue({ paths: {}, components: {} });
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
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
        pricing: null,
        defaultDurationSeconds: undefined,
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
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://picsum.photos/seed/c1/768/768",
    });
    vi.spyOn(realGeneration, "submitImageGeneration").mockReturnValue(new Promise(() => {}));
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
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
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

describe("ImageGenerationNode edge reconciliation on Model change (issue #33)", () => {
  const editModel: Model = {
    endpointId: "fal-ai/nano-banana-2/edit",
    name: "Nano Banana 2 Edit",
    category: "image-to-image",
    description: "",
    tags: [],
  };
  const fluxSchnell: Model = {
    endpointId: "fal-ai/flux/schnell",
    name: "FLUX.1 [schnell]",
    category: "text-to-image",
    description: "",
    tags: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Builds a canvas with a Static Media Reference (holding an image asset)
  // wired into the Image Generation Node's image_urls handle, and a Static
  // Text Reference wired into its fixed text handle — the scenario issue
  // #33's acceptance criteria describes: switching to a Model whose schema
  // no longer exposes image_urls should silently drop only that edge.
  function renderWithConnectedReferences(initialModel: ImageGenerationNodeData["model"]) {
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
          type: "imageGeneration",
          position: { x: 200, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "", history: { entries: [], activeId: null }, model: initialModel },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([
        { id: "e-media", source: "media1", target: "gen1", targetHandle: "image_urls" },
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
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([editModel, fluxSchnell]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockImplementation(async (endpointId: string) =>
      endpointId === "fal-ai/nano-banana-2/edit" ? nanoBanana2EditSchema : fluxSchnellSchema,
    );
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const { user, getEdgesRef } = renderWithConnectedReferences({
      endpointId: "fal-ai/nano-banana-2/edit",
      name: "Nano Banana 2 Edit",
      category: "image-to-image",
      handles: [{ handleId: "image_urls", label: "image_urls", dataType: "image", many: true }],
      hasNegativePrompt: false,
    });

    expect(getEdgesRef()()).toHaveLength(2);

    const picker = await screen.findByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/flux/schnell");

    await waitFor(() => {
      const remaining = getEdgesRef()();
      expect(remaining.map((e) => e.id)).toEqual(["e-text"]);
    });
  });

  it("keeps input edges whose handle is still present and type-compatible after the Model change", async () => {
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([editModel]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue(nanoBanana2EditSchema);
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
    const { user, getEdgesRef } = renderWithConnectedReferences({
      endpointId: "fal-ai/nano-banana-2/edit",
      name: "Nano Banana 2 Edit",
      category: "image-to-image",
      handles: [{ handleId: "image_urls", label: "image_urls", dataType: "image", many: true }],
      hasNegativePrompt: false,
    });

    // Re-selecting the SAME Model recomputes the snapshot but must be a
    // no-op for edges (issue #33 acceptance criteria).
    const picker = await screen.findByRole("combobox", { name: /model/i });
    await user.selectOptions(picker, "fal-ai/nano-banana-2/edit");

    await waitFor(() => {
      expect(getEdgesRef()().map((e) => e.id).sort()).toEqual(["e-media", "e-text"]);
    });
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
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
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
    vi.spyOn(falPricing, "fetchModelPricing").mockResolvedValue(null);
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

// Real FAL generation via the queue API (CONTEXT.md / ADR-0009, issue #36).
// lib/real-generation.ts is mocked here exactly like the old generation-mock
// module was — these tests only care about the node's own behavior (what it
// sends, what it persists, how it reacts to success/failure), not
// lib/real-generation's or the server actions' internals (covered by their
// own unit tests).
describe("ImageGenerationNode real generation (issue #36)", () => {
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
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    const user = userEvent.setup();
    renderInCanvas([
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
        data: {
          prompt: "in a driveway",
          history: { entries: [], activeId: null },
          model: { ...testModel, hasNegativePrompt: true },
          negativePrompt: "blurry, low quality",
        },
      },
    ], [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }]);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: "fal-ai/flux/dev",
          prompt: "a red car in a driveway",
          negativePrompt: "blurry, low quality",
        }),
        expect.anything(),
      );
    });
  });

  it("omits negativePrompt from the call when the Model's schema has no negative_prompt", async () => {
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ endpointId: "fal-ai/flux/dev", prompt: "a cat", negativePrompt: undefined }),
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
    let resolveGeneration!: (result: { kind: "image"; url: string }) => void;
    vi.spyOn(realGeneration, "runImageGeneration").mockImplementation(async (_input, options) => {
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
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "a cat", history: { entries: [], activeId: null }, model: testModel },
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
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.pendingGeneration).toEqual(pending);
    });

    resolveGeneration({ kind: "image", url: "https://fal.media/out.png" });

    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.pendingGeneration).toBeNull();
    });
  });

  it("shows an error message and adds no History entry when the FAL generation fails", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockRejectedValue(
      new Error("FAL queue submit returned 422 for fal-ai/flux/dev"),
    );
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/422/);
    expect(screen.queryByRole("img", { name: /output/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("clears a previous error once a subsequent Generate succeeds", async () => {
    const run = vi
      .spyOn(realGeneration, "runImageGeneration")
      .mockRejectedValueOnce(new Error("moderation blocked the request"))
      .mockResolvedValueOnce({ kind: "image", url: "https://fal.media/out.png" });
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("img", { name: /output/i })).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs one independent real generation per variant, the original included, when generating variants", async () => {
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    let submissions = 0;
    const submit = vi
      .spyOn(realGeneration, "submitImageGeneration")
      .mockImplementation(async () => {
        submissions += 1;
        return {
          requestId: `req-${submissions}`,
          statusUrl: `https://queue.fal.run/x/status/${submissions}`,
          responseUrl: `https://queue.fal.run/x/${submissions}`,
        };
      });
    vi.spyOn(realGeneration, "resumeImageGeneration").mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderInCanvas([
      {
        id: "n1",
        type: "imageGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: { prompt: "a cat", history: { entries: [], activeId: null }, model: testModel },
      },
    ]);

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    // 3 variants total = 3 independent submissions (issues #47/#48): the
    // original's own full run plus one submit-only run per clone, each with
    // the same prompt.
    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(2);
    });
    expect(run.mock.calls[0][0]).toEqual(
      expect.objectContaining({ endpointId: "fal-ai/flux/dev", prompt: "a cat" }),
    );
    for (const nth of [1, 2]) {
      expect(submit.mock.calls[nth - 1][0]).toEqual(
        expect.objectContaining({ endpointId: "fal-ai/flux/dev", prompt: "a cat" }),
      );
    }
  });
});

// The original runs its own variant generation (CONTEXT.md's Variant /
// Clone, ADR-0011, issue #47): the variant count is the *total* number of
// variants and the original is one of them, so a count of N fires N FAL
// submissions — the original's through the normal single-Generate path
// (History append, pendingGeneration write-through, own error state), plus
// one per clone (fired by the submitter, kept as-is for now).
describe("ImageGenerationNode: the original runs its own variant generation (issue #47)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires one FAL submission per variant, the original included (count 2 → 2 submissions)", async () => {
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    // The clone's submission is submit-only (issue #48 / ADR-0011); its
    // polling belongs to the clone and never settles here.
    const submit = vi.spyOn(realGeneration, "submitImageGeneration").mockResolvedValue({
      requestId: "req-clone",
      statusUrl: "https://queue.fal.run/x/status",
      responseUrl: "https://queue.fal.run/x",
    });
    vi.spyOn(realGeneration, "resumeImageGeneration").mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(1);
    });
  });

  it("appends the original's run to its existing History as the new Active Output, recording its own Actual Cost", async () => {
    // The original's run goes through the normal single-Generate path; the
    // clone's run is submit-only from here (issue #48 / ADR-0011) and lands
    // through the clone's own resume machinery.
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/original.png",
      billableUnits: 2,
    });
    vi.spyOn(realGeneration, "submitImageGeneration").mockResolvedValue({
      requestId: "req-clone",
      statusUrl: "https://queue.fal.run/x/status",
      responseUrl: "https://queue.fal.run/x",
    });
    vi.spyOn(realGeneration, "resumeImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/clone.png",
      billableUnits: 1,
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
          data: {
            prompt: "a cat",
            history: {
              entries: [{ id: "old", prompt: "a cat", output: { kind: "image", url: "https://fal.media/old.png" } }],
              activeId: "old",
            },
            model: { ...testModel, pricing: { unitPrice: 0.1, unit: "images", currency: "USD" } },
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

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    // The original's prior entry is preserved, the new one is appended and
    // becomes the Active Output, and it records the original's own billed
    // cost (2 units × $0.10) — not the clone's.
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.history.entries).toHaveLength(2);
      expect(data.history.entries[0].output.url).toBe("https://fal.media/old.png");
      expect(data.history.entries[1].output.url).toBe("https://fal.media/original.png");
      expect(data.history.entries[1].actualCost).toBeCloseTo(0.2);
      expect(data.history.activeId).toBe(data.history.entries[1].id);
    });

    // The clone's own single fresh output landed on the clone, not here.
    await waitFor(() => {
      const nodeContainers = Array.from(
        document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
      );
      expect(nodeContainers).toHaveLength(2);
      const clone = nodeContainers.find((el) => el.dataset.id !== "n1")!;
      expect(within(clone).getByRole("img", { name: "Generation output" })).toHaveAttribute(
        "src",
        "https://fal.media/clone.png",
      );
      // …recording the clone's own Actual Cost (1 unit × $0.10), not the
      // original's — each variant's History entry carries its own billed cost.
      expect(within(clone).getByText("$0.10")).toBeInTheDocument();
    });
  });

  it("shows the original's failure as its own error state with no History entry, without blocking the clone's run", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockRejectedValue(
      new Error("FAL queue submit returned 422 for fal-ai/flux/dev"),
    );
    vi.spyOn(realGeneration, "submitImageGeneration").mockResolvedValue({
      requestId: "req-clone",
      statusUrl: "https://queue.fal.run/x/status",
      responseUrl: "https://queue.fal.run/x",
    });
    vi.spyOn(realGeneration, "resumeImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/clone.png",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    // The original shows its own error state and no output…
    const original = document.querySelector('[data-node-id]') as HTMLElement;
    expect(await within(original).findByRole("alert")).toHaveTextContent(/422/);
    expect(within(original).queryByRole("img", { name: "Generation output" })).not.toBeInTheDocument();

    // …while the clone still lands with its own fresh output.
    await waitFor(() => {
      const nodeContainers = Array.from(
        document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
      );
      expect(nodeContainers).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Generation output" })).toHaveAttribute(
        "src",
        "https://fal.media/clone.png",
      );
    });
  });

  it("resets the variant counter to 1 at trigger time, before the runs settle", async () => {
    let resolveGeneration!: (result: { kind: "image"; url: string }) => void;
    vi.spyOn(realGeneration, "runImageGeneration").mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    vi.spyOn(realGeneration, "submitImageGeneration").mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    // Still generating (nothing resolved yet), but the counter is already 1.
    await waitFor(() => {
      expect(counter).toHaveValue(1);
    });

    resolveGeneration({ kind: "image", url: "https://fal.media/out.png" });
  });

  it("writes the original's pending record through to data at submit time in a variant run (reload resume, ADR-0009)", async () => {
    const pending = {
      requestId: "req-original",
      statusUrl: "https://queue.fal.run/x/status",
      responseUrl: "https://queue.fal.run/x",
    };
    vi.spyOn(realGeneration, "runImageGeneration").mockImplementation(async (_input, options) => {
      options?.onPending?.(pending);
      return { kind: "image", url: "https://fal.media/out.png" };
    });
    vi.spyOn(realGeneration, "submitImageGeneration").mockReturnValue(new Promise(() => {}));
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
          data: { prompt: "a cat", history: { entries: [], activeId: null }, model: testModel },
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

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    // The original's submission carried the onPending write-through (the
    // record lands in data and is cleared once the run settles), so a
    // mid-run reload can resume the original's run.
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.pendingGeneration).toBeNull();
    });
  });
});

// Clones land on the canvas immediately and their runs are resumable
// (CONTEXT.md's Variant / Clone, ADR-0011, issue #48): the submitter only
// *submits* a clone's run — the clone is added to the canvas at trigger time
// with its inherited incoming edges, its pending-generation record is written
// into its node data as the submit is accepted, and the clone's own
// resume-on-mount machinery (issue #38) polls the run to completion. The
// submitter never polls a clone's run.
describe("ImageGenerationNode: clones land immediately and their runs are resumable (issue #48)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the clones and their inherited incoming edges to the canvas at trigger time, before any run finishes", async () => {
    // Nothing ever settles: neither the original's run nor the clones'
    // submissions resolve — the clones must be on the canvas regardless.
    vi.spyOn(realGeneration, "runImageGeneration").mockReturnValue(new Promise(() => {}));
    vi.spyOn(realGeneration, "submitImageGeneration").mockReturnValue(new Promise(() => {}));
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
          type: "imageGeneration",
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

    // Both clones are on the canvas although no run has finished, and each
    // shows the Resolved Prompt from its inherited incoming text edge.
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

  it("writes each clone's pending record into that clone's node data at submit acceptance, polls it only through the clone's own resume machinery, and shows the clone's generating state", async () => {
    // The original's own run stays in flight forever; each clone submission
    // is accepted with its own pending record; no clone run ever settles.
    vi.spyOn(realGeneration, "runImageGeneration").mockReturnValue(new Promise(() => {}));
    let submissions = 0;
    vi.spyOn(realGeneration, "submitImageGeneration").mockImplementation(async () => {
      submissions += 1;
      return {
        requestId: `req-clone-${submissions}`,
        statusUrl: `https://queue.fal.run/x/status/${submissions}`,
        responseUrl: `https://queue.fal.run/x/${submissions}`,
      };
    });
    const resume = vi
      .spyOn(realGeneration, "resumeImageGeneration")
      .mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    let getNodesRef: (() => Node[]) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "a cat", history: { entries: [], activeId: null }, model: testModel },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNodes } = useReactFlow();
      getNodesRef = getNodes as () => Node[];
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

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    // Each clone's node data carries its own pending record (so a reload
    // resumes it), written as the submission was accepted.
    await waitFor(() => {
      const clones = (getNodesRef?.() ?? []).filter((node) => node.id !== "n1");
      expect(clones).toHaveLength(2);
      const pendingIds = clones.map(
        (clone) => (clone.data as ImageGenerationNodeData).pendingGeneration?.requestId,
      );
      expect(pendingIds.sort()).toEqual(["req-clone-1", "req-clone-2"]);
    });

    // The submitter never polls a clone's run: the only full run is the
    // original's own; the clones' runs are polled by their own resume
    // machinery picking up the written record.
    expect(realGeneration.runImageGeneration).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const resumedIds = resume.mock.calls.map(([pending]) => pending.requestId);
      expect(resumedIds.sort()).toEqual(["req-clone-1", "req-clone-2"]);
    });

    // Every variant shows its generating state while its run is in flight.
    const nodeContainers = Array.from(
      document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
    );
    expect(nodeContainers).toHaveLength(3);
    for (const container of nodeContainers) {
      expect(within(container).getAllByText(/generating/i).length).toBeGreaterThan(0);
    }
  });

  it("appends a finished clone run as exactly one History entry with the clone's own Actual Cost, clearing its pending record", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/original.png",
      billableUnits: 2,
    });
    const clonePending = {
      requestId: "req-clone",
      statusUrl: "https://queue.fal.run/x/status",
      responseUrl: "https://queue.fal.run/x",
    };
    vi.spyOn(realGeneration, "submitImageGeneration").mockResolvedValue(clonePending);
    const resume = vi.spyOn(realGeneration, "resumeImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/clone.png",
      billableUnits: 1,
    });
    const user = userEvent.setup();
    let getNodesRef: (() => Node[]) | undefined;

    function TestCanvas() {
      const [nodes, , onNodesChange] = useNodesState<Node>([
        {
          id: "n1",
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: {
            prompt: "a cat",
            history: { entries: [], activeId: null },
            model: { ...testModel, pricing: { unitPrice: 0.1, unit: "images", currency: "USD" } },
          },
        },
      ]);
      const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
      const { getNodes } = useReactFlow();
      getNodesRef = getNodes as () => Node[];
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

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    // The clone's run settles into its single fresh output — its only
    // History entry — recording the clone's own billed cost (1 × $0.10),
    // and its pending record is cleared.
    await waitFor(() => {
      const clone = (getNodesRef?.() ?? []).find((node) => node.id !== "n1");
      expect(clone).toBeDefined();
      const cloneData = clone!.data as ImageGenerationNodeData;
      expect(cloneData.history.entries).toHaveLength(1);
      expect(cloneData.history.entries[0].output.url).toBe("https://fal.media/clone.png");
      expect(cloneData.history.entries[0].actualCost).toBeCloseTo(0.1);
      expect(cloneData.history.activeId).toBe(cloneData.history.entries[0].id);
      expect(cloneData.pendingGeneration).toBeNull();
    });

    // …and the original's own run landed in its own History with its own
    // cost (2 × $0.10) — never double-appended anywhere.
    await waitFor(() => {
      const original = (getNodesRef?.() ?? []).find((node) => node.id === "n1");
      const originalData = original!.data as ImageGenerationNodeData;
      expect(originalData.history.entries).toHaveLength(1);
      expect(originalData.history.entries[0].output.url).toBe("https://fal.media/original.png");
      expect(originalData.history.entries[0].actualCost).toBeCloseTo(0.2);
    });
    const clone = (getNodesRef?.() ?? []).find((node) => node.id !== "n1");
    expect((clone!.data as ImageGenerationNodeData).history.entries).toHaveLength(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("surfaces a clone's failed run as that clone's own error state with no History entry, without blocking its siblings", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/original.png",
    });
    let submissions = 0;
    vi.spyOn(realGeneration, "submitImageGeneration").mockImplementation(async () => {
      submissions += 1;
      return {
        requestId: `req-clone-${submissions}`,
        statusUrl: `https://queue.fal.run/x/status/${submissions}`,
        responseUrl: `https://queue.fal.run/x/${submissions}`,
      };
    });
    vi.spyOn(realGeneration, "resumeImageGeneration").mockImplementation(async (pending) => {
      if (pending.requestId === "req-clone-1") {
        throw new Error("FAL queue status returned 422");
      }
      return { kind: "image", url: "https://fal.media/sibling.png" };
    });
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "3");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(document.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(3);
    });

    // The failed clone shows its own error state (an alert inside that
    // clone, not the original) and no output…
    const failedAlert = await screen.findByRole("alert");
    expect(failedAlert).toHaveTextContent(/422/);
    const failedClone = failedAlert.closest(".react-flow__node") as HTMLElement;
    expect(within(failedClone).queryByRole("img", { name: "Generation output" })).not.toBeInTheDocument();

    // …while its siblings — the original and the other clone — still land
    // their own outputs.
    await waitFor(() => {
      const outputs = screen.getAllByRole("img", { name: "Generation output" });
      expect(outputs.map((img) => img.getAttribute("src")).sort()).toEqual([
        "https://fal.media/original.png",
        "https://fal.media/sibling.png",
      ]);
    });
  });

  it("resumes every variant's run after a mid-run reload — original and clones alike", async () => {
    // A reload mid-variant-run: both the original and the clone were
    // persisted with their own pending records (written at submit time), so
    // each node's mount resumes polling its own run.
    const resume = vi
      .spyOn(realGeneration, "resumeImageGeneration")
      .mockReturnValue(new Promise(() => {}));
    const originalPending = {
      requestId: "req-original",
      statusUrl: "https://queue.fal.run/o/status",
      responseUrl: "https://queue.fal.run/o",
    };
    const clonePending = {
      requestId: "req-clone",
      statusUrl: "https://queue.fal.run/c/status",
      responseUrl: "https://queue.fal.run/c",
    };
    renderInCanvas([
      {
        id: "original",
        type: "imageGeneration",
        position: { x: 0, y: 0 },
        initialWidth: 400,
        initialHeight: 500,
        data: {
          prompt: "a cat",
          history: { entries: [], activeId: null },
          model: testModel,
          pendingGeneration: originalPending,
        },
      },
      {
        id: "clone",
        type: "imageGeneration",
        position: { x: 40, y: 420 },
        initialWidth: 400,
        initialHeight: 500,
        data: {
          prompt: "a cat",
          history: { entries: [], activeId: null },
          model: testModel,
          pendingGeneration: clonePending,
        },
      },
    ]);

    await waitFor(() => {
      const resumedIds = resume.mock.calls.map(([pending]) => pending.requestId);
      expect(resumedIds.sort()).toEqual(["req-clone", "req-original"]);
    });
    for (const nodeId of ["original", "clone"]) {
      const container = document.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
      expect(within(container).getAllByText(/generating/i).length).toBeGreaterThan(0);
    }
  });
});

// Resuming a pending generation after reload (CONTEXT.md / ADR-0009, issue
// #38): a Generation Node whose data still holds a pendingGeneration record
// at mount time (written at submit time by issue #36, but never previously
// resumed) must pick polling back up rather than leaving the node stuck
// showing nothing, or losing track of a run FAL is billing regardless.
describe("ImageGenerationNode resumes a pending generation on mount (issue #38)", () => {
  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the in-progress state immediately, then lands the result in History and clears the pending record", async () => {
    let resolveResume!: (result: { kind: "image"; url: string }) => void;
    vi.spyOn(realGeneration, "resumeImageGeneration").mockReturnValue(
      new Promise((resolve) => {
        resolveResume = resolve;
      }),
    );
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
            prompt: "a cat",
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

    expect(realGeneration.resumeImageGeneration).toHaveBeenCalledWith(pending);
    expect(screen.getAllByText(/generating/i).length).toBeGreaterThan(0);

    resolveResume({ kind: "image", url: "https://fal.media/resumed.png" });

    await screen.findByRole("img", { name: /output/i });
    await waitFor(() => {
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.history.entries).toHaveLength(1);
      expect(data.history.entries[0].output.url).toBe("https://fal.media/resumed.png");
      expect(data.pendingGeneration).toBeNull();
    });
  });

  it("clears the pending record and shows the node's normal error state when FAL no longer recognizes the request", async () => {
    vi.spyOn(realGeneration, "resumeImageGeneration").mockRejectedValue(
      new Error("FAL queue status returned 404"),
    );
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
            prompt: "a cat",
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
      const data = getNodeRef?.("n1")?.data as ImageGenerationNodeData;
      expect(data.pendingGeneration).toBeNull();
      expect(data.history.entries).toHaveLength(0);
    });
    expect(realGeneration.resumeImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("does not call resumeImageGeneration when the node has no pending record", () => {
    const resume = vi.spyOn(realGeneration, "resumeImageGeneration");
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: testModel });

    expect(resume).not.toHaveBeenCalled();
  });
});

// Estimated Price (CONTEXT.md / ADR-0009, issue #37): shown next to Generate
// once the selected Model has a snapshotted pricing entry — unit price ×
// naively estimated units × variant count. Never a quote.
describe("ImageGenerationNode Estimated Price (issue #37)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no estimate when the selected Model has no pricing snapshot", () => {
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    expect(screen.queryByText(/est\.?\s*~?\$/i)).not.toBeInTheDocument();
  });

  it("shows the formatted estimate for a per-image-priced Model", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.08, unit: "images", currency: "USD" } },
    });

    expect(screen.getByText("Est. ~$0.08")).toBeInTheDocument();
  });

  it("updates the estimate live when the variant count changes", async () => {
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.08, unit: "images", currency: "USD" } },
    });

    expect(screen.getByText("Est. ~$0.08")).toBeInTheDocument();

    const counter = screen.getByRole("spinbutton", { name: /variant/i });
    await user.clear(counter);
    await user.type(counter, "4");

    expect(screen.getByText("Est. ~$0.32")).toBeInTheDocument();
  });

  it("shows the estimate for a per-second-priced Model using the schema's default duration", () => {
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: {
        ...testModel,
        pricing: { unitPrice: 0.14, unit: "seconds", currency: "USD" },
        defaultDurationSeconds: 5,
      },
    });

    expect(screen.getByText("Est. ~$0.70")).toBeInTheDocument();
  });
});

// Actual Cost (CONTEXT.md / ADR-0009, issue #41): shown with the output once
// a generation completes — billable units (FAL's x-fal-billable-units
// header, forwarded on runImageGeneration's resolved result) × the Model's
// snapshotted unit price. Never shown for a run whose result carries no
// billable-units figure, or a Model with no pricing snapshot.
describe("ImageGenerationNode Actual Cost (issue #41)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the Actual Cost next to the output once a generation completes", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
      billableUnits: 2,
    });
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.08, unit: "images", currency: "USD" } },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });

    expect(screen.getByText("$0.16")).toBeInTheDocument();
  });

  it("shows no Actual Cost when the result carries no billable-units header", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.08, unit: "images", currency: "USD" } },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });

    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("shows no Actual Cost when the Model has no pricing snapshot", async () => {
    vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
      billableUnits: 2,
    });
    const user = userEvent.setup();
    renderNode({ prompt: "", history: { entries: [], activeId: null }, model: testModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });

    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("shows each carousel entry's own Actual Cost as the active output is flipped through", async () => {
    vi.spyOn(realGeneration, "runImageGeneration")
      .mockResolvedValueOnce({ kind: "image", url: "https://fal.media/a.png", billableUnits: 1 })
      .mockResolvedValueOnce({ kind: "image", url: "https://fal.media/b.png", billableUnits: 3 });
    const user = userEvent.setup();
    renderNode({
      prompt: "",
      history: { entries: [], activeId: null },
      model: { ...testModel, pricing: { unitPrice: 0.1, unit: "images", currency: "USD" } },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("img", { name: /output/i });
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /output/i })).toHaveAttribute(
        "src",
        "https://fal.media/b.png",
      );
    });
    // The Active Output's own cost display and its carousel thumbnail's cost
    // label both show $0.30 while entry b is active (CONTEXT.md: shown with
    // the output AND on each carousel entry).
    expect(screen.getAllByText("$0.30").length).toBeGreaterThan(0);

    const thumbnails = screen.getAllByRole("img", { name: /history entry/i });
    await user.click(thumbnails[0]);

    expect(screen.getAllByText("$0.10").length).toBeGreaterThan(0);
  });

  it("persists the Actual Cost across reload (survives via data.history)", () => {
    renderNode({
      prompt: "a cat",
      history: {
        entries: [{ id: "a", prompt: "a cat", output: { kind: "image", url: "https://fal.media/a.png" }, actualCost: 0.42 }],
        activeId: "a",
      },
      model: testModel,
    });

    expect(screen.getByText("$0.42")).toBeInTheDocument();
  });
});

// Connected media inputs (issue #40 / ADR-0009, PRD #35): the node's
// snapshotted Model handles are paired with their currently-connected source
// nodes and forwarded to runImageGeneration's `media` field, which
// lib/generation-payload.ts maps into the FAL request body — the actual
// handle->field mapping is covered there; this node's own tests only check
// that it gathers and forwards the right connections.
describe("ImageGenerationNode connected media inputs (issue #40)", () => {
  const editModel: ImageGenerationNodeData["model"] = {
    endpointId: "fal-ai/nano-banana-2/edit",
    name: "Nano Banana 2 Edit",
    category: "image-to-image",
    handles: [{ handleId: "image_urls", label: "image_urls", dataType: "image", many: true }],
    hasNegativePrompt: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a Static Media Reference wired into a media handle as a media connection", async () => {
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
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
          data: { asset: { url: "/uploads/cat.png", name: "cat.png", type: "image" } },
        },
        {
          id: "gen1",
          type: "imageGeneration",
          position: { x: 0, y: 0 },
          initialWidth: 400,
          initialHeight: 500,
          data: { prompt: "a cat", history: { entries: [], activeId: null }, model: editModel },
        },
      ],
      [{ id: "e1", source: "media1", target: "gen1", targetHandle: "image_urls" }],
    );

    await user.click(within(document.querySelector('[data-node-id="gen1"]') as HTMLElement).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: "fal-ai/nano-banana-2/edit",
          prompt: "a cat",
          media: [
            expect.objectContaining({
              handle: expect.objectContaining({ handleId: "image_urls" }),
              sources: [
                expect.objectContaining({
                  type: "staticMediaReference",
                  data: { asset: { url: "/uploads/cat.png", name: "cat.png", type: "image" } },
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
    const run = vi.spyOn(realGeneration, "runImageGeneration").mockResolvedValue({
      kind: "image",
      url: "https://fal.media/out.png",
    });
    const user = userEvent.setup();
    renderNode({ prompt: "a cat", history: { entries: [], activeId: null }, model: editModel });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          media: [expect.objectContaining({ handle: expect.objectContaining({ handleId: "image_urls" }), sources: [] })],
        }),
        expect.anything(),
      );
    });
  });
});
