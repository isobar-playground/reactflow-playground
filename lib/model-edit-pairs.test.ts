import { describe, it, expect, beforeEach } from "vitest";
import { getDb, migrate, resetDbForTests } from "./db";
import { listEditPairs, setEditPair, clearEditPair } from "./model-edit-pairs";

describe("model-edit-pairs", () => {
  beforeEach(async () => {
    delete process.env.DATABASE_URL; // force the local (PGlite) branch
    process.env.PGLITE_DIR = "memory://"; // ephemeral per test run
    resetDbForTests();
    await migrate(await getDb());
  });

  it("pairs a base model with an edit model, then lists it", async () => {
    await setEditPair("fal-ai/flux/dev", "fal-ai/nano-banana/edit");

    expect(await listEditPairs()).toEqual({ "fal-ai/flux/dev": "fal-ai/nano-banana/edit" });
  });

  it("re-pairing an already-paired base overwrites its edit model", async () => {
    await setEditPair("fal-ai/flux/dev", "fal-ai/nano-banana/edit");

    await setEditPair("fal-ai/flux/dev", "fal-ai/other/edit");

    expect(await listEditPairs()).toEqual({ "fal-ai/flux/dev": "fal-ai/other/edit" });
  });

  it("clears a pairing, removing it from the list", async () => {
    await setEditPair("fal-ai/flux/dev", "fal-ai/nano-banana/edit");

    await clearEditPair("fal-ai/flux/dev");

    expect(await listEditPairs()).toEqual({});
  });

  it("clearing a pairing that never existed does not error", async () => {
    await expect(clearEditPair("fal-ai/never")).resolves.toBeUndefined();
    expect(await listEditPairs()).toEqual({});
  });

  it("lets many bases map to the same edit model", async () => {
    await setEditPair("fal-ai/flux/dev", "fal-ai/nano-banana/edit");
    await setEditPair("fal-ai/flux/schnell", "fal-ai/nano-banana/edit");

    expect(await listEditPairs()).toEqual({
      "fal-ai/flux/dev": "fal-ai/nano-banana/edit",
      "fal-ai/flux/schnell": "fal-ai/nano-banana/edit",
    });
  });
});
