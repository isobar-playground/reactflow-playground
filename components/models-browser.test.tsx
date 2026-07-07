import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelsBrowser } from "./models-browser";
import type { Model } from "@/lib/fal-models";

const approveModelAction = vi.fn();
const unapproveModelAction = vi.fn();
const fetchCatalogPricingAction = vi.fn();
const fetchCatalogPricingChunkAction = vi.fn();
const setEditPairAction = vi.fn();
const clearEditPairAction = vi.fn();

vi.mock("@/app/models-actions", () => ({
  approveModelAction: (endpointId: string) => approveModelAction(endpointId),
  unapproveModelAction: (endpointId: string) => unapproveModelAction(endpointId),
  fetchCatalogPricingAction: (endpointIds: string[]) => fetchCatalogPricingAction(endpointIds),
  fetchCatalogPricingChunkAction: (endpointIds: string[]) => fetchCatalogPricingChunkAction(endpointIds),
  setEditPairAction: (baseEndpointId: string, editEndpointId: string) =>
    setEditPairAction(baseEndpointId, editEndpointId),
  clearEditPairAction: (baseEndpointId: string) => clearEditPairAction(baseEndpointId),
}));

beforeEach(() => {
  approveModelAction.mockReset();
  unapproveModelAction.mockReset();
  fetchCatalogPricingAction.mockReset().mockResolvedValue({});
  fetchCatalogPricingChunkAction.mockReset().mockResolvedValue({ prices: {} });
  setEditPairAction.mockReset();
  clearEditPairAction.mockReset();
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

  it("shows total, visible, and approved Model counts", () => {
    render(
      <ModelsBrowser
        models={[
          model({ endpointId: "fal-ai/flux/dev", name: "FLUX.1 [dev]" }),
          model({ endpointId: "fal-ai/kling/video", name: "Kling Video" }),
          model({ endpointId: "fal-ai/veo/video", name: "Veo Video" }),
        ]}
        approvedIds={["fal-ai/flux/dev", "fal-ai/veo/video"]}
      />,
    );

    expect(screen.getByText("3 total")).toBeInTheDocument();
    expect(screen.getByText("3 visible")).toBeInTheDocument();
    expect(screen.getByText("2 approved")).toBeInTheDocument();
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

  it("makes approval state prominent on each Model row", () => {
    render(
      <ModelsBrowser
        models={[model({ endpointId: "fal-ai/flux/dev", name: "FLUX.1 [dev]" })]}
        approvedIds={["fal-ai/flux/dev"]}
      />,
    );

    const card = screen.getByRole("listitem");
    expect(within(card).getByText("Approved Model")).toBeInTheDocument();
    expect(within(card).getByRole("checkbox", { name: /approved/i })).toBeChecked();
  });
});

describe("ModelsBrowser (Edit Model pairing, CONTEXT.md's Edit Model / ADR-0014)", () => {
  const flux = model({ endpointId: "fal-ai/flux/dev", name: "FLUX.1 [dev]", category: "text-to-image" });
  const nanoBanana = model({
    endpointId: "fal-ai/nano-banana/edit",
    name: "Nano Banana Edit",
    category: "image-to-image",
  });

  it("offers no pairing selector for an unapproved text-to-image Model", () => {
    render(<ModelsBrowser models={[flux, nanoBanana]} approvedIds={[]} />);

    expect(screen.queryByRole("combobox", { name: /Edit Model/i })).not.toBeInTheDocument();
  });

  it("offers no pairing selector for an image-to-image Model — it edits with itself", () => {
    render(
      <ModelsBrowser models={[nanoBanana]} approvedIds={["fal-ai/nano-banana/edit"]} />,
    );

    expect(screen.queryByRole("combobox", { name: /Edit Model/i })).not.toBeInTheDocument();
  });

  it("offers approved image-to-image Models as Edit Model options for an approved text-to-image Model", () => {
    render(
      <ModelsBrowser
        models={[flux, nanoBanana]}
        approvedIds={["fal-ai/flux/dev", "fal-ai/nano-banana/edit"]}
      />,
    );

    const select = screen.getByRole("combobox", { name: /Edit Model for FLUX/i });
    expect(within(select).getByRole("option", { name: "Nano Banana Edit" })).toBeInTheDocument();
  });

  it("reflects an existing pairing as the selector's current value", () => {
    render(
      <ModelsBrowser
        models={[flux, nanoBanana]}
        approvedIds={["fal-ai/flux/dev", "fal-ai/nano-banana/edit"]}
        editPairs={{ "fal-ai/flux/dev": "fal-ai/nano-banana/edit" }}
      />,
    );

    expect(screen.getByRole("combobox", { name: /Edit Model for FLUX/i })).toHaveValue(
      "fal-ai/nano-banana/edit",
    );
  });

  it("invokes setEditPairAction when pairing an approved text-to-image Model", async () => {
    render(
      <ModelsBrowser
        models={[flux, nanoBanana]}
        approvedIds={["fal-ai/flux/dev", "fal-ai/nano-banana/edit"]}
      />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Edit Model for FLUX/i }),
      "fal-ai/nano-banana/edit",
    );

    expect(setEditPairAction).toHaveBeenCalledWith("fal-ai/flux/dev", "fal-ai/nano-banana/edit");
    expect(clearEditPairAction).not.toHaveBeenCalled();
  });

  it("invokes clearEditPairAction when clearing an existing pairing", async () => {
    render(
      <ModelsBrowser
        models={[flux, nanoBanana]}
        approvedIds={["fal-ai/flux/dev", "fal-ai/nano-banana/edit"]}
        editPairs={{ "fal-ai/flux/dev": "fal-ai/nano-banana/edit" }}
      />,
    );

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Edit Model for FLUX/i }), "");

    expect(clearEditPairAction).toHaveBeenCalledWith("fal-ai/flux/dev");
    expect(setEditPairAction).not.toHaveBeenCalled();
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
    expect(screen.getByText("1 visible")).toBeInTheDocument();
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

  it("shows a clear empty state when the approved filter has no results", async () => {
    render(<ModelsBrowser models={[flux, kling]} approvedIds={[]} />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /approval/i }),
      "approved",
    );

    expect(screen.queryByText("FLUX.1 [dev]")).not.toBeInTheDocument();
    expect(screen.queryByText("Kling Video")).not.toBeInTheDocument();
    expect(screen.getByText(/no approved models yet/i)).toBeInTheDocument();
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

  it("lazily fetches and shows a Model's Unit Price once resolved", async () => {
    fetchCatalogPricingAction.mockResolvedValue({
      "fal-ai/flux/dev": { unitPrice: 0.14, unit: "seconds", currency: "USD" },
    });

    render(<ModelsBrowser models={[model()]} />);

    expect(await screen.findByText("$0.14 / second")).toBeInTheDocument();
    expect(fetchCatalogPricingAction).toHaveBeenCalledWith(["fal-ai/flux/dev"]);
  });

  it("shows no Unit Price on a Model's card when the pricing fetch resolves nothing for it", async () => {
    render(<ModelsBrowser models={[model()]} />);

    await waitFor(() => expect(fetchCatalogPricingAction).toHaveBeenCalled());
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("skips the pricing fetch (and shows a hint + button) when more models are visible than the auto-fetch cap", () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      model({ endpointId: `fal-ai/model-${i}`, name: `Model ${i}` }),
    );

    render(<ModelsBrowser models={many} />);

    expect(fetchCatalogPricingAction).not.toHaveBeenCalled();
    expect(screen.getByText(/narrow your search/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load them anyway/i })).toBeInTheDocument();
  });

  it("'load them anyway' fetches the first chunk immediately and shows progress", async () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      model({ endpointId: `fal-ai/model-${i}`, name: `Model ${i}` }),
    );
    fetchCatalogPricingChunkAction.mockResolvedValueOnce({
      prices: { "fal-ai/model-0": { unitPrice: 0.01, unit: "images", currency: "USD" } },
    });

    render(<ModelsBrowser models={many} />);
    await userEvent.click(screen.getByRole("button", { name: /load them anyway/i }));

    expect(await screen.findByText("$0.01 / image")).toBeInTheDocument();
    expect(fetchCatalogPricingChunkAction).toHaveBeenCalledWith(
      Array.from({ length: 30 }, (_, i) => `fal-ai/model-${i}`),
    );
    expect(screen.getByRole("button", { name: /loading prices.*1\/2/i })).toBeDisabled();
  });

  it("'load them anyway' works through every chunk, then reverts the button", async () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      model({ endpointId: `fal-ai/model-${i}`, name: `Model ${i}` }),
    );
    fetchCatalogPricingChunkAction
      .mockResolvedValueOnce({
        prices: { "fal-ai/model-0": { unitPrice: 0.01, unit: "images", currency: "USD" } },
      })
      .mockResolvedValueOnce({
        prices: { "fal-ai/model-30": { unitPrice: 0.02, unit: "images", currency: "USD" } },
      });

    render(<ModelsBrowser models={many} />);
    await userEvent.click(screen.getByRole("button", { name: /load them anyway/i }));

    expect(await screen.findByText("$0.01 / image")).toBeInTheDocument();
    expect(await screen.findByText("$0.02 / image", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(fetchCatalogPricingChunkAction).toHaveBeenCalledTimes(2);
    expect(fetchCatalogPricingChunkAction).toHaveBeenLastCalledWith(["fal-ai/model-30"]);
    expect(await screen.findByRole("button", { name: /^load them anyway/i })).not.toBeDisabled();
  }, 10000);

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
