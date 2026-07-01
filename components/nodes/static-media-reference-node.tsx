"use client";

import { useEffect, useState } from "react";
import {
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HandleBadge } from "@/components/nodes/handle-badge";
import { NodeActionsMenu } from "@/components/nodes/node-actions-menu";
import { useNodeActions } from "@/components/nodes/use-node-actions";
import { listAssetsAction, uploadAssetAction } from "@/app/library-actions";
import type { Asset } from "@/lib/asset-library";

export type StaticMediaReferenceNodeData = {
  asset: Asset | null;
  /**
   * Set only on a node just created by a Handle-Spawned Node drag (issue
   * #17) that targeted an image- or video-only handle: the Asset Picker
   * opens immediately, restricted to this one media type, instead of
   * waiting for a "Choose asset" click. ADR-0003: the edge to the dragged
   * handle is created by the caller's onSelect once an asset is actually
   * picked, not at node-creation time. Cleared once the picker has been
   * opened so re-renders don't reopen it after the user closes it.
   */
  forcedOpenTypeHint?: "image" | "video" | null;
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
  const { duplicate, remove } = useNodeActions(id);
  const updateNodeInternals = useUpdateNodeInternals();
  // pickerOpen and stickyTypeHint always change together (see the
  // forced-open effect below), so they're one state value updated in a
  // single setState call rather than two separate ones — avoids the
  // cascading-render two setState calls in the same effect body would cause.
  const [picker, setPicker] = useState<{
    open: boolean;
    // Captured once at forced-open time and kept for the picker's lifetime,
    // rather than read live off data.forcedOpenTypeHint on every render: that
    // field is cleared (see below) in the same tick the picker opens, so a
    // value derived straight from it would go stale before AssetPickerDialog
    // even fetches the list.
    typeHint: "image" | "video" | undefined;
  }>({ open: false, typeHint: undefined });
  const { open: pickerOpen, typeHint: stickyTypeHint } = picker;
  const asset = data.asset;

  // ADR-0003: the output Handle only renders once data.asset is set — a
  // node-level change React Flow can't discover on its own (it only
  // re-measures a node's handles on resize/mount, per useUpdateNodeInternals'
  // own documented caveat: "if you programmatically change a node in a way
  // that affects its handle position, you need to let React Flow know about
  // it"). Without this, an edge created right after picking an asset (e.g.
  // a Handle-Spawned Node's deferred connect, issue #17) has nowhere valid
  // to render from and silently never appears.
  useEffect(() => {
    if (asset) updateNodeInternals(id);
  }, [asset, id, updateNodeInternals]);

  // Handle-Spawned Node special case (issue #17 / ADR-0003): a node created
  // with forcedOpenTypeHint set opens its Asset Picker immediately rather
  // than waiting for a "Choose asset" click. The local open/typeHint state
  // is adjusted during render — React's documented "adjusting state when a
  // prop changes" pattern (a plain useState tracking the last-seen value,
  // not a ref: refs can't be read/written during render) — rather than a
  // useEffect + setState, which would cost an extra render. Only the
  // external updateNodeData(...) clear-out (a store side effect, not local
  // state) stays in a useEffect, since side effects don't belong in a
  // render body.
  const [lastSeenTypeHint, setLastSeenTypeHint] =
    useState<StaticMediaReferenceNodeData["forcedOpenTypeHint"]>(undefined);
  if (data.forcedOpenTypeHint && data.forcedOpenTypeHint !== lastSeenTypeHint) {
    setLastSeenTypeHint(data.forcedOpenTypeHint);
    setPicker({ open: true, typeHint: data.forcedOpenTypeHint });
  }
  useEffect(() => {
    if (data.forcedOpenTypeHint) updateNodeData(id, { forcedOpenTypeHint: null });
  }, [data.forcedOpenTypeHint, id, updateNodeData]);

  return (
    <div className="w-64 rounded-lg border border-border bg-card p-3 shadow-sm" data-node-id={id}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Static Media Reference</span>
        <NodeActionsMenu onDuplicate={duplicate} onDelete={remove} />
      </div>

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
        onClick={() => setPicker({ open: true, typeHint: undefined })}
      >
        {asset ? "Change asset" : "Choose asset"}
      </Button>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => setPicker((current) => ({ open, typeHint: open ? current.typeHint : undefined }))}
        typeHint={stickyTypeHint}
        onSelect={(selected) => {
          updateNodeData(id, { asset: selected });
          setPicker({ open: false, typeHint: undefined });
        }}
      />

      {/* ADR-0003: no connectable output until an asset is chosen — its
          data type (image or video) is per-instance and unknown before
          then, and connection-rules.ts already rejects a null
          sourceDataType, so rendering an always-present Handle would offer
          a connection the graph refuses. */}
      {asset && <HandleBadge type="source" position={Position.Right} dataType={asset.type} />}
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
  typeHint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: Asset) => void;
  /**
   * Handle-Spawned Node case (issue #17): restricts the picker to one media
   * type — the results grid and the upload input's accept attribute both
   * narrow to it — so a Handle-Spawned Static Media Reference can't pick an
   * asset that wouldn't be a valid connection at the handle it was dragged
   * from.
   */
  typeHint?: "image" | "video";
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listAssetsAction().then((allAssets) => {
      setAssets(typeHint ? allAssets.filter((asset) => asset.type === typeHint) : allAssets);
    });
  }, [open, typeHint]);

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
            accept={typeHint ? `${typeHint}/*` : "image/*,video/*"}
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
