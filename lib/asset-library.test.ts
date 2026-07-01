import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  uploadAsset,
  listAssets,
  resetAssetLibraryForTests,
  selectBackend,
  filesystemClient,
} from "./asset-library";

describe("asset-library", () => {
  beforeEach(() => {
    delete process.env.BLOB_STORE_ID; // force the local (in-memory, under Vitest) branch
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

describe("backend selection", () => {
  it("picks the blob backend when a Blob store is connected, regardless of test runner", () => {
    expect(selectBackend({ blobStoreId: "store_123", isTestRunner: false })).toBe("blob");
    expect(selectBackend({ blobStoreId: "store_123", isTestRunner: true })).toBe("blob");
  });

  it("picks the in-memory backend under the test runner when no Blob store is connected", () => {
    expect(selectBackend({ blobStoreId: undefined, isTestRunner: true })).toBe("memory");
  });

  it("picks the filesystem backend for local dev: no Blob store, not under the test runner", () => {
    expect(selectBackend({ blobStoreId: undefined, isTestRunner: false })).toBe("filesystem");
  });
});

describe("filesystem backend", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "asset-library-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uploading an asset then listing reflects the new asset", async () => {
    const client = filesystemClient(dir);
    const file = new File(["fake image bytes"], "cat.png", { type: "image/png" });

    const uploaded = await client.upload(file);

    expect(uploaded.name).toBe("cat.png");
    expect(uploaded.url).toEqual(expect.any(String));

    const assets = await client.list();
    expect(assets.map((asset) => asset.url)).toContain(uploaded.url);
  });

  it("infers an image upload as type image", async () => {
    const client = filesystemClient(dir);
    const file = new File(["fake image bytes"], "cat.png", { type: "image/png" });

    const uploaded = await client.upload(file);

    expect(uploaded.type).toBe("image");
    const [listed] = await client.list();
    expect(listed.type).toBe("image");
  });

  it("infers a video upload as type video", async () => {
    const client = filesystemClient(dir);
    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });

    const uploaded = await client.upload(file);

    expect(uploaded.type).toBe("video");
    const [listed] = await client.list();
    expect(listed.type).toBe("video");
  });
});
