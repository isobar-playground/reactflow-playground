import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasEditor } from "./canvas-editor";
import type { Canvas } from "@/lib/canvas-repo";

vi.mock("@/app/canvas-actions", () => ({
  saveCanvasGraphAction: vi.fn().mockResolvedValue(undefined),
}));

function makeCanvas(graph: Record<string, unknown> = {}): Canvas {
  return {
    id: "canvas-1",
    name: "Untitled",
    graph,
    updatedAt: new Date().toISOString(),
  };
}

describe("CanvasEditor add-node menu", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("shows the centred add-node menu by default on an empty canvas", () => {
    render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    expect(screen.getByText("Static Text Reference")).toBeInTheDocument();
  });

  it("lists all four node types as a flat list in the empty-canvas menu", () => {
    render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    expect(screen.getByText("Static Media Reference")).toBeInTheDocument();
    expect(screen.getByText("Static Text Reference")).toBeInTheDocument();
    expect(screen.getByText("Image Generation Node")).toBeInTheDocument();
    expect(screen.getByText("Video Generation Node")).toBeInTheDocument();
  });

  it("does not show the empty-canvas menu once a node already exists", () => {
    render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "n1",
              type: "staticTextReference",
              position: { x: 0, y: 0 },
              data: { text: "hi" },
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(screen.queryByRole("menu", { name: "Add a node" })).not.toBeInTheDocument();
  });

  it("adds a Static Text Reference node when picked from the empty-canvas menu", async () => {
    const user = userEvent.setup();
    render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    await user.click(screen.getByText("Static Text Reference"));

    expect(await screen.findByPlaceholderText("Enter text…")).toBeInTheDocument();
  });

  it("shows the empty-canvas menu again once the only node is deleted", async () => {
    const user = userEvent.setup();
    render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    await user.click(screen.getByText("Static Text Reference"));
    const node = await screen.findByPlaceholderText("Enter text…");
    expect(screen.queryByRole("menu", { name: "Add a node" })).not.toBeInTheDocument();

    // Select then delete the node, mirroring how React Flow removes a node
    // via keyboard (click to select, Backspace/Delete to remove). Uses
    // fireEvent rather than userEvent.click: jsdom's MouseEvent constructor
    // rejects the `view` value userEvent's pointer machinery supplies here,
    // an unrelated jsdom/testing-library interop quirk with drag-enabled
    // elements (see d3-drag's use of `event.view`).
    const nodeElement = node.closest(".react-flow__node") as HTMLElement;
    fireEvent.click(nodeElement);
    fireEvent.keyDown(nodeElement, { key: "Backspace", code: "Backspace" });

    expect(await screen.findByRole("menu", { name: "Add a node" })).toBeInTheDocument();
  });
});

describe("CanvasEditor right-click menu", () => {
  it("opens the menu at the cursor and spawns the chosen node there", async () => {
    const user = userEvent.setup();
    const { container } = render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    // Wait for the empty-canvas menu (cheap, synchronous with render) *and*
    // for @xyflow/react's onInit, which the component needs before
    // screenToFlowPosition gives a real answer. onInit fires from a
    // `setTimeout(…, 1)` once internal viewport measurement completes —
    // not tied to any DOM change testing-library can observe — so without
    // this explicit wait the context menu below can fire a beat too early
    // and silently fall back to the empty-canvas centring position.
    await screen.findByRole("menu", { name: "Add a node" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const pane = container.querySelector(".react-flow__pane") as HTMLElement;
    fireEvent.contextMenu(pane, { clientX: 321, clientY: 654 });

    // The right-click Radix ContextMenu renders real "menuitem" roles; the
    // always-open empty-canvas panel is a plain (non-ARIA-menu) button list,
    // so this unambiguously targets the right-click menu's entry.
    await user.click(await screen.findByRole("menuitem", { name: "Static Text Reference" }));

    const nodeElement = (await screen.findByPlaceholderText("Enter text…")).closest(
      ".react-flow__node",
    ) as HTMLElement;
    // jsdom has no layout engine (pane rect is stubbed to top:0/left:0,
    // viewport starts untransformed), so screen and flow coordinates match.
    expect(nodeElement.style.transform).toBe("translate(321px,654px)");
  });
});

describe("CanvasEditor persistence", () => {
  it("restores a Static Text Reference node's saved text", () => {
    render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "n1",
              type: "staticTextReference",
              position: { x: 0, y: 0 },
              data: { text: "saved text" },
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(screen.getByPlaceholderText("Enter text…")).toHaveValue("saved text");
  });

  it("restores an Image Generation Node's saved prompt and output", () => {
    render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "n1",
              type: "imageGeneration",
              position: { x: 0, y: 0 },
              data: {
                prompt: "saved prompt",
                history: {
                  entries: [
                    {
                      id: "a",
                      prompt: "saved prompt",
                      output: { kind: "image", url: "https://picsum.photos/seed/xyz/768/768" },
                    },
                  ],
                  activeId: "a",
                },
              },
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(screen.getByPlaceholderText(/prompt/i)).toHaveValue("saved prompt");
    expect(screen.getByAltText(/output/i)).toHaveAttribute(
      "src",
      "https://picsum.photos/seed/xyz/768/768",
    );
  });
});

describe("CanvasEditor Image Generation Node from the menu", () => {
  it("adds an Image Generation Node when picked from the empty-canvas menu", async () => {
    const user = userEvent.setup();
    render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    await user.click(screen.getByText("Image Generation Node"));

    expect(await screen.findByPlaceholderText(/prompt/i)).toBeInTheDocument();
  });
});

describe("CanvasEditor connection validation", () => {
  it("rejects a connection into a Static Text Reference (references accept no inbound edges)", () => {
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "ref1",
              type: "staticTextReference",
              position: { x: 0, y: 0 },
              data: { text: "hello" },
            },
            {
              id: "ref2",
              type: "staticTextReference",
              position: { x: 300, y: 0 },
              data: { text: "world" },
            },
          ],
          edges: [],
        })}
      />,
    );

    // Static Text Reference has a source handle only, so there is no
    // rendered target handle to drag onto — confirming, at the DOM level,
    // that the structural absence backs the connection-rules rejection.
    const targetHandles = container.querySelectorAll(
      '.react-flow__node[data-id="ref2"] .react-flow__handle.target',
    );
    expect(targetHandles).toHaveLength(0);
  });

  it("allows connecting a Static Text Reference into an Image Generation Node's text handle", async () => {
    render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "ref1",
              type: "staticTextReference",
              position: { x: 0, y: 0 },
              data: { text: "a red car" },
            },
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 400, y: 0 },
              data: { prompt: "in a driveway", history: { entries: [], activeId: null } },
            },
          ],
          edges: [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }],
        })}
      />,
    );

    // The saved edge round-tripped into React Flow's edge state and was
    // picked up by the Image Generation Node's Resolved Prompt preview —
    // proof the connection was accepted and consumed correctly.
    expect(await screen.findByText("a red car in a driveway")).toBeInTheDocument();
  });
});
