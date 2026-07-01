"use client";

import { useEffect, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listAssetsAction, uploadAssetAction } from "@/app/library-actions";
import type { Asset } from "@/lib/asset-library";

export type StaticMediaReferenceNodeData = {
  asset: Asset | null;
};

export type StaticMediaReferenceNodeType = Node<StaticMediaReferenceNodeData, "staticMediaReference">;

// A Reference node (CONTEXT.md): provides data only, so it has an output
// handle and no input handle. Holds a single asset (image or video) chosen
// from the shared Asset Library — media type is inferred from the file,
// there's no prompt/generation (issue #9).
//
// ADR-0002: node `data` is the single source of truth for persisted canvas
// content, so the chosen asset is rendered from `data.asset` and written
// through with updateNodeData on select/upload rather than shadowed in
// local state — otherwise it never reaches autosave and is lost on reload.
// The picker itself goes through server actions (issue #15): a browser-side
// import of lib/asset-library hits its own store and, in production, can
// never reach Vercel Blob since BLOB_READ_WRITE_TOKEN is server-only.
export function StaticMediaReferenceNode({ id, data }: NodeProps<StaticMediaReferenceNodeType>) {
  const { updateNodeData } = useReactFlow();
  const [pickerOpen, setPickerOpen] = useState(false);
  const asset = data.asset;

  return (
    <div className="w-64 rounded-lg border border-border bg-card p-3 shadow-sm" data-node-id={id}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">Static Media Reference</div>

      {asset ? (
        <div className="mb-2 overflow-hidden rounded-md bg-muted">
          {asset.type === "video" ? (
            <video src={asset.url} className="aspect-square w-full object-cover" controls />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.name} className="aspect-square w-full object-cover" />
          )}
        </div>
      ) : (
        <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
          No asset chosen
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="nodrag w-full"
        onClick={() => setPickerOpen(true)}
      >
        {asset ? "Change asset" : "Choose asset"}
      </Button>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(selected) => {
          updateNodeData(id, { asset: selected });
          setPickerOpen(false);
        }}
      />

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// The Static Media Reference's picker into the shared Asset Library (issue
// #9): browse existing assets, or upload a new one inline without leaving
// the canvas. Selecting either sets the node's asset.
function AssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: Asset) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listAssetsAction().then(setAssets);
  }, [open]);

  async function handleUpload(file: File) {
    setIsUploading(true);
    const uploaded = await uploadAssetAction(file);
    setIsUploading(false);
    onSelect(uploaded);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose an asset</DialogTitle>
          <DialogDescription>
            Pick an asset from the shared library, or upload a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
          {assets.map((asset) => (
            <button
              key={asset.url}
              type="button"
              aria-label={asset.name}
              onClick={() => onSelect(asset)}
              className="aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              {asset.type === "video" ? (
                <video src={asset.url} className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
              )}
            </button>
          ))}
          {assets.length === 0 && (
            <p className="col-span-3 text-sm text-muted-foreground">No assets yet.</p>
          )}
        </div>

        <label className="text-sm font-medium">
          Upload a new asset
          <input
            type="file"
            accept="image/*,video/*"
            disabled={isUploading}
            className="mt-1 block w-full text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
            }}
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}
