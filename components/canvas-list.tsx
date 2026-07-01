"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renameCanvasAction, deleteCanvasAction } from "@/app/canvas-actions";
import type { Canvas } from "@/lib/canvas-repo";

export function CanvasList({ canvases }: { canvases: Canvas[] }) {
  if (canvases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No canvases yet. Create one to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {canvases.map((canvas) => (
        <CanvasRow key={canvas.id} canvas={canvas} />
      ))}
    </ul>
  );
}

function CanvasRow({ canvas }: { canvas: Canvas }) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(canvas.name);
  const [isPending, startTransition] = useTransition();

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === canvas.name) {
      setRenaming(false);
      setName(canvas.name);
      return;
    }
    startTransition(async () => {
      await renameCanvasAction(canvas.id, trimmed);
      setRenaming(false);
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      await deleteCanvasAction(canvas.id);
      setConfirmingDelete(false);
    });
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
      {renaming ? (
        <input
          autoFocus
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitRename();
            if (e.key === "Escape") {
              setName(canvas.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <Link href={`/canvas/${canvas.id}`} className="flex-1 text-sm font-medium hover:underline">
          {canvas.name}
        </Link>
      )}

      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => setRenaming(true)} disabled={isPending}>
          Rename
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
          disabled={isPending}
        >
          Delete
        </Button>
      </div>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{canvas.name}&quot;?</DialogTitle>
            <DialogDescription>
              This permanently removes the canvas and its graph. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
