import { describe, it, expect, beforeEach } from "vitest";
import { getDb, migrate, resetDbForTests } from "./db";
import {
  listApprovedEndpointIds,
  approveModel,
  unapproveModel,
} from "./model-approvals";

describe("model-approvals", () => {
  beforeEach(async () => {
    delete process.env.DATABASE_URL; // force the local (PGlite) branch
    process.env.PGLITE_DIR = "memory://"; // ephemeral per test run
    resetDbForTests();
    await migrate(await getDb());
  });

  it("approves a model then lists it", async () => {
    await approveModel("fal-ai/flux/dev");

    expect(await listApprovedEndpointIds()).toEqual(["fal-ai/flux/dev"]);
  });

  it("approving an already-approved model is idempotent", async () => {
    await approveModel("fal-ai/flux/dev");
    await approveModel("fal-ai/flux/dev");

    expect(await listApprovedEndpointIds()).toEqual(["fal-ai/flux/dev"]);
  });

  it("unapproves a model, removing it from the list", async () => {
    await approveModel("fal-ai/flux/dev");

    await unapproveModel("fal-ai/flux/dev");

    expect(await listApprovedEndpointIds()).toEqual([]);
  });

  it("unapproving a model that was never approved does not error", async () => {
    await expect(unapproveModel("fal-ai/never")).resolves.toBeUndefined();
    expect(await listApprovedEndpointIds()).toEqual([]);
  });

  it("lists all approved endpoint ids (shared, no per-user scoping)", async () => {
    await approveModel("fal-ai/flux/dev");
    await approveModel("fal-ai/kling-video/v1");

    expect((await listApprovedEndpointIds()).sort()).toEqual(
      ["fal-ai/flux/dev", "fal-ai/kling-video/v1"].sort(),
    );
  });
});
