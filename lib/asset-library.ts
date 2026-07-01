// Server-only access to the shared Asset Library (CONTEXT.md): a single
// collection of uploaded files in Vercel Blob, with no per-user scoping —
// everyone sees and uploads to the same library. Type (image vs video) is
// inferred from the file, not stored in a separate table (issue #9).
//
// Same swap pattern as lib/db.ts:
//   BLOB_READ_WRITE_TOKEN set -> real Vercel Blob (prod)
//   otherwise                 -> in-memory store, so it runs with zero
//                                 provisioning locally and in tests.

export type AssetType = "image" | "video";

export interface Asset {
  url: string;
  name: string;
  type: AssetType;
  uploadedAt: string;
}

export interface AssetLibraryClient {
  upload(file: File): Promise<Asset>;
  list(): Promise<Asset[]>;
}

// Infers the asset type from the file's content-type, falling back to the
// extension when content-type is missing (e.g. some test doubles).
export function inferAssetType(file: File): AssetType {
  const contentType = file.type;
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("image/")) return "image";

  const extension = file.name.split(".").pop()?.toLowerCase();
  const videoExtensions = ["mp4", "webm", "mov", "avi"];
  return videoExtensions.includes(extension ?? "") ? "video" : "image";
}

let cached: AssetLibraryClient | undefined;

function getClient(): AssetLibraryClient {
  if (cached) return cached;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  cached = token ? blobClient(token) : inMemoryClient();
  return cached;
}

/** Test hook: drop the memoised client so a test can pick a different backend. */
export function resetAssetLibraryForTests(): void {
  cached = undefined;
}

export async function uploadAsset(file: File): Promise<Asset> {
  return getClient().upload(file);
}

export async function listAssets(): Promise<Asset[]> {
  return getClient().list();
}

function blobClient(token: string): AssetLibraryClient {
  return {
    async upload(file) {
      const { put } = await import("@vercel/blob");
      const blob = await put(file.name, file, {
        access: "public",
        addRandomSuffix: true,
        token,
      });
      return {
        url: blob.url,
        name: file.name,
        type: inferAssetType(file),
        uploadedAt: new Date().toISOString(),
      };
    },
    async list() {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ token });
      return blobs.map((blob) => ({
        url: blob.url,
        name: blob.pathname.split("/").pop() ?? blob.pathname,
        type: inferAssetTypeFromName(blob.pathname),
        uploadedAt: blob.uploadedAt.toISOString(),
      }));
    },
  };
}

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "avi"];

function inferAssetTypeFromName(name: string): AssetType {
  const extension = name.split(".").pop()?.toLowerCase();
  return VIDEO_EXTENSIONS.includes(extension ?? "") ? "video" : "image";
}

function inMemoryClient(): AssetLibraryClient {
  const assets: Asset[] = [];
  return {
    async upload(file) {
      const asset: Asset = {
        url: `memory://assets/${crypto.randomUUID()}-${file.name}`,
        name: file.name,
        type: inferAssetType(file),
        uploadedAt: new Date().toISOString(),
      };
      assets.push(asset);
      return asset;
    },
    async list() {
      return [...assets].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },
  };
}
