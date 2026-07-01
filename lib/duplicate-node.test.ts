import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { duplicateNode } from "./duplicate-node";

function originalNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "orig",
    type: "staticTextReference",
    position: { x: 100, y: 100 },
    data: { text: "hello" },
    ...overrides,
  };
}

describe("duplicateNode", () => {
  it("gives the duplicate its own id, distinct from the original", () => {
    const result = duplicateNode(originalNode(), []);

    expect(result.node.id).not.toBe("orig");
  });

  it("copies the original's data as-is rather than resetting it", () => {
    const generationNode = originalNode({
      type: "imageGeneration",
      data: { prompt: "a cat", history: { entries: [{ id: "h1" }], activeId: "h1" } },
    });

    const result = duplicateNode(generationNode, []);

    expect(result.node.data).toEqual(generationNode.data);
  });

  it("lays out the duplicate at an offset from the original", () => {
    const original = originalNode();
    const result = duplicateNode(original, []);

    expect(result.node.position).not.toEqual(original.position);
  });

  it("replicates each incoming edge, retargeted to the duplicate", () => {
    const incoming: Edge = { id: "e1", source: "text1", target: "orig", targetHandle: "text" };
    const result = duplicateNode(originalNode(), [incoming]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: "text1", target: result.node.id, targetHandle: "text" });
    expect(result.edges[0].id).not.toBe("e1");
  });

  it("does not replicate the original's outgoing edges", () => {
    const outgoing: Edge = { id: "e2", source: "orig", target: "downstream", targetHandle: "image" };
    const result = duplicateNode(originalNode(), [outgoing]);

    expect(result.edges).toHaveLength(0);
  });

  it("does not carry the original's selected state onto the duplicate", () => {
    const result = duplicateNode(originalNode({ selected: true }), []);

    expect(result.node.selected).toBe(false);
  });
});
