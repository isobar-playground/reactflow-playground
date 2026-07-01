import { describe, it, expect } from "vitest";
import { imageGenerationMode, imageGenerationModeLabel } from "./generation-mode";

// generation-mode (CONTEXT.md / issue #10): a Generation Node's mode is
// derived from which inputs are connected, never chosen by hand. Image Gen:
// text only -> text->image; any image present -> image->image (edit).

describe("imageGenerationMode", () => {
  it("derives text-to-image when no image is connected", () => {
    expect(imageGenerationMode(false)).toBe("text-to-image");
  });

  it("derives image-to-image (edit) when any image is connected", () => {
    expect(imageGenerationMode(true)).toBe("image-to-image");
  });
});

describe("imageGenerationModeLabel", () => {
  it("labels text-to-image mode", () => {
    expect(imageGenerationModeLabel("text-to-image")).toBe("Text → Image");
  });

  it("labels image-to-image mode as edit", () => {
    expect(imageGenerationModeLabel("image-to-image")).toBe("Image → Image (Edit)");
  });
});
