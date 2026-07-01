import { describe, it, expect, beforeEach } from "vitest";
import { getDb, migrate, resetDbForTests } from "./db";

describe("local (file-less) database", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL; // force the local branch
    process.env.PGLITE_DIR = "memory://"; // ephemeral per test run
    resetDbForTests();
  });

  it("round-trips a canvas through the migrated schema", async () => {
    const db = await getDb();
    await migrate(db);

    await db.query("insert into canvases (name, graph) values ($1, $2)", [
      "My canvas",
      JSON.stringify({ nodes: [], edges: [] }),
    ]);

    const rows = await db.query<{ name: string; graph: unknown }>(
      "select name, graph from canvases",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("My canvas");
    expect(rows[0].graph).toEqual({ nodes: [], edges: [] });
  });
});
