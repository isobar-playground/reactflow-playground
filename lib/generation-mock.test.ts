import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateImagePlaceholder, generateVideoPlaceholder } from "./generation-mock";

describe("generateImagePlaceholder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to an image placeholder from picsum.photos after a short delay", async () => {
    const promise = generateImagePlaceholder();

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // Still pending immediately after the call.
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.kind).toBe("image");
    expect(result.url).toMatch(/^https:\/\/picsum\.photos\/seed\/.+\/\d+\/\d+$/);
  });
});

describe("generateVideoPlaceholder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to the bundled looping sample mp4 after a short delay", async () => {
    const promise = generateVideoPlaceholder();

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.kind).toBe("video");
    expect(result.url).toBe("/sample-video.mp4");
  });
});
