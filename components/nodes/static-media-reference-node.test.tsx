import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import * as assetLibrary from "@/lib/asset-library";
import { StaticMediaReferenceNode, type StaticMediaReferenceNodeData } from "./static-media-reference-node";

const nodeTypes = { staticMediaReference: StaticMediaReferenceNode };

function renderNode(data: StaticMediaReferenceNodeData = { asset: null }) {
  const nodes = [
    {
      id: "n1",
      type: "staticMediaReference",
      position: { x: 0, y: 0 },
      initialWidth: 260,
      initialHeight: 220,
      data,
    },
  ];
  return render(
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} />
    </ReactFlowProvider>,
  );
}

describe("StaticMediaReferenceNode layout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders exactly one handle, marked as a source (output only)", () => {
    const { container } = renderNode();

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles).toHaveLength(1);
    expect(handles[0]).toHaveClass("source");
    expect(handles[0]).not.toHaveClass("target");
  });

  it("shows a prompt to choose an asset when none is selected yet", () => {
    renderNode();

    expect(screen.getByRole("button", { name: /choose asset/i })).toBeInTheDocument();
  });

  it("displays the chosen image asset", () => {
    renderNode({
      asset: { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    });

    const image = screen.getByRole("img", { name: "cat.png" });
    expect(image).toHaveAttribute("src", "https://blob.example/cat.png");
  });

  it("displays the chosen video asset with a video element", () => {
    const { container } = renderNode({
      asset: { url: "https://blob.example/clip.mp4", name: "clip.mp4", type: "video", uploadedAt: "2024-01-01" },
    });

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "https://blob.example/clip.mp4");
  });
});

describe("StaticMediaReferenceNode picker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a picker listing library assets when 'Choose asset' is clicked", async () => {
    vi.spyOn(assetLibrary, "listAssets").mockResolvedValue([
      { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    ]);
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: /choose asset/i }));

    expect(await screen.findByRole("button", { name: "cat.png" })).toBeInTheDocument();
  });

  it("selecting a library asset sets it as the node's chosen asset", async () => {
    vi.spyOn(assetLibrary, "listAssets").mockResolvedValue([
      { url: "https://blob.example/cat.png", name: "cat.png", type: "image", uploadedAt: "2024-01-01" },
    ]);
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: /choose asset/i }));
    await user.click(await screen.findByRole("button", { name: "cat.png" }));

    expect(await screen.findByRole("img", { name: "cat.png" })).toHaveAttribute(
      "src",
      "https://blob.example/cat.png",
    );
  });

  it("uploads a new asset from within the picker and selects it", async () => {
    vi.spyOn(assetLibrary, "listAssets").mockResolvedValue([]);
    vi.spyOn(assetLibrary, "uploadAsset").mockResolvedValue({
      url: "https://blob.example/new-dog.png",
      name: "dog.png",
      type: "image",
      uploadedAt: "2024-01-02",
    });
    const user = userEvent.setup();
    renderNode();

    await user.click(screen.getByRole("button", { name: /choose asset/i }));
    const file = new File(["bytes"], "dog.png", { type: "image/png" });
    const input = await screen.findByLabelText(/upload/i);
    await user.upload(input, file);

    expect(await screen.findByRole("img", { name: "dog.png" })).toHaveAttribute(
      "src",
      "https://blob.example/new-dog.png",
    );
  });
});
