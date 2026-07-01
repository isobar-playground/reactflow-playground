// Server-only access to the shared Asset Library (CONTEXT.md): a single
// collection of uploaded files, with no per-user scoping — everyone sees
// and uploads to the same library. Type (image vs video) is inferred from
// the file, not stored in a separate table (issue #9).
//
// Same swap pattern as lib/db.ts, now with three backends (ADR-0005):
//   BLOB_STORE_ID set   -> real Vercel Blob, authenticated via the SDK's own
//                          OIDC credential resolution (no explicit token)
//   running under Vitest -> in-memory store, zero provisioning/disk I/O
//   otherwise            -> local filesystem store under public/uploads/,
//                          served by Next.js's static file serving

import fs from "node:fs/promises";
import path from "node:path";

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

export type Backend = "blob" | "memory" | "filesystem";

export interface BackendSignals {
  /** Vercel's own signal that a Blob store is connected. */
  blobStoreId: string | undefined;
  /** Whether the process is running under the test runner (Vitest). */
  isTestRunner: boolean;
}

/**
 * Pure decision function for which backend to use, given environment
 * signals — kept separate from reading `process.env` so the selection
 * logic itself can be tested without real Blob/disk I/O.
 */
export function selectBackend({ blobStoreId, isTestRunner }: BackendSignals): Backend {
  if (blobStoreId) return "blob";
  if (isTestRunner) return "memory";
  return "filesystem";
}

let cached: AssetLibraryClient | undefined;

function getClient(): AssetLibraryClient {
  if (cached) return cached;
  const backend = selectBackend({
    blobStoreId: process.env.BLOB_STORE_ID,
    isTestRunner: Boolean(process.env.VITEST),
  });
  switch (backend) {
    case "blob":
      cached = blobClient();
      break;
    case "memory":
      cached = inMemoryClient();
      break;
    case "filesystem":
      cached = filesystemClient();
      break;
  }
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

// Authenticates via the @vercel/blob SDK's own OIDC credential resolution:
// with no explicit token passed, it resolves VERCEL_OIDC_TOKEN + BLOB_STORE_ID
// from the Vercel Functions runtime itself (ADR-0005).
function blobClient(): AssetLibraryClient {
  return {
    async upload(file) {
      const { put } = await import("@vercel/blob");
      const blob = await put(file.name, file, {
        access: "public",
        addRandomSuffix: true,
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
      const { blobs } = await list();
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

const DEFAULT_UPLOADS_DIR = "public/uploads";

/**
 * Local-dev backend: writes uploads to a real directory on disk, served by
 * Next.js's existing static file serving from public/ (ADR-0005). Exported
 * (rather than only reachable via getClient) so tests can point it at a
 * temporary directory instead of the app's real uploads directory.
 *
 * URLs are always rooted at `/uploads/<filename>` — the path under which
 * the default directory (public/uploads/) is served by Next.js. When a test
 * passes a different `dir`, the produced URL isn't actually servable, but
 * the round trip (upload's url appearing in list()) is what's under test.
 */
export function filesystemClient(dir: string = DEFAULT_UPLOADS_DIR): AssetLibraryClient {
  async function ensureDir() {
    await fs.mkdir(dir, { recursive: true });
  }

  return {
    async upload(file) {
      await ensureDir();

      const storedName = `${crypto.randomUUID()}-${file.name}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(path.join(dir, storedName), bytes);

      return {
        url: `/uploads/${storedName}`,
        name: file.name,
        type: inferAssetType(file),
        uploadedAt: new Date().toISOString(),
      };
    },
    async list() {
      await ensureDir();

      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile());

      const assets = await Promise.all(
        files.map(async (entry) => {
          const stats = await fs.stat(path.join(dir, entry.name));
          // Stored filenames are "<uuid>-<original name>"; recover the
          // original name for display the same way the uuid prefix was added.
          const originalName = entry.name.slice(entry.name.indexOf("-") + 1);
          return {
            url: `/uploads/${entry.name}`,
            name: originalName || entry.name,
            type: inferAssetTypeFromName(entry.name),
            uploadedAt: stats.mtime.toISOString(),
          };
        }),
      );

      return assets.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },
  };
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
