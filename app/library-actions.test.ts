import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAssetLibraryForTests } from "@/lib/asset-library";

// Server actions call revalidatePath, which throws outside a real Next.js
// request context ("Invariant: static generation store missing") — stub it
// so these actions are testable in isolation, the same way route handlers
// would be exercised without a full Next server.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("library-actions", () => {
  beforeEach(() => {
    delete process.env.BLOB_STORE_ID; // force the in-memory branch (running under Vitest)
    resetAssetLibraryForTests();
  });

  it("uploadAssetAction returns the created Asset", async () => {
    const { uploadAssetAction } = await import("./library-actions");
    const file = new File(["fake image bytes"], "cat.png", { type: "image/png" });

    const uploaded = await uploadAssetAction(file);

    expect(uploaded).toMatchObject({ name: "cat.png", type: "image" });
    expect(uploaded.url).toEqual(expect.any(String));
  });

  it("listAssetsAction returns the shared list, including assets uploaded via uploadAssetAction", async () => {
    const { uploadAssetAction, listAssetsAction } = await import("./library-actions");
    const file = new File(["fake image bytes"], "dog.png", { type: "image/png" });
    const uploaded = await uploadAssetAction(file);

    const assets = await listAssetsAction();

    expect(assets.map((asset) => asset.url)).toContain(uploaded.url);
  });
});
