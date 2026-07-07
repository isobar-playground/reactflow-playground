import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AssetLibraryBrowser } from "./asset-library-browser";
import * as libraryActions from "@/app/library-actions";
import type { Asset } from "@/lib/asset-library";

const assets: Asset[] = [
  {
    url: "https://blob.example/cat.png",
    name: "cat.png",
    type: "image",
    uploadedAt: "2026-01-03T00:00:00.000Z",
  },
  {
    url: "https://blob.example/clip.mp4",
    name: "clip.mp4",
    type: "video",
    uploadedAt: "2026-01-02T00:00:00.000Z",
  },
];

describe("AssetLibraryBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a media browser with upload as the primary action and responsive asset previews", () => {
    render(<AssetLibraryBrowser assets={assets} />);

    expect(screen.getByRole("heading", { name: /browse reusable assets/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/upload asset/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "cat.png" })).toHaveAttribute("src", "https://blob.example/cat.png");

    const video = screen.getByTitle("clip.mp4");
    expect(video.tagName.toLowerCase()).toBe("video");
    expect(video).toHaveAttribute("src", "https://blob.example/clip.mp4");
  });

  it("filters the thumbnail grid by all, images, and videos while showing the active filter", async () => {
    const user = userEvent.setup();
    render(<AssetLibraryBrowser assets={assets} />);

    await user.click(screen.getByRole("button", { name: /images/i }));

    expect(screen.getByRole("button", { name: /images/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "cat.png" })).toBeInTheDocument();
    expect(screen.queryByTitle("clip.mp4")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /videos/i }));

    expect(screen.getByRole("button", { name: /videos/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("img", { name: "cat.png" })).not.toBeInTheDocument();
    expect(screen.getByTitle("clip.mp4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^all/i }));

    expect(screen.getByRole("button", { name: /^all/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "cat.png" })).toBeInTheDocument();
    expect(screen.getByTitle("clip.mp4")).toBeInTheDocument();
  });

  it("shows a first-upload empty state when no assets match the current library", () => {
    render(<AssetLibraryBrowser assets={[]} />);

    const emptyState = screen.getByRole("status", { name: /empty asset library/i });
    expect(within(emptyState).getByText(/start by uploading/i)).toBeInTheDocument();
    expect(within(emptyState).getByLabelText(/upload the first asset/i)).toBeInTheDocument();
  });

  it("keeps upload loading and success states understandable", async () => {
    const user = userEvent.setup();
    let resolveUpload: (asset: Asset) => void = () => {};
    vi.spyOn(libraryActions, "uploadAssetAction").mockReturnValue(
      new Promise<Asset>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    render(<AssetLibraryBrowser assets={assets} />);

    const input = screen.getByLabelText(/upload asset/i);
    const file = new File(["new bytes"], "new-cat.png", { type: "image/png" });
    await user.upload(input, file);

    expect(await screen.findByRole("status")).toHaveTextContent("Uploading new-cat.png...");
    expect(screen.getByLabelText(/upload asset/i)).toBeDisabled();

    resolveUpload({
      url: "https://blob.example/new-cat.png",
      name: "new-cat.png",
      type: "image",
      uploadedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(await screen.findByRole("status")).toHaveTextContent("new-cat.png uploaded");
    expect(screen.getByLabelText(/upload asset/i)).not.toBeDisabled();
  });

  it("keeps upload loading and error states understandable", async () => {
    const user = userEvent.setup();
    const uploadError = new Error("Upload failed");
    vi.spyOn(libraryActions, "uploadAssetAction").mockRejectedValue(uploadError);
    render(<AssetLibraryBrowser assets={assets} />);

    const input = screen.getByLabelText(/upload asset/i);
    const file = new File(["bad bytes"], "broken.png", { type: "image/png" });
    await user.upload(input, file);

    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
    await waitFor(() => {
      expect(screen.getByLabelText(/upload asset/i)).not.toBeDisabled();
    });
  });
});
