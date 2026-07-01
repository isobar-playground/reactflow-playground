import { describe, it, expect, beforeEach } from "vitest";
import { getDb, migrate, resetDbForTests } from "./db";
import {
  createCanvas,
  listCanvases,
  getCanvas,
  renameCanvas,
  deleteCanvas,
  updateGraph,
} from "./canvas-repo";

describe("canvas-repo", () => {
  beforeEach(async () => {
    delete process.env.DATABASE_URL; // force the local (PGlite) branch
    process.env.PGLITE_DIR = "memory://"; // ephemeral per test run
    resetDbForTests();
    await migrate(await getDb());
  });

  it("creates a new canvas named 'Untitled' with an empty graph", async () => {
    const canvas = await createCanvas();

    expect(canvas.name).toBe("Untitled");
    expect(canvas.graph).toEqual({});
    expect(canvas.id).toEqual(expect.any(String));
  });

  it("lists all created canvases", async () => {
    const first = await createCanvas();
    const second = await createCanvas();

    const canvases = await listCanvases();

    expect(canvases.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("opens a single canvas by id", async () => {
    const created = await createCanvas();

    const opened = await getCanvas(created.id);

    expect(opened).toEqual(created);
  });

  it("returns undefined when opening a canvas that doesn't exist", async () => {
    const opened = await getCanvas("00000000-0000-0000-0000-000000000000");

    expect(opened).toBeUndefined();
  });

  it("renames a canvas", async () => {
    const created = await createCanvas();

    const renamed = await renameCanvas(created.id, "My cool canvas");

    expect(renamed?.name).toBe("My cool canvas");
    expect((await getCanvas(created.id))?.name).toBe("My cool canvas");
  });

  it("deletes a canvas", async () => {
    const created = await createCanvas();

    await deleteCanvas(created.id);

    expect(await getCanvas(created.id)).toBeUndefined();
    expect(await listCanvases()).toEqual([]);
  });

  it("round-trips a graph (nodes, edges, viewport) through updateGraph", async () => {
    const created = await createCanvas();
    const graph = {
      nodes: [{ id: "n1", position: { x: 10, y: 20 }, data: { label: "A" } }],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
      viewport: { x: 1, y: 2, zoom: 1.5 },
    };

    await updateGraph(created.id, graph);

    const reopened = await getCanvas(created.id);
    expect(reopened?.graph).toEqual(graph);
  });

  it("bumps updated_at when the graph is saved", async () => {
    const created = await createCanvas();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateGraph(created.id, { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

    const reopened = await getCanvas(created.id);
    expect(new Date(reopened!.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.updatedAt).getTime(),
    );
  });
});
