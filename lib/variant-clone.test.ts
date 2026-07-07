import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { cloneVariants } from "./variant-clone";

function historyEntry(id: string) {
  return { id, prompt: "a cat", output: { kind: "image" as const, url: `https://picsum.photos/seed/${id}/768/768` } };
}

function originalNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "orig",
    type: "imageGeneration",
    position: { x: 100, y: 100 },
    data: {
      prompt: "a cat",
      history: {
        entries: [historyEntry("h1")],
        activeId: "h1",
      },
    },
    ...overrides,
  };
}

function emptyHistoryNode(overrides: Partial<Node> = {}): Node {
  return originalNode({
    data: { prompt: "a cat", history: { entries: [], activeId: null } },
    ...overrides,
  });
}

describe("cloneVariants", () => {
  it("produces one new node per requested count", () => {
    const result = cloneVariants(originalNode(), [], 3);

    expect(result.nodes).toHaveLength(3);
  });

  it("gives each clone empty history on a first-generation Variant — nothing yet to inherit (CONTEXT.md)", () => {
    const result = cloneVariants(emptyHistoryNode(), [], 2);

    for (const clone of result.nodes) {
      expect(clone.data.history).toEqual({ entries: [], activeId: null });
    }
  });

  it("gives each clone the original's History up to the branch point on an Edit (ADR-0013)", () => {
    const result = cloneVariants(originalNode(), [], 2);

    for (const clone of result.nodes) {
      expect(clone.data.history).toEqual({ entries: [historyEntry("h1")], activeId: "h1" });
    }
  });

  it("truncates a clone's inherited History to the active (not necessarily newest) entry", () => {
    const original = originalNode({
      data: {
        prompt: "a cat",
        history: { entries: [historyEntry("h1"), historyEntry("h2")], activeId: "h1" },
      },
    });

    const result = cloneVariants(original, [], 1);

    expect(result.nodes[0].data.history).toEqual({ entries: [historyEntry("h1")], activeId: "h1" });
  });

  it("replicates each incoming edge onto every clone, retargeted to that clone", () => {
    const incoming: Edge = {
      id: "e1",
      source: "text1",
      target: "orig",
      targetHandle: "text",
    };
    const result = cloneVariants(originalNode(), [incoming], 2);

    expect(result.edges).toHaveLength(2);
    const [clone1, clone2] = result.nodes;
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "text1", target: clone1.id, targetHandle: "text" }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "text1", target: clone2.id, targetHandle: "text" }),
    );
  });

  it("does not replicate the original's outgoing edges onto any clone", () => {
    const outgoing: Edge = { id: "e2", source: "orig", target: "downstream", targetHandle: "image" };
    const result = cloneVariants(originalNode(), [outgoing], 2);

    expect(result.edges).toHaveLength(0);
    for (const clone of result.nodes) {
      expect(result.edges.some((edge) => edge.source === clone.id)).toBe(false);
    }
  });

  it("lays out every clone at a distinct offset from the original and from each other", () => {
    const original = originalNode();
    const result = cloneVariants(original, [], 3);

    const positions = [original.position, ...result.nodes.map((node) => node.position)];
    const seen = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(positions.length);
  });

  it("gives each clone its own id, distinct from the original and from every other clone", () => {
    const original = originalNode();
    const result = cloneVariants(original, [], 3);

    const ids = result.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(original.id);
  });
});
