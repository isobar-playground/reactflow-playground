"use client";

import { Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { HandleBadge } from "@/components/nodes/handle-badge";
import { NodeActionsMenu } from "@/components/nodes/node-actions-menu";
import { useNodeActions } from "@/components/nodes/use-node-actions";
import { BADGE_CLASSES, DATA_TYPE_TREATMENTS, INPUT_CLASSES, SURFACE_CLASSES } from "@/lib/visual-system";

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
  const { duplicate, remove } = useNodeActions(id);
  const textTreatment = DATA_TYPE_TREATMENTS.text;

  return (
    <div
      className={`${SURFACE_CLASSES.card} studio-node w-56 rounded-lg border-l-4 border-l-[var(--data-text-border)] p-2.5`}
      data-node-id={id}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`${BADGE_CLASSES} ${textTreatment.classes}`}>
          <span aria-hidden="true">T</span>
          Text source
        </span>
        <NodeActionsMenu onDuplicate={duplicate} onDelete={remove} />
      </div>
      <textarea
        className={`${INPUT_CLASSES} nodrag min-h-20 w-full resize-none p-2 leading-snug`}
        rows={3}
        value={data.text}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
        data-node-id={id}
        placeholder="Enter text…"
      />
      <HandleBadge type="source" position={Position.Right} dataType="text" />
    </div>
  );
}
