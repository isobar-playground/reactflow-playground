"use client";

import { useTransition } from "react";
import { uploadAssetAction } from "@/app/library-actions";
import type { Asset } from "@/lib/asset-library";

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
      <label className="w-fit rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium">
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
        <p className="text-sm text-muted-foreground">No assets yet. Upload one to get started.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {assets.map((asset) => (
            <li
              key={asset.url}
              className="aspect-square overflow-hidden rounded-lg border border-border bg-muted"
            >
              {asset.type === "video" ? (
                <video src={asset.url} className="h-full w-full object-cover" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
