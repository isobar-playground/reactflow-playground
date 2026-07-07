"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Film, Image as ImageIcon } from "lucide-react";
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
import { buildCanvasDashboardItems, type CanvasDashboardItem } from "@/lib/canvas-dashboard";
import { INPUT_CLASSES, SURFACE_CLASSES } from "@/lib/visual-system";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function CanvasList({ canvases }: { canvases: Canvas[] }) {
  const items = buildCanvasDashboardItems(canvases);

  if (items.length === 0) {
    return (
      <section className={`${SURFACE_CLASSES.panel} rounded-lg p-6`}>
        <p className="text-sm font-medium text-foreground">No generated outputs yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a new Canvas or generate an output in an existing Canvas to populate this dashboard.
        </p>
      </section>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <CanvasCard key={item.id} item={item} />
      ))}
    </ul>
  );
}

function CanvasCard({ item }: { item: CanvasDashboardItem }) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) {
      setRenaming(false);
      setName(item.name);
      return;
    }
    startTransition(async () => {
      await renameCanvasAction(item.id, trimmed);
      setRenaming(false);
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      await deleteCanvasAction(item.id);
      setConfirmingDelete(false);
    });
  }

  return (
    <li className={`${SURFACE_CLASSES.card} group/canvas studio-lift rounded-lg p-3`}>
      <Link
        href={`/canvas/${item.id}`}
        className="block rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]"
      >
        <PreviewStack item={item} />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{item.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Latest {dateFormatter.format(new Date(item.latestGeneratedAt))}
            </p>
          </div>
          <div className="shrink-0 rounded-md border border-[var(--studio-border)] px-2 py-1 text-xs font-medium text-muted-foreground">
            {item.outputCount}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Outputs</dt>
            <dd className="font-medium text-foreground">{item.outputCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Actual Cost</dt>
            <dd className="font-medium text-foreground">
              {item.totalActualCost === undefined ? "Unknown" : currencyFormatter.format(item.totalActualCost)}
            </dd>
          </div>
        </dl>
      </Link>
      <div className="mt-3 flex items-center gap-1">
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

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Canvas</DialogTitle>
            <DialogDescription>Give this Canvas a clear name for the dashboard.</DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            aria-label="Canvas name"
            className={`${INPUT_CLASSES} py-2`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setName(item.name);
                setRenaming(false);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{item.name}&quot;?</DialogTitle>
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

function PreviewStack({ item }: { item: CanvasDashboardItem }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-[var(--studio-border)] bg-[var(--studio-muted)]">
      {item.previews.map((preview, index) => {
        const offset = index * 8;
        const rotation = (index - 2) * -2;
        return (
          <div
            key={preview.id}
            className="absolute left-1/2 top-1/2 h-[72%] w-[62%] overflow-hidden rounded-md border border-[var(--studio-border)] bg-background shadow-sm transition-transform duration-200 ease-out [transform:translate(calc(-50%+var(--stack-x)),calc(-50%+var(--stack-y)))_rotate(var(--stack-rotation))] motion-reduce:transition-none group-hover/canvas:[transform:translate(calc(-50%+var(--spread-x)),calc(-50%+var(--spread-y)))_rotate(var(--stack-rotation))] group-focus-within/canvas:[transform:translate(calc(-50%+var(--spread-x)),calc(-50%+var(--spread-y)))_rotate(var(--stack-rotation))]"
            style={
              {
                zIndex: item.previews.length - index,
                "--stack-x": `${offset}px`,
                "--stack-y": `${offset * 0.35}px`,
                "--stack-rotation": `${rotation}deg`,
                "--spread-x": `${offset * 1.8 - index * 2}px`,
                "--spread-y": `${offset * 0.8}px`,
              } as CSSProperties
            }
          >
            {preview.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <video src={preview.url} className="h-full w-full object-cover" muted playsInline />
            )}
            <div className="absolute left-2 top-2 rounded-md bg-background/85 p-1 text-foreground shadow-sm">
              {preview.kind === "image" ? (
                <ImageIcon aria-label="Image output" className="h-3.5 w-3.5" />
              ) : (
                <Film aria-label="Video output" className="h-3.5 w-3.5" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
