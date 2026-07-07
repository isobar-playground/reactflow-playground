"use client";

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { Image as ImageIcon, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataType } from "@/lib/connection-rules";
import { BADGE_CLASSES, DATA_TYPE_TREATMENTS } from "@/lib/visual-system";

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
  data,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const dataType = edgeDataType(data);
  const treatment = dataType ? DATA_TYPE_TREATMENTS[dataType] : null;
  const semanticStyle = dataType
    ? {
        stroke: `var(--data-${dataType}-border)`,
        strokeWidth: 2.5,
        strokeDasharray: edgeStrokeDasharray(dataType),
      }
    : {};
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
        style={{
          ...style,
          ...semanticStyle,
        }}
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
        data-edge-data-type={dataType}
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
          {hovered ? (
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
          ) : treatment && dataType ? (
            <span
              aria-label={`${treatment.label} edge`}
              className={cn(
                BADGE_CLASSES,
                "pointer-events-none h-5 min-w-5 justify-center px-1 text-[10px] shadow-sm ring-2 ring-white",
                treatment.classes,
              )}
            >
              <EdgeDataTypeGlyph dataType={dataType} />
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function edgeDataType(data: EdgeProps["data"]): DataType | undefined {
  const maybeDataType = (data as { dataType?: unknown } | undefined)?.dataType;
  return maybeDataType === "text" || maybeDataType === "image" || maybeDataType === "video"
    ? maybeDataType
    : undefined;
}

function edgeStrokeDasharray(dataType: DataType): string | undefined {
  if (dataType === "text") return "3 5";
  if (dataType === "video") return "8 4";
  return undefined;
}

function EdgeDataTypeGlyph({ dataType }: { dataType: DataType }) {
  switch (dataType) {
    case "text":
      return <span aria-hidden="true">T</span>;
    case "image":
      return <ImageIcon aria-hidden="true" className="h-3 w-3" />;
    case "video":
      return <Video aria-hidden="true" className="h-3 w-3" />;
  }
}
