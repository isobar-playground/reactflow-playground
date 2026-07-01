import { describe, it, expect } from "vitest";
import { NODE_TYPE_OPTIONS, shouldShowEmptyCanvasMenu, createNodeAt } from "./add-node-menu";

describe("add-node-menu", () => {
  it("lists exactly the four node types as a flat list", () => {
    expect(NODE_TYPE_OPTIONS.map((option) => option.type)).toEqual([
      "staticMediaReference",
      "staticTextReference",
      "imageGeneration",
      "videoGeneration",
    ]);
  });

  it("shows the empty-canvas menu when there are no nodes", () => {
    expect(shouldShowEmptyCanvasMenu(0)).toBe(true);
  });

  it("hides the empty-canvas menu once at least one node exists", () => {
    expect(shouldShowEmptyCanvasMenu(1)).toBe(false);
    expect(shouldShowEmptyCanvasMenu(3)).toBe(false);
  });

  it("creates a node at the given position with a fresh id", () => {
    const node = createNodeAt("staticTextReference", { x: 120, y: 40 });

    expect(node.type).toBe("staticTextReference");
    expect(node.position).toEqual({ x: 120, y: 40 });
    expect(node.id).toEqual(expect.any(String));
  });

  it("gives each created node a unique id", () => {
    const first = createNodeAt("staticTextReference", { x: 0, y: 0 });
    const second = createNodeAt("staticTextReference", { x: 0, y: 0 });

    expect(first.id).not.toBe(second.id);
  });

  it("creates an Image Generation Node with an empty prompt and empty history", () => {
    const node = createNodeAt("imageGeneration", { x: 0, y: 0 });

    expect(node.type).toBe("imageGeneration");
    expect(node.data).toEqual({ prompt: "", history: { entries: [], activeId: null } });
  });

  it("creates a Static Media Reference with no asset chosen yet", () => {
    const node = createNodeAt("staticMediaReference", { x: 0, y: 0 });

    expect(node.type).toBe("staticMediaReference");
    expect(node.data).toEqual({ asset: null });
  });

  it("creates a Video Generation Node with an empty prompt and empty history", () => {
    const node = createNodeAt("videoGeneration", { x: 0, y: 0 });

    expect(node.type).toBe("videoGeneration");
    expect(node.data).toEqual({ prompt: "", history: { entries: [], activeId: null } });
  });
});
