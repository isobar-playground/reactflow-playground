import { describe, expect, it } from "vitest";
import {
  buildCanvasDashboardItems,
  type DashboardCanvas,
} from "./canvas-dashboard";

function canvas(
  id: string,
  updatedAt: string,
  nodes: unknown[],
  name = `Canvas ${id}`,
): DashboardCanvas {
  return {
    id,
    name,
    updatedAt,
    graph: { nodes },
  };
}

function generationNode(entries: unknown[]) {
  return {
    id: "gen",
    type: "imageGeneration",
    data: {
      history: {
        entries,
        activeId: null,
      },
    },
  };
}

function imageEntry(id: string, createdAt?: string, actualCost?: number) {
  return {
    id,
    prompt: `prompt ${id}`,
    output: { kind: "image", url: `https://example.com/${id}.png` },
    createdAt,
    actualCost,
  };
}

describe("buildCanvasDashboardItems", () => {
  it("excludes canvases without generated History outputs", () => {
    const items = buildCanvasDashboardItems([
      canvas("empty", "2026-07-07T10:00:00.000Z", []),
      canvas("text", "2026-07-07T10:00:00.000Z", [
        { id: "text", type: "staticTextReference", data: { text: "hello" } },
      ]),
      canvas("generated", "2026-07-07T10:00:00.000Z", [
        generationNode([imageEntry("a", "2026-07-07T09:00:00.000Z")]),
      ]),
    ]);

    expect(items.map((item) => item.id)).toEqual(["generated"]);
  });

  it("sorts canvases by latest generated asset timestamp, newest first", () => {
    const items = buildCanvasDashboardItems([
      canvas("older", "2026-07-07T10:00:00.000Z", [
        generationNode([imageEntry("old", "2026-07-07T08:00:00.000Z")]),
      ]),
      canvas("newer", "2026-07-07T09:00:00.000Z", [
        generationNode([imageEntry("new", "2026-07-07T11:00:00.000Z")]),
      ]),
    ]);

    expect(items.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("uses deterministic legacy fallback recency from History order and canvas updatedAt", () => {
    const items = buildCanvasDashboardItems([
      canvas("legacy-a", "2026-07-07T10:00:00.000Z", [
        generationNode([imageEntry("a1"), imageEntry("a2")]),
      ]),
      canvas("legacy-b", "2026-07-07T11:00:00.000Z", [
        generationNode([imageEntry("b1")]),
      ]),
    ]);

    expect(items.map((item) => item.id)).toEqual(["legacy-b", "legacy-a"]);
    expect(items.find((item) => item.id === "legacy-a")?.latestGeneratedAt).toBe(
      "2026-07-07T10:00:00.001Z",
    );
  });

  it("selects at most five most recent outputs with newest on top", () => {
    const items = buildCanvasDashboardItems([
      canvas("many", "2026-07-07T10:00:00.000Z", [
        generationNode([
          imageEntry("1", "2026-07-07T10:01:00.000Z"),
          imageEntry("2", "2026-07-07T10:02:00.000Z"),
          imageEntry("3", "2026-07-07T10:03:00.000Z"),
          imageEntry("4", "2026-07-07T10:04:00.000Z"),
          imageEntry("5", "2026-07-07T10:05:00.000Z"),
          imageEntry("6", "2026-07-07T10:06:00.000Z"),
        ]),
      ]),
    ]);

    expect(items[0].previews).toHaveLength(5);
    expect(items[0].previews.map((preview) => preview.id)).toEqual(["6", "5", "4", "3", "2"]);
  });

  it("sums known Actual Cost across generated History outputs", () => {
    const items = buildCanvasDashboardItems([
      canvas("costed", "2026-07-07T10:00:00.000Z", [
        generationNode([
          imageEntry("a", "2026-07-07T10:00:00.000Z", 0.1),
          imageEntry("b", "2026-07-07T10:01:00.000Z", 0.2),
          imageEntry("c", "2026-07-07T10:02:00.000Z"),
        ]),
      ]),
    ]);

    expect(items[0].totalActualCost).toBeCloseTo(0.3);
  });
});
