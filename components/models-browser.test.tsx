import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelsBrowser } from "./models-browser";
import type { Model } from "@/lib/fal-models";

const approveModelAction = vi.fn();
const unapproveModelAction = vi.fn();

vi.mock("@/app/models-actions", () => ({
  approveModelAction: (endpointId: string) => approveModelAction(endpointId),
  unapproveModelAction: (endpointId: string) => unapproveModelAction(endpointId),
}));

beforeEach(() => {
  approveModelAction.mockReset();
  unapproveModelAction.mockReset();
});

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

describe("ModelsBrowser (approvals)", () => {
  it("reflects a Model as approved when its endpoint id is in approvedIds", () => {
    render(
      <ModelsBrowser models={[model()]} approvedIds={["fal-ai/flux/dev"]} />,
    );

    expect(screen.getByRole("checkbox", { name: /approved/i })).toBeChecked();
  });

  it("reflects a Model as not approved when its endpoint id is absent", () => {
    render(<ModelsBrowser models={[model()]} approvedIds={[]} />);

    expect(screen.getByRole("checkbox", { name: /approved/i })).not.toBeChecked();
  });

  it("invokes the approve action when checking an unapproved Model", async () => {
    render(<ModelsBrowser models={[model()]} approvedIds={[]} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /approved/i }));

    expect(approveModelAction).toHaveBeenCalledWith("fal-ai/flux/dev");
    expect(unapproveModelAction).not.toHaveBeenCalled();
  });

  it("invokes the unapprove action when unchecking an approved Model", async () => {
    render(
      <ModelsBrowser models={[model()]} approvedIds={["fal-ai/flux/dev"]} />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /approved/i }));

    expect(unapproveModelAction).toHaveBeenCalledWith("fal-ai/flux/dev");
    expect(approveModelAction).not.toHaveBeenCalled();
  });
});
