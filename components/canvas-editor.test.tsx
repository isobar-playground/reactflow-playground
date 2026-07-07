import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as libraryActions from "@/app/library-actions";
import * as canvasActions from "@/app/canvas-actions";
import * as modelsActions from "@/app/models-actions";
import * as falSchema from "@/lib/fal-schema";
import { CanvasEditor } from "./canvas-editor";
import type { Canvas } from "@/lib/canvas-repo";
import nanoBanana2EditSchema from "@/lib/__fixtures__/nano-banana-2-edit.json";
import fluxSchnellSchema from "@/lib/__fixtures__/flux-schnell.json";

vi.mock("@/app/canvas-actions", () => ({
  saveCanvasGraphAction: vi.fn().mockResolvedValue(undefined),
  renameCanvasAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/models-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/models-actions")>();
  return {
    ...actual,
    approvedModelsForKind: vi.fn().mockResolvedValue([]),
  };
});

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

describe("CanvasEditor running total of Actual Cost (issue #42)", () => {
  it("shows the sum of Actual Cost across all nodes' History entries", () => {
    render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 0, y: 0 },
              data: {
                prompt: "a cat",
                history: {
                  entries: [
                    { id: "h1", prompt: "a cat", output: { kind: "image", url: "u1" }, actualCost: 0.1 },
                    { id: "h2", prompt: "a cat", output: { kind: "image", url: "u2" }, actualCost: 0.2 },
                  ],
                  activeId: "h2",
                },
              },
            },
            {
              id: "gen2",
              type: "videoGeneration",
              position: { x: 400, y: 0 },
              data: {
                prompt: "a dog",
                history: {
                  entries: [
                    { id: "h3", prompt: "a dog", output: { kind: "video", url: "u3" }, actualCost: 0.05 },
                  ],
                  activeId: "h3",
                },
              },
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(screen.getByLabelText("Total cost")).toHaveTextContent("$0.35");
  });

  it("shows no total on a canvas with no costed History entries", () => {
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

    expect(screen.queryByLabelText("Total cost")).not.toBeInTheDocument();
  });

  it("updates the total when a node with costed History is deleted", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 0, y: 0 },
              data: {
                prompt: "a cat",
                history: {
                  entries: [
                    { id: "h1", prompt: "a cat", output: { kind: "image", url: "u1" }, actualCost: 0.1 },
                  ],
                  activeId: "h1",
                },
              },
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(screen.getByLabelText("Total cost")).toHaveTextContent("$0.10");

    // Give React Flow a beat to finish its initial node measurement (see the
    // drag-to-spawn tests' own onInit wait above) — without it the node is
    // still `visibility: hidden` and its actions button isn't accessible yet.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const node = container.querySelector('.react-flow__node[data-id="gen1"]') as HTMLElement;
    await user.click(within(node).getByRole("button", { name: "Node actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Total cost")).not.toBeInTheDocument();
    });
  });
});

describe("CanvasEditor header rename (issue #21)", () => {
  it("renames the canvas via the header: click, type, Enter persists and updates the header", async () => {
    const user = userEvent.setup();
    render(<CanvasEditor canvas={makeCanvas({ nodes: [], edges: [] })} />);

    await user.click(screen.getByRole("button", { name: "Untitled" }));

    const input = screen.getByRole("textbox", { name: "Canvas name" });
    await user.clear(input);
    await user.type(input, "My Renamed Canvas");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(canvasActions.renameCanvasAction).toHaveBeenCalledWith(
        "canvas-1",
        "My Renamed Canvas",
      );
    });
    expect(await screen.findByRole("button", { name: "My Renamed Canvas" })).toBeInTheDocument();
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

describe("CanvasEditor drag-to-spawn (Handle-Spawned Node, issue #17)", () => {
  // Simulates a real connection drag ending on empty canvas: React Flow's
  // Handle listens for a plain DOM mousedown, then XYHandle attaches
  // document-level mousemove/mouseup listeners (@xyflow/system) that decide
  // the drop target by proximity — dragging far from any handle leaves
  // `toNode`/`toHandle` null, which is exactly the "dropped on empty pane"
  // case onConnectEnd is meant to detect. This exercises the real library
  // machinery rather than calling an internal handler directly.
  async function dragFromHandleToEmptyCanvas(handle: Element) {
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(document, { clientX: 900, clientY: 900 });
    fireEvent.mouseUp(document, { clientX: 900, clientY: 900 });
  }

  it("opens a spawn picker listing only node types valid at the dragged handle", async () => {
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
          ],
          edges: [],
        })}
      />,
    );

    await screen.findByPlaceholderText("Enter text…");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const sourceHandle = container.querySelector(
      '.react-flow__node[data-id="ref1"] .react-flow__handle.source',
    ) as HTMLElement;
    await dragFromHandleToEmptyCanvas(sourceHandle);

    // A text-typed output is only valid at a Generation Node's `text`
    // handle — never at a Static Media Reference, which has no input.
    // Scoped to the picker menu itself, since "Static Text Reference" also
    // legitimately appears in the origin node's own header.
    const menu = await screen.findByRole("menu", { name: "Add a connected node" });
    expect(within(menu).getByText("Image Generation Node")).toBeInTheDocument();
    expect(within(menu).getByText("Video Generation Node")).toBeInTheDocument();
    expect(within(menu).queryByText("Static Media Reference")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Static Text Reference")).not.toBeInTheDocument();
  });

  it("creates and auto-connects the chosen node when a candidate is picked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "ref1",
              type: "staticMediaReference",
              position: { x: 0, y: 0 },
              data: { asset: { url: "https://blob.example/cat.png", type: "image", name: "cat.png" } },
            },
          ],
          edges: [],
        })}
      />,
    );

    await screen.findByRole("img", { name: /cat.png/i });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const sourceHandle = container.querySelector(
      '.react-flow__node[data-id="ref1"] .react-flow__handle.source',
    ) as HTMLElement;
    await dragFromHandleToEmptyCanvas(sourceHandle);

    await user.click(await screen.findByText("Image Generation Node"));

    // Video Generation Node isn't offered here (image never -> video), and
    // there's no "Video Generation Node" text elsewhere to worry about.
    // The image-typed candidate here is a Generation Node (issue #34): it
    // auto-connects immediately since its own output handle typing isn't in
    // question here — only its *input* handles are Model-dependent, and
    // nothing in this scenario targets one.
    expect(await screen.findByPlaceholderText(/prompt/i)).toBeInTheDocument();
  });

  // Generation Node handle-spawn deferral (issue #34 / ADR-0007): a
  // Generation Node has no input handles until a Model is selected, so
  // picking it from the spawn picker must create the node without
  // connecting immediately — mirroring the existing Static Media Reference
  // deferral (ADR-0003) — and only attach the dragged edge once a Model is
  // chosen, to the first compatible handle in schema order.
  it("defers the edge when the handle-spawn candidate is a Generation Node with no Model yet, then attaches it once a Model with a compatible handle is picked", async () => {
    const user = userEvent.setup();
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([
      {
        endpointId: "fal-ai/nano-banana-2/edit",
        name: "Nano Banana 2 Edit",
        category: "image-to-image",
        description: "",
        tags: [],
      },
    ]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue(
      nanoBanana2EditSchema as unknown as Record<string, unknown>,
    );

    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "ref1",
              type: "staticMediaReference",
              position: { x: 0, y: 0 },
              data: { asset: { url: "https://blob.example/cat.png", type: "image", name: "cat.png" } },
            },
          ],
          edges: [],
        })}
      />,
    );

    await screen.findByRole("img", { name: /cat.png/i });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const sourceHandle = container.querySelector(
      '.react-flow__node[data-id="ref1"] .react-flow__handle.source',
    ) as HTMLElement;
    await dragFromHandleToEmptyCanvas(sourceHandle);

    await user.click(await screen.findByText("Image Generation Node"));

    // The Generation Node is created but no edge exists yet — no Model, no
    // handles to attach to.
    await screen.findByPlaceholderText(/prompt/i);
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);

    // Picking a Model whose schema exposes an image-compatible handle
    // (image_urls) resolves the deferred edge onto it.
    await user.click(await screen.findByRole("button", { name: /image model picker/i }));
    await user.click(
      await screen.findByRole("option", {
        name: (accessibleName) => accessibleName.includes("Nano Banana 2 Edit"),
      }),
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(1);
    });
  });

  it("drops the pending edge when the picked Model has no compatible handle", async () => {
    const user = userEvent.setup();
    vi.spyOn(modelsActions, "approvedModelsForKind").mockResolvedValue([
      {
        endpointId: "fal-ai/flux/schnell",
        name: "FLUX.1 [schnell]",
        category: "text-to-image",
        description: "",
        tags: [],
      },
    ]);
    vi.spyOn(falSchema, "fetchModelInputSchema").mockResolvedValue(
      fluxSchnellSchema as unknown as Record<string, unknown>,
    );

    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "ref1",
              type: "staticMediaReference",
              position: { x: 0, y: 0 },
              data: { asset: { url: "https://blob.example/cat.png", type: "image", name: "cat.png" } },
            },
          ],
          edges: [],
        })}
      />,
    );

    await screen.findByRole("img", { name: /cat.png/i });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const sourceHandle = container.querySelector(
      '.react-flow__node[data-id="ref1"] .react-flow__handle.source',
    ) as HTMLElement;
    await dragFromHandleToEmptyCanvas(sourceHandle);

    await user.click(await screen.findByText("Image Generation Node"));
    await screen.findByPlaceholderText(/prompt/i);

    // flux/schnell is text-to-image only — no image-accepting handle in its
    // schema — so the pending edge must be dropped, not attached anywhere.
    await user.click(await screen.findByRole("button", { name: /image model picker/i }));
    await user.click(
      await screen.findByRole("option", {
        name: (accessibleName) => accessibleName.includes("FLUX.1 [schnell]"),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);
  });

  // Static Media Reference special case (issue #17 / ADR-0003): its output
  // doesn't exist until an asset is chosen, so picking it from the spawn
  // picker must not connect immediately — it opens the Asset Picker
  // forced-open with a type hint, and the edge is only created once an
  // asset is actually picked.
  it("opens the Asset Picker forced-open with a type hint, and only connects once an asset is picked", async () => {
    const user = userEvent.setup();
    vi.spyOn(libraryActions, "listAssetsAction").mockResolvedValue([
      { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
      { url: "https://blob.example/clip.mp4", name: "clip.mp4", type: "video", uploadedAt: "2024-01-01" },
    ]);

    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 0, y: 0 },
              data: {
                prompt: "",
                history: { entries: [], activeId: null },
                // Issue #30: an Image Generation Node has no input handles
                // until a Model is selected — pre-seed a snapshotted Model
                // (as ADR-0008 would after selection) so this drag-to-spawn
                // scenario still has an `image` handle to drag from.
                model: {
                  endpointId: "fal-ai/edit/model",
                  name: "Edit Model",
                  category: "image-to-image",
                  handles: [{ handleId: "image", label: "image", dataType: "image", many: true }],
                },
              },
            },
          ],
          edges: [],
        })}
      />,
    );

    await screen.findByPlaceholderText(/prompt/i);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Image Generation Node's `image` input handle: dragging from it (a
    // target handle) yields staticMediaReference as a candidate (image is
    // one of the two media types a Static Media Reference can hold).
    const imageHandle = container.querySelector(
      '.react-flow__node[data-id="gen1"] .react-flow__handle.target[data-handleid="image"]',
    ) as HTMLElement;
    await dragFromHandleToEmptyCanvas(imageHandle);

    await user.click(await screen.findByText("Static Media Reference"));

    // Forced-open (no "Choose asset" click needed) and restricted to image
    // assets only — the video asset must not appear in the grid.
    expect(await screen.findByRole("button", { name: "cat.png" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "clip.mp4" })).not.toBeInTheDocument();
    });

    // No edge yet — the connection is deferred until an asset is picked.
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "cat.png" }));

    // Picking the asset both renders it and creates the deferred edge.
    expect(await screen.findByRole("img", { name: "cat.png" })).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(1);
    });
  });
});

describe("CanvasEditor node actions menu (delete/duplicate)", () => {
  it("shows Duplicate and Delete when a node's actions button is opened", async () => {
    const user = userEvent.setup();
    render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [{ id: "n1", type: "staticTextReference", position: { x: 0, y: 0 }, data: { text: "hi" } }],
          edges: [],
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Node actions" }));

    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("duplicates a node, keeping its data but placing it at a new position", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [{ id: "n1", type: "staticTextReference", position: { x: 0, y: 0 }, data: { text: "hello" } }],
          edges: [],
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Node actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

    expect(await screen.findAllByPlaceholderText("Enter text…")).toHaveLength(2);
    expect(container.querySelectorAll(".react-flow__node[data-id]")).toHaveLength(2);
  });

  it("deletes a node via its actions menu, taking its connected edge with it", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            { id: "ref1", type: "staticTextReference", position: { x: 0, y: 0 }, data: { text: "a red car" } },
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

    expect(await screen.findByText("a red car in a driveway")).toBeInTheDocument();

    const refNode = container.querySelector('.react-flow__node[data-id="ref1"]') as HTMLElement;
    await user.click(within(refNode).getByRole("button", { name: "Node actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(container.querySelector('.react-flow__node[data-id="ref1"]')).not.toBeInTheDocument();
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);
    });
  });
});

describe("CanvasEditor edge deletion between any node types", () => {
  it("removes an edge between a Reference and a Generation Node via select + Delete", async () => {
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            { id: "ref1", type: "staticTextReference", position: { x: 0, y: 0 }, data: { text: "a red car" } },
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 400, y: 0 },
              data: {
                prompt: "in a driveway",
                history: { entries: [], activeId: null },
                // Issue #30: the `text` handle only renders once a Model is
                // selected — snapshot one so this edge has a handle to
                // attach to.
                model: { endpointId: "fal-ai/edit/model", name: "Edit Model", category: "image-to-image", handles: [] },
              },
            },
          ],
          edges: [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }],
        })}
      />,
    );

    expect(await screen.findByText("a red car in a driveway")).toBeInTheDocument();

    const edgeElement = container.querySelector(".react-flow__edge") as HTMLElement;
    fireEvent.click(edgeElement);
    // "Delete" (forward-delete), not just Backspace — deleteKeyCode covers
    // both so Windows-standard Delete works, not only Backspace.
    fireEvent.keyDown(edgeElement, { key: "Delete", code: "Delete" });

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);
    });
  });

  it("removes an edge between two Generation Nodes (image output chained into another Image Generation Node) via select + Delete", async () => {
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 0, y: 0 },
              data: {
                prompt: "a cat",
                history: {
                  entries: [{ id: "h1", prompt: "a cat", output: { kind: "image", url: "https://picsum.photos/seed/h1/768/768" } }],
                  activeId: "h1",
                },
              },
            },
            {
              id: "gen2",
              type: "imageGeneration",
              position: { x: 400, y: 0 },
              data: {
                prompt: "edited",
                history: { entries: [], activeId: null },
                // Issue #30: gen2's `image` handle only renders once a Model
                // is selected — snapshot one so this edge has a handle to
                // attach to.
                model: {
                  endpointId: "fal-ai/edit/model",
                  name: "Edit Model",
                  category: "image-to-image",
                  handles: [{ handleId: "image", label: "image", dataType: "image", many: true }],
                },
              },
            },
          ],
          edges: [{ id: "e1", source: "gen1", target: "gen2", targetHandle: "image" }],
        })}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(1);
    });

    const edgeElement = container.querySelector(".react-flow__edge") as HTMLElement;
    fireEvent.click(edgeElement);
    fireEvent.keyDown(edgeElement, { key: "Delete", code: "Delete" });

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);
    });
  });

  it("removes an edge between differently-typed nodes via the hover-revealed '×' button (ADR-0004 / issue #19)", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CanvasEditor
        canvas={makeCanvas({
          nodes: [
            { id: "ref1", type: "staticTextReference", position: { x: 0, y: 0 }, data: { text: "a red car" } },
            {
              id: "gen1",
              type: "imageGeneration",
              position: { x: 400, y: 0 },
              data: {
                prompt: "in a driveway",
                history: { entries: [], activeId: null },
                // Issue #30: the `text` handle only renders once a Model is
                // selected — snapshot one so this edge has a handle to
                // attach to.
                model: { endpointId: "fal-ai/edit/model", name: "Edit Model", category: "image-to-image", handles: [] },
              },
            },
          ],
          edges: [{ id: "e1", source: "ref1", target: "gen1", targetHandle: "text" }],
        })}
      />,
    );

    expect(await screen.findByText("a red car in a driveway")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Delete edge" })).not.toBeInTheDocument();

    const interactionPath = container.querySelector(
      '[data-testid="deletable-edge-interaction"]',
    ) as HTMLElement;
    fireEvent.mouseEnter(interactionPath);

    const deleteButton = await screen.findByRole("button", { name: "Delete edge" });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(0);
    });
  });
});
