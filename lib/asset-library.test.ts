import { describe, it, expect, beforeEach } from "vitest";
import { uploadAsset, listAssets, resetAssetLibraryForTests } from "./asset-library";

describe("asset-library", () => {
  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // force the local (in-memory) branch
    resetAssetLibraryForTests();
  });

  it("uploading an asset then listing reflects the new asset", async () => {
    const file = new File(["fake image bytes"], "cat.png", { type: "image/png" });

    const uploaded = await uploadAsset(file);

    expect(uploaded.name).toBe("cat.png");
    expect(uploaded.url).toEqual(expect.any(String));

    const assets = await listAssets();
    expect(assets.map((asset) => asset.url)).toContain(uploaded.url);
  });

  it("infers an image upload as type image", async () => {
    const file = new File(["fake image bytes"], "cat.png", { type: "image/png" });

    const uploaded = await uploadAsset(file);

    expect(uploaded.type).toBe("image");
    const [listed] = await listAssets();
    expect(listed.type).toBe("image");
  });

  it("infers a video upload as type video", async () => {
    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });

    const uploaded = await uploadAsset(file);

    expect(uploaded.type).toBe("video");
    const [listed] = await listAssets();
    expect(listed.type).toBe("video");
  });
});
