"use client";

import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The "⋮" button every node type renders in its header, next to the type
// label / mode pill. `nodrag` keeps clicking it from starting a node drag
// (React Flow's own convention — see every other interactive element in
// these node components).
export function NodeActionsMenu({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nodrag flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--studio-border)] bg-[var(--studio-input)] text-muted-foreground shadow-sm transition-colors hover:border-[var(--studio-border-strong)] hover:bg-[var(--studio-control-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]"
          aria-label="Node actions"
        >
          <MoreVertical className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
