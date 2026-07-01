"use client";

import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";

export type StaticTextReferenceNodeData = {
  text: string;
};

export type StaticTextReferenceNodeType = Node<StaticTextReferenceNodeData, "staticTextReference">;

// A Reference node (CONTEXT.md): provides data only, so it has an output
// handle and no input handle — nothing can connect into it.
//
// ADR-0002: node `data` is the single source of truth for persisted canvas
// content, so the textarea is controlled from `data.text` and writes
// through with updateNodeData on every change rather than shadowing the
// text in local state — otherwise it never reaches autosave or a connected
// Generation Node's Resolved Prompt.
export function StaticTextReferenceNode({ id, data }: NodeProps<StaticTextReferenceNodeType>) {
  const { updateNodeData } = useReactFlow();

  return (
    <div className="w-64 rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Static Text Reference</div>
      <textarea
        className="nodrag w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none"
        rows={4}
        value={data.text}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
        data-node-id={id}
        placeholder="Enter text…"
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
