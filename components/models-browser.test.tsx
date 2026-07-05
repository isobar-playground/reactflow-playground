import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    // "text-to-image" also appears as a category filter <option>, so scope the
    // badge assertion to the rendered Model card (the list item).
    const card = screen.getByRole("listitem");
    expect(within(card).getByText("text-to-image")).toBeInTheDocument();
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

describe("ModelsBrowser (search and filters)", () => {
  const flux = model({
    endpointId: "fal-ai/flux/dev",
    name: "FLUX.1 [dev]",
    category: "text-to-image",
    description: "",
    tags: [],
  });
  const kling = model({
    endpointId: "fal-ai/kling/video",
    name: "Kling Video",
    category: "text-to-video",
    description: "",
    tags: [],
  });

  it("narrows the list as text is typed into the search box", async () => {
    render(<ModelsBrowser models={[flux, kling]} />);

    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
    expect(screen.getByText("Kling Video")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "kling");

    expect(screen.queryByText("FLUX.1 [dev]")).not.toBeInTheDocument();
    expect(screen.getByText("Kling Video")).toBeInTheDocument();
  });

  it("narrows the list when a category filter is chosen", async () => {
    render(<ModelsBrowser models={[flux, kling]} />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /category/i }),
      "text-to-video",
    );

    expect(screen.queryByText("FLUX.1 [dev]")).not.toBeInTheDocument();
    expect(screen.getByText("Kling Video")).toBeInTheDocument();
  });

  it("narrows the list when the approval filter is toggled", async () => {
    render(
      <ModelsBrowser
        models={[flux, kling]}
        approvedIds={["fal-ai/flux/dev"]}
      />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /approval/i }),
      "approved",
    );

    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
    expect(screen.queryByText("Kling Video")).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /approval/i }),
      "not-approved",
    );

    expect(screen.queryByText("FLUX.1 [dev]")).not.toBeInTheDocument();
    expect(screen.getByText("Kling Video")).toBeInTheDocument();
  });

  it("shows an empty state when a search matches no models", async () => {
    render(<ModelsBrowser models={[flux, kling]} />);

    await userEvent.type(screen.getByRole("searchbox"), "nonexistent");

    expect(screen.queryByText("FLUX.1 [dev]")).not.toBeInTheDocument();
    expect(screen.queryByText("Kling Video")).not.toBeInTheDocument();
    expect(screen.getByText(/no models match/i)).toBeInTheDocument();
  });

  it("lists only derived families with >= 2 Models in the dropdown", () => {
    const klingVideo = model({ endpointId: "fal-ai/kling-video/v3", name: "Kling Video" });
    const klingImage = model({ endpointId: "fal-ai/kling-image/v2", name: "Kling Image" });
    const oneOff = model({ endpointId: "fal-ai/one-off-thing/v1", name: "One Off" });

    render(<ModelsBrowser models={[klingVideo, klingImage, oneOff]} />);

    const familySelect = screen.getByRole("combobox", { name: /family/i });
    expect(within(familySelect).getByText("Kling")).toBeInTheDocument();
    expect(within(familySelect).queryByText("One Off")).not.toBeInTheDocument();
  });

  it("narrows the list when a family is chosen, and 'All families' clears it", async () => {
    const klingVideo = model({ endpointId: "fal-ai/kling-video/v3", name: "Kling Video" });
    const klingImage = model({ endpointId: "fal-ai/kling-image/v2", name: "Kling Image" });
    const ltx = model({ endpointId: "fal-ai/ltx/dev", name: "LTX Model" });
    const ltxVideo = model({ endpointId: "fal-ai/ltx-video/v1", name: "LTX Video Model" });

    render(<ModelsBrowser models={[klingVideo, klingImage, ltx, ltxVideo]} />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /family/i }),
      "Kling",
    );

    expect(screen.getByText("Kling Video")).toBeInTheDocument();
    expect(screen.getByText("Kling Image")).toBeInTheDocument();
    expect(screen.queryByText("LTX Model")).not.toBeInTheDocument();
    expect(screen.queryByText("LTX Video Model")).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /family/i }),
      "All families",
    );

    expect(screen.getByText("Kling Video")).toBeInTheDocument();
    expect(screen.getByText("LTX Model")).toBeInTheDocument();
  });

  it("keeps a singleton-family Model findable via search though absent from the dropdown", async () => {
    const klingVideo = model({ endpointId: "fal-ai/kling-video/v3", name: "Kling Video" });
    const klingImage = model({ endpointId: "fal-ai/kling-image/v2", name: "Kling Image" });
    const oneOff = model({ endpointId: "fal-ai/one-off-thing/v1", name: "One Off Model" });

    render(<ModelsBrowser models={[klingVideo, klingImage, oneOff]} />);

    const familySelect = screen.getByRole("combobox", { name: /family/i });
    expect(within(familySelect).queryByText("One Off Model")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "One Off");

    expect(screen.getByText("One Off Model")).toBeInTheDocument();
  });

  it("orders newest-added first by default and flips when sorted oldest", async () => {
    const old = model({ endpointId: "a", name: "Old Model", addedAt: "2025-01-01T00:00:00Z" });
    const recent = model({ endpointId: "b", name: "Recent Model", addedAt: "2026-06-01T00:00:00Z" });
    render(<ModelsBrowser models={[old, recent]} />);

    const namesOf = () =>
      screen.getAllByRole("listitem").map((li) => within(li).getByText(/Model$/).textContent);
    expect(namesOf()).toEqual(["Recent Model", "Old Model"]);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /sort/i }),
      "oldest",
    );
    expect(namesOf()).toEqual(["Old Model", "Recent Model"]);
  });
});
