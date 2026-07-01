import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import * as generationMock from "@/lib/generation-mock";
import { ImageGenerationNode, type ImageGenerationNodeData } from "./image-generation-node";

const nodeTypes = { imageGeneration: ImageGenerationNode };

function renderNode(data: ImageGenerationNodeData = { prompt: "", output: null }) {
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

  it("renders exactly one handle, marked as a source (output only)", () => {
    const { container } = renderNode();

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles).toHaveLength(1);
    expect(handles[0]).toHaveClass("source");
    expect(handles[0]).not.toHaveClass("target");
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

describe("ImageGenerationNode persistence", () => {
  it("restores a saved prompt and output without regenerating", () => {
    renderNode({ prompt: "saved prompt", output: { kind: "image", url: "https://picsum.photos/seed/xyz/768/768" } });

    expect(screen.getByPlaceholderText(/prompt/i)).toHaveValue("saved prompt");
    const image = screen.getByRole("img", { name: /output/i });
    expect(image).toHaveAttribute("src", "https://picsum.photos/seed/xyz/768/768");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});
