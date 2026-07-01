import { describe, it, expect } from "vitest";
import { resolvedPrompt } from "./resolved-prompt";

// resolved-prompt (CONTEXT.md): the final prompt a Generation Node uses —
// the text of all connected Static Text References (in edge order)
// concatenated with the node's own local prompt field.

describe("resolvedPrompt", () => {
  it("is just the local prompt when no text references are connected", () => {
    expect(resolvedPrompt([], "a cat")).toBe("a cat");
  });

  it("is just the connected refs, in order, when the local prompt is empty", () => {
    expect(resolvedPrompt(["a red car", "a happy dog"], "")).toBe("a red car a happy dog");
  });

  it("is an empty string when there are no refs and no local prompt", () => {
    expect(resolvedPrompt([], "")).toBe("");
  });

  it("concatenates multiple refs, in edge order, with the local prompt appended last", () => {
    expect(resolvedPrompt(["a red car", "a happy dog"], "combined in a driveway")).toBe(
      "a red car a happy dog combined in a driveway",
    );
  });
});
