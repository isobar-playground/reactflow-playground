import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import {
  reconcileEdges,
  firstCompatibleHandle,
  resolveEdgeDataTypeFromNodes,
  type ResolveEdgeDataType,
} from "./edge-reconcile";
import type { ResolvedHandle } from "./fal-schema";

// edge-reconcile (CONTEXT.md's Handle-Spawned Node / ADR-0008, issue #33):
// re-selecting a Generation Node's Model recomputes its handle snapshot and
// silently drops input edges the new snapshot no longer supports.

const imageUrlsHandle: ResolvedHandle = {
  handleId: "image_urls",
  label: "image_urls",
  dataType: "image",
  many: true,
};
const videoUrlHandle: ResolvedHandle = {
  handleId: "video_url",
  label: "video_url",
  dataType: "video",
  many: false,
};

function edge(overrides: Partial<Edge>): Edge {
  return {
    id: overrides.id ?? "e1",
    source: overrides.source ?? "src1",
    target: overrides.target ?? "gen1",
    targetHandle: overrides.targetHandle ?? "image_urls",
    ...overrides,
  };
}

describe("reconcileEdges", () => {
  it("drops an input edge whose target handle is absent from the new snapshot", () => {
    const edges = [edge({ id: "e1", targetHandle: "video_url" })];
    const resolveEdgeDataType: ResolveEdgeDataType = () => "video";

    const result = reconcileEdges(edges, "gen1", [imageUrlsHandle], resolveEdgeDataType);

    expect(result).toEqual([]);
  });

  it("keeps an input edge whose target handle is present and type-compatible", () => {
    const edges = [edge({ id: "e1", targetHandle: "image_urls" })];
    const resolveEdgeDataType: ResolveEdgeDataType = () => "image";

    const result = reconcileEdges(edges, "gen1", [imageUrlsHandle], resolveEdgeDataType);

    expect(result).toEqual(edges);
  });

  it("drops an input edge whose target handle id is reused by the new Model with an incompatible type", () => {
    // Same handleId as before, but the newly-selected Model's schema now
    // types it differently (e.g. a video field where an image field used to
    // be) — the edge's actual source data type no longer matches.
    const edges = [edge({ id: "e1", targetHandle: "image_urls" })];
    const resolveEdgeDataType: ResolveEdgeDataType = () => "image";
    const retypedHandle: ResolvedHandle = { ...imageUrlsHandle, dataType: "video" };

    const result = reconcileEdges(edges, "gen1", [retypedHandle], resolveEdgeDataType);

    expect(result).toEqual([]);
  });

  it("re-selecting the same Model (identical handles) is a no-op for edges", () => {
    const edges = [
      edge({ id: "e1", targetHandle: "image_urls" }),
      edge({ id: "e2", targetHandle: "video_url", source: "src2" }),
    ];
    const resolveEdgeDataType: ResolveEdgeDataType = (e) =>
      e.targetHandle === "image_urls" ? "image" : "video";

    const result = reconcileEdges(edges, "gen1", [imageUrlsHandle, videoUrlHandle], resolveEdgeDataType);

    expect(result).toEqual(edges);
  });

  it("always keeps the fixed text handle, which is never part of the Model snapshot", () => {
    const edges = [edge({ id: "e1", targetHandle: "text" })];
    const resolveEdgeDataType: ResolveEdgeDataType = () => "text";

    const result = reconcileEdges(edges, "gen1", [], resolveEdgeDataType);

    expect(result).toEqual(edges);
  });

  it("leaves edges targeting other nodes untouched", () => {
    const edges = [edge({ id: "e1", target: "otherNode", targetHandle: "video_url" })];
    const resolveEdgeDataType: ResolveEdgeDataType = () => "video";

    const result = reconcileEdges(edges, "gen1", [imageUrlsHandle], resolveEdgeDataType);

    expect(result).toEqual(edges);
  });
});

describe("resolveEdgeDataTypeFromNodes", () => {
  it("resolves a fixed-output source node type via SOURCE_DATA_TYPE", () => {
    const getNode = (id: string) =>
      id === "src1" ? ({ id: "src1", type: "staticTextReference", position: { x: 0, y: 0 }, data: {} } as const) : undefined;

    expect(resolveEdgeDataTypeFromNodes(getNode)(edge({ source: "src1" }))).toBe("text");
  });

  it("resolves a Static Media Reference's per-instance asset type", () => {
    const getNode = () =>
      ({
        id: "src1",
        type: "staticMediaReference",
        position: { x: 0, y: 0 },
        data: { asset: { type: "video" } },
      }) as const;

    expect(resolveEdgeDataTypeFromNodes(getNode)(edge({ source: "src1" }))).toBe("video");
  });

  it("resolves an unset Static Media Reference (no asset chosen) as null", () => {
    const getNode = () =>
      ({ id: "src1", type: "staticMediaReference", position: { x: 0, y: 0 }, data: { asset: null } }) as const;

    expect(resolveEdgeDataTypeFromNodes(getNode)(edge({ source: "src1" }))).toBeNull();
  });
});

describe("firstCompatibleHandle", () => {
  it("returns the first handle in schema order accepting the given data type", () => {
    const handles = [videoUrlHandle, imageUrlsHandle];

    expect(firstCompatibleHandle(handles, "image")).toEqual(imageUrlsHandle);
  });

  it("returns null when no handle accepts the data type (schema-order tie-break: earliest wins when several match)", () => {
    const secondImageHandle: ResolvedHandle = {
      handleId: "mask_url",
      label: "mask_url",
      dataType: "image",
      many: false,
    };
    const handles = [imageUrlsHandle, secondImageHandle];

    expect(firstCompatibleHandle(handles, "image")).toEqual(imageUrlsHandle);
    expect(firstCompatibleHandle(handles, "video")).toBeNull();
  });
});
