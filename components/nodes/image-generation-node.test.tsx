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
import { ImageGenerationNode, type ImageGenerationNodeData } from "./image-generation-node";
import { StaticTextReferenceNode } from "./static-text-reference-node";
import { StaticMediaReferenceNode } from "./static-media-reference-node";

const nodeTypes = {
  imageGeneration: ImageGenerationNode,
  staticTextReference: StaticTextReferenceNode,
  staticMediaReference: StaticMediaReferenceNode,
};

function renderNode(
  data: ImageGenerationNodeData = { prompt: "", history: { entries: [], activeId: null } },
) {
  const nodes = [
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
  ];
  return render(
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} />
    </ReactFlowProvider>,
  );
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

  it("renders the decorative control chips", () => {
    renderNode();

    for (const label of ["1K", "1:1", "Light", "Style", "Camera"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("lets the user type into the prompt field", async () => {
    const user = userEvent.setup();
    renderNode();

    const prompt = screen.getByPlaceholderText(/prompt/i);
    await user.type(prompt, "a cat");

    expect(prompt).toHaveValue("a cat");
  });

  it("decorative chips are inert: clicking them has no visible effect", async () => {
    const user = userEvent.setup();
    renderNode();

    const chip = screen.getByText("1K");
    await user.click(chip);

    // Still present, unchanged, no crash / no new UI appeared.
    expect(screen.getByText("1K")).toBeInTheDocument();
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
});

describe("ImageGenerationNode text handle and Resolved Prompt", () => {
  function renderWithTextRef(nodes: Node[], edges: Edge[]) {
    return render(
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
      </ReactFlowProvider>,
    );
  }

  it("renders target text and image handles in addition to the source output handle", () => {
    const { container } = renderNode();

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles).toHaveLength(3);
    expect(container.querySelector('.react-flow__handle[data-handleid="text"]')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle[data-handleid="image"]')).not.toBeNull();
  });

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

// Variant cloning (issue #12) adds sibling nodes to the graph via
// useReactFlow's addNodes/addEdges from inside the node component. That only
// takes effect when the surrounding <ReactFlow> is wired the same way
// components/canvas-editor.tsx wires it — nodes/edges owned by
// useNodesState/useEdgesState with onNodesChange/onEdgesChange passed
// through — unlike the static `nodes={[...]}` literal the other tests in
// this file use, which has nowhere for an internal addNodes change to flow.
function renderInCanvas(initialNodes: Node[]) {
  function TestCanvas() {
    const [nodes, , onNodesChange] = useNodesState<Node>(initialNodes);
    const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
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

describe("ImageGenerationNode variant cloning (issue #12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a variant counter defaulting to 1", () => {
    renderNode();

    expect(screen.getByRole("spinbutton", { name: /variant/i })).toHaveValue(1);
  });

  it("clones the node into that many independent nodes when the counter is above one and Generate is clicked", async () => {
    const generate = vi
      .spyOn(generationMock, "generateImagePlaceholder")
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/c1/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/c2/768/768" })
      .mockResolvedValueOnce({ kind: "image", url: "https://picsum.photos/seed/c3/768/768" });
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

    await waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(3);
    });

    // Three sibling nodes now exist in the graph, each showing its own
    // freshly generated output — not a copy of any shared History. The
    // original itself gets no new History entry of its own: cloning
    // replaces its generation rather than adding a fourth entry alongside
    // the clones.
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
    await user.type(counter, "2");
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
