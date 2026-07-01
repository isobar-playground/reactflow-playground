import { describe, it, expect } from "vitest";
import {
  imageGenerationMode,
  imageGenerationModeLabel,
  videoGenerationMode,
  videoGenerationModeLabel,
} from "./generation-mode";

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

describe("videoGenerationMode", () => {
  it("derives text-to-video when only text is connected", () => {
    expect(videoGenerationMode({ hasImageInput: false, hasVideo: false })).toBe("text-to-video");
  });

  it("derives image-to-video when a frame/image-reference is connected", () => {
    expect(videoGenerationMode({ hasImageInput: true, hasVideo: false })).toBe("image-to-video");
  });

  it("derives video-to-video when a video is connected, even if image inputs are also present", () => {
    expect(videoGenerationMode({ hasImageInput: true, hasVideo: true })).toBe("video-to-video");
  });

  it("derives video-to-video when only a video is connected", () => {
    expect(videoGenerationMode({ hasImageInput: false, hasVideo: true })).toBe("video-to-video");
  });
});

describe("videoGenerationModeLabel", () => {
  it("labels text-to-video mode", () => {
    expect(videoGenerationModeLabel("text-to-video")).toBe("Text → Video");
  });

  it("labels image-to-video mode", () => {
    expect(videoGenerationModeLabel("image-to-video")).toBe("Image → Video");
  });

  it("labels video-to-video mode", () => {
    expect(videoGenerationModeLabel("video-to-video")).toBe("Video → Video");
  });
});
