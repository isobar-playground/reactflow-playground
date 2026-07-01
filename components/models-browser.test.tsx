import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelsBrowser } from "./models-browser";
import type { Model } from "@/lib/fal-models";

function model(overrides: Partial<Model> = {}): Model {
  return {
    endpointId: "fal-ai/flux/dev",
    name: "FLUX.1 [dev]",
    category: "text-to-image",
    description: "A fast text-to-image model.",
    tags: ["flux"],
    thumbnailUrl: "https://fal.media/flux-dev.png",
    ...overrides,
  };
}

describe("ModelsBrowser (read-only catalog)", () => {
  it("renders each Model's display name, category, and description", () => {
    render(<ModelsBrowser models={[model()]} />);

    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
    expect(screen.getByText("text-to-image")).toBeInTheDocument();
    expect(screen.getByText("A fast text-to-image model.")).toBeInTheDocument();
  });

  it("renders a thumbnail when FAL provides one", () => {
    render(<ModelsBrowser models={[model()]} />);

    const thumb = screen.getByRole("img", { name: "FLUX.1 [dev]" });
    expect(thumb).toHaveAttribute("src", "https://fal.media/flux-dev.png");
  });

  it("renders no thumbnail image when FAL provides none", () => {
    render(<ModelsBrowser models={[model({ thumbnailUrl: undefined })]} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
  });

  it("shows an empty state when the catalog is empty", () => {
    render(<ModelsBrowser models={[]} />);

    expect(screen.getByText(/no models/i)).toBeInTheDocument();
  });
});
