"use client";

import { ImageIcon, Upload, Video } from "lucide-react";
import { useMemo, useState } from "react";
import { uploadAssetAction } from "@/app/library-actions";
import type { Asset } from "@/lib/asset-library";
import { BADGE_CLASSES, DATA_TYPE_TREATMENTS, SURFACE_CLASSES } from "@/lib/visual-system";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MediaFilter = "all" | "image" | "video";

const FILTERS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
];

// The `/library` page (issue #9): uploads and browses the shared Asset
// Library. There's no per-user scoping (CONTEXT.md) — everyone sees and
// uploads to the same list.
export function AssetLibraryBrowser({ assets }: { assets: Asset[] }) {
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [uploadState, setUploadState] = useState<
    | { status: "idle"; message: string | null }
    | { status: "uploading"; message: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle", message: null });
  const isUploading = uploadState.status === "uploading";
  const filteredAssets = useMemo(
    () => (filter === "all" ? assets : assets.filter((asset) => asset.type === filter)),
    [assets, filter],
  );
  const imageCount = assets.filter((asset) => asset.type === "image").length;
  const videoCount = assets.filter((asset) => asset.type === "video").length;

  async function handleUpload(file: File) {
    setUploadState({ status: "uploading", message: `Uploading ${file.name}...` });
    try {
      const uploaded = await uploadAssetAction(file);
      setUploadState({ status: "success", message: `${uploaded.name} uploaded. Refreshing the library...` });
    } catch (error) {
      setUploadState({
        status: "error",
        message: error instanceof Error ? error.message : "Upload failed",
      });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className={`${SURFACE_CLASSES.panel} rounded-lg p-4 sm:p-5`} aria-labelledby="asset-browser-title">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <h2 id="asset-browser-title" className="text-lg font-semibold tracking-normal">
              Browse reusable assets
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload source images and videos, then pick them from Static Media Reference nodes on the canvas.
            </p>
          </div>
          <UploadControl
            label="Upload asset"
            isUploading={isUploading}
            onUpload={handleUpload}
          />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric label="Total" value={assets.length} />
          <Metric label="Images" value={imageCount} treatment="image" />
          <Metric label="Videos" value={videoCount} treatment="video" />
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex w-fit rounded-lg border border-[var(--studio-border)] bg-[var(--studio-input)] p-1"
          aria-label="Asset type filter"
        >
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]",
                filter === item.id
                  ? "bg-[var(--studio-card)] text-[var(--studio-ink)] shadow-sm"
                  : "hover:bg-[var(--studio-control-hover)] hover:text-[var(--studio-ink)]",
              )}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {filteredAssets.length} of {assets.length}
        </p>
      </div>

      <UploadStatus uploadState={uploadState} />

      {filteredAssets.length === 0 ? (
        <EmptyState
          hasAssets={assets.length > 0}
          isUploading={isUploading}
          onUpload={handleUpload}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAssets.map((asset) => (
            <AssetCard key={asset.url} asset={asset} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadControl({
  label,
  isUploading,
  onUpload,
}: {
  label: string;
  isUploading: boolean;
  onUpload: (file: File) => void | Promise<void>;
}) {
  return (
    <label
      aria-busy={isUploading}
      className="inline-flex h-9 w-fit cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/85 focus-within:ring-[3px] focus-within:ring-[var(--studio-focus-ring)] aria-busy:cursor-wait aria-busy:opacity-70"
    >
      <Upload className="size-4" aria-hidden="true" />
      {isUploading ? "Uploading..." : label}
      <input
        type="file"
        accept="image/*,video/*"
        className="sr-only"
        disabled={isUploading}
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onUpload(file);
        }}
      />
    </label>
  );
}

function UploadStatus({
  uploadState,
}: {
  uploadState:
    | { status: "idle"; message: string | null }
    | { status: "uploading"; message: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string };
}) {
  if (!uploadState.message) return null;

  const role = uploadState.status === "error" ? "alert" : "status";
  return (
    <p
      role={role}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        uploadState.status === "error"
          ? "border-destructive/35 bg-destructive/10 text-destructive"
          : "border-[var(--studio-border)] bg-[var(--studio-panel)] text-muted-foreground",
      )}
    >
      {uploadState.message}
    </p>
  );
}

function Metric({
  label,
  value,
  treatment,
}: {
  label: string;
  value: number;
  treatment?: "image" | "video";
}) {
  const Icon = treatment === "video" ? Video : ImageIcon;
  return (
    <div className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        {treatment && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function EmptyState({
  hasAssets,
  isUploading,
  onUpload,
}: {
  hasAssets: boolean;
  isUploading: boolean;
  onUpload: (file: File) => void | Promise<void>;
}) {
  return (
    <section
      role="status"
      aria-label={hasAssets ? "No matching assets" : "Empty Asset Library"}
      className={`${SURFACE_CLASSES.panel} flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border-dashed p-8 text-center`}
    >
      <div className="flex size-12 items-center justify-center rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] text-muted-foreground">
        <ImageIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-semibold tracking-normal">
          {hasAssets ? "No assets match this filter" : "Start by uploading an image or video"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasAssets
            ? "Switch filters to see the rest of the shared Asset Library."
            : "The first upload appears here and becomes available to Static Media Reference pickers."}
        </p>
      </div>
      {!hasAssets && (
        <UploadControl
          label="Upload the first asset"
          isUploading={isUploading}
          onUpload={onUpload}
        />
      )}
    </section>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  const treatment = DATA_TYPE_TREATMENTS[asset.type];
  return (
    <li className={`${SURFACE_CLASSES.card} overflow-hidden rounded-lg p-0`}>
      <div className="relative aspect-[4/3] bg-[var(--studio-canvas)]">
        {asset.type === "video" ? (
          <video
            src={asset.url}
            title={asset.name}
            className="h-full w-full object-cover"
            controls
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
        )}
        <span className={`pointer-events-none absolute left-3 top-3 ${BADGE_CLASSES} text-[10px] ${treatment.classes}`}>
          {treatment.label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--studio-border)] px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--studio-ink)]">{asset.name}</p>
          <p className="text-xs text-muted-foreground">{new Date(asset.uploadedAt).toLocaleDateString()}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={asset.url} target="_blank" rel="noreferrer">
            Open
          </a>
        </Button>
      </div>
    </li>
  );
}
