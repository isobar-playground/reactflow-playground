"use client";

import { useTransition } from "react";
import { uploadAssetAction } from "@/app/library-actions";
import type { Asset } from "@/lib/asset-library";
import { DATA_TYPE_TREATMENTS, SURFACE_CLASSES } from "@/lib/visual-system";

// The `/library` page (issue #9): uploads and browses the shared Asset
// Library. There's no per-user scoping (CONTEXT.md) — everyone sees and
// uploads to the same list.
export function AssetLibraryBrowser({ assets }: { assets: Asset[] }) {
  const [isPending, startTransition] = useTransition();

  function handleUpload(file: File) {
    startTransition(async () => {
      await uploadAssetAction(file);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        aria-busy={isPending}
        className="w-fit rounded-md border border-[var(--studio-border)] bg-[var(--studio-input)] px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:border-[var(--studio-border-strong)] hover:bg-[var(--studio-control-hover)] focus-within:ring-[3px] focus-within:ring-[var(--studio-focus-ring)] aria-busy:cursor-wait aria-busy:opacity-70"
      >
        {isPending ? "Uploading…" : "Upload asset"}
        <input
          type="file"
          accept="image/*,video/*"
          className="hidden"
          disabled={isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) handleUpload(file);
          }}
        />
      </label>

      {assets.length === 0 ? (
        <p className={`${SURFACE_CLASSES.panel} rounded-lg p-4 text-sm text-muted-foreground`}>No assets yet. Upload one to get started.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {assets.map((asset) => (
            <li
              key={asset.url}
              className={`${SURFACE_CLASSES.card} studio-lift aspect-square overflow-hidden rounded-lg p-0`}
            >
              {asset.type === "video" ? (
                <div className="relative h-full w-full">
                  <video src={asset.url} className="h-full w-full object-cover" controls />
                  <span className={`pointer-events-none absolute left-2 top-2 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${DATA_TYPE_TREATMENTS.video.classes}`}>
                    video
                  </span>
                </div>
              ) : (
                <div className="relative h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                  <span className={`pointer-events-none absolute left-2 top-2 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${DATA_TYPE_TREATMENTS.image.classes}`}>
                    image
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
