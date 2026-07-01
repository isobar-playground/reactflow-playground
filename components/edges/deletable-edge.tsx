"use client";

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// DeletableEdge (ADR-0004 / issue #19): the app's first custom edge type,
// wired in as edgeTypes = { default: DeletableEdge } on CanvasEditor's
// <ReactFlow> — every persisted edge already has no explicit `type`, so this
// applies uniformly with no data migration. Renders the identical bezier
// path React Flow's own default edge renders, plus a "×" button at the
// midpoint (via EdgeLabelRenderer) that's hidden until the pointer hovers
// the edge, and removes the edge immediately on click via
// useReactFlow().deleteElements — the same removal path
// components/nodes/use-node-actions.ts's remove() uses for nodes, so
// autosave picks it up the same way keyboard deletion already does. This is
// additive: click-to-select + Backspace/Delete (React Flow's built-in path)
// is untouched by this component's local hover state.
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerStart,
  markerEnd,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={20}
      />
      {/* BaseEdge already draws its own wide, invisible stroke
          (.react-flow__edge-interaction) for click hit-testing at
          interactionWidth; this adds a second, identically-shaped path on
          top purely to observe hover, so BaseEdge's own click-to-select
          behaviour is untouched. */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
        data-testid="deletable-edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          {hovered && (
            <button
              type="button"
              aria-label="Delete edge"
              onClick={() => void deleteElements({ edges: [{ id }] })}
              className={cn(
                "flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground",
              )}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
