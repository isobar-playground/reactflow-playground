"use client";

import { NODE_TYPE_OPTIONS, type NodeTypeKey } from "@/lib/add-node-menu";
import { ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

// Right-click menu: standard dismissable Radix ContextMenu content (real
// "menuitem" roles + roving focus), opened by the caller's
// ContextMenu/ContextMenuTrigger wrapper.
export function AddNodeContextMenuContent({
  onSelect,
}: {
  onSelect: (type: NodeTypeKey) => void;
}) {
  return (
    <ContextMenuContent>
      {NODE_TYPE_OPTIONS.map((option) => (
        <ContextMenuItem key={option.type} onSelect={() => onSelect(option.type)}>
          {option.label}
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  );
}

// Empty-canvas onboarding menu: always open, centred, and cannot be
// dismissed into nothing (issue #5 acceptance criteria) — so it is a plain
// panel rather than a dismissable Radix popup, with plain buttons instead
// of Radix's menu primitives.
export function EmptyCanvasMenu({
  onSelect,
  className,
}: {
  onSelect: (type: NodeTypeKey) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto absolute top-1/2 left-1/2 z-10 w-56 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10",
        className,
      )}
      role="menu"
      aria-label="Add a node"
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        Add a node to get started
      </div>
      {NODE_TYPE_OPTIONS.map((option) => (
        <button
          key={option.type}
          type="button"
          role="menuitem"
          onClick={() => onSelect(option.type)}
          className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-muted hover:text-foreground"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
