"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type Viewport,
  type ReactFlowJsonObject,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { saveCanvasGraphAction } from "@/app/canvas-actions";
import { debounce } from "@/lib/debounce";
import type { Canvas } from "@/lib/canvas-repo";

const AUTOSAVE_DELAY_MS = 1500;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function graphNodes(canvas: Canvas): Node[] {
  const nodes = canvas.graph.nodes;
  return Array.isArray(nodes) ? (nodes as Node[]) : [];
}

function graphEdges(canvas: Canvas): Edge[] {
  const edges = canvas.graph.edges;
  return Array.isArray(edges) ? (edges as Edge[]) : [];
}

function graphViewport(canvas: Canvas): Viewport {
  const viewport = canvas.graph.viewport;
  return viewport && typeof viewport === "object"
    ? (viewport as Viewport)
    : DEFAULT_VIEWPORT;
}

export function CanvasEditor({ canvas }: { canvas: Canvas }) {
  const [nodes, , onNodesChange] = useNodesState<Node>(graphNodes(canvas));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(graphEdges(canvas));
  // Initial viewport is only read once, by ReactFlow's `defaultViewport` on mount.
  const [initialViewport] = useState<Viewport>(() => graphViewport(canvas));
  const viewportRef = useRef<Viewport>(initialViewport);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const persist = useMemo(
    () =>
      debounce((graph: ReactFlowJsonObject) => {
        setSaveState("saving");
        void saveCanvasGraphAction(canvas.id, graph).then(() => setSaveState("saved"));
      }, AUTOSAVE_DELAY_MS),
    [canvas.id],
  );

  function currentGraph(): ReactFlowJsonObject {
    return { nodes, edges, viewport: viewportRef.current };
  }

  // Nodes/edges changes go through React state (setNodes/setEdges are async),
  // so schedule the save once state has actually settled rather than off the
  // stale closure inside the change handlers.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    persist(currentGraph());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  function handleSave() {
    persist.cancel();
    setSaveState("saving");
    void saveCanvasGraphAction(canvas.id, currentGraph()).then(() => setSaveState("saved"));
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          &larr; All canvases
        </Link>
        <h1 className="text-sm font-medium">{canvas.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </span>
          <Button variant="outline" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </header>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          defaultViewport={initialViewport}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(connection: Connection) => {
            setEdges((eds) => addEdge(connection, eds));
          }}
          onMoveEnd={(_, viewport) => {
            viewportRef.current = viewport;
            persist(currentGraph());
          }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
