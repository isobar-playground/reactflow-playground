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
import { INPUT_CLASSES, SURFACE_CLASSES } from "@/lib/visual-system";

export function CanvasList({ canvases }: { canvases: Canvas[] }) {
  if (canvases.length === 0) {
    return (
      <p className={`${SURFACE_CLASSES.panel} rounded-lg p-4 text-sm text-muted-foreground`}>
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
    <li className={`${SURFACE_CLASSES.card} studio-lift flex items-center justify-between gap-2 rounded-lg p-3`}>
      {renaming ? (
        <input
          autoFocus
          className={`${INPUT_CLASSES} flex-1 py-1`}
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
        <Link href={`/canvas/${canvas.id}`} className="flex-1 rounded-md px-1 py-1 text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]">
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
