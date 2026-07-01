"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type ReactFlowInstance,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { AddNodeContextMenuContent, EmptyCanvasMenu } from "@/components/add-node-menu";
import { StaticTextReferenceNode } from "@/components/nodes/static-text-reference-node";
import {
  StaticMediaReferenceNode,
  type StaticMediaReferenceNodeData,
} from "@/components/nodes/static-media-reference-node";
import { ImageGenerationNode } from "@/components/nodes/image-generation-node";
import { VideoGenerationNode } from "@/components/nodes/video-generation-node";
import { saveCanvasGraphAction } from "@/app/canvas-actions";
import { debounce } from "@/lib/debounce";
import { createNodeAt, shouldShowEmptyCanvasMenu, type NodeTypeKey } from "@/lib/add-node-menu";
import { isConnectionAllowed, type DataType } from "@/lib/connection-rules";
import type { Canvas } from "@/lib/canvas-repo";

const AUTOSAVE_DELAY_MS = 1500;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

const nodeTypes = {
  staticTextReference: StaticTextReferenceNode,
  staticMediaReference: StaticMediaReferenceNode,
  imageGeneration: ImageGenerationNode,
  videoGeneration: VideoGenerationNode,
};

// A Static Media Reference's output type isn't fixed per node type (it's
// image or video depending on the chosen asset), so connection-rules can't
// look it up statically — this resolves the concrete type from the node's
// own data before validating the connection (lib/connection-rules.ts).
function sourceMediaDataType(node: Node): DataType | null | undefined {
  if (node.type !== "staticMediaReference") return undefined;
  const data = node.data as StaticMediaReferenceNodeData;
  return data.asset?.type ?? null;
}

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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(graphNodes(canvas));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(graphEdges(canvas));
  // Initial viewport is only read once, by ReactFlow's `defaultViewport` on mount.
  const [initialViewport] = useState<Viewport>(() => graphViewport(canvas));
  const viewportRef = useRef<Viewport>(initialViewport);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  // The right-click point (in flow coordinates) the context menu should
  // spawn the chosen node at. Set on right-click, consumed and cleared by
  // the menu's onSelect — not cleared on close, since Radix's onOpenChange
  // can fire before or after onSelect and clearing there raced with reading
  // it here, occasionally losing the click position under load.
  const pendingSpawnPosition = useRef<{ x: number; y: number } | null>(null);

  const addNode = useCallback(
    (type: NodeTypeKey, position: { x: number; y: number }) => {
      setNodes((current) => [...current, createNodeAt(type, position) as Node]);
    },
    [setNodes],
  );

  // connection-rules only knows about node/handle types, not React Flow's
  // internal node ids, so this looks up each endpoint's type from current
  // `nodes` before delegating the allow/deny decision (CONTEXT.md:
  // disallowed edges rejected at connect time; References reject all
  // inbound edges).
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (!sourceNode?.type || !targetNode?.type) return false;

      return isConnectionAllowed({
        sourceType: sourceNode.type as NodeTypeKey,
        sourceHandle: connection.sourceHandle ?? null,
        targetType: targetNode.type as NodeTypeKey,
        targetId: targetNode.id,
        targetHandle: connection.targetHandle ?? null,
        existingEdges: edges.map((edge) => ({
          target: edge.target,
          targetHandle: edge.targetHandle ?? null,
        })),
        sourceDataType: sourceMediaDataType(sourceNode),
      });
    },
    [nodes, edges],
  );

  function centreOfCanvas(): { x: number; y: number } {
    if (!reactFlowInstance) return { x: 0, y: 0 };
    return reactFlowInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  }

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
      <div className="relative flex-1">
        <ContextMenu>
          <ContextMenuTrigger
            className="block h-full w-full"
            onContextMenu={(event) => {
              if (!reactFlowInstance) return;
              pendingSpawnPosition.current = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              defaultViewport={initialViewport}
              onInit={setReactFlowInstance}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              isValidConnection={isValidConnection}
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
          </ContextMenuTrigger>
          <AddNodeContextMenuContent
            onSelect={(type) => {
              addNode(type, pendingSpawnPosition.current ?? centreOfCanvas());
              pendingSpawnPosition.current = null;
            }}
          />
        </ContextMenu>

        {shouldShowEmptyCanvasMenu(nodes.length) && (
          <EmptyCanvasMenu onSelect={(type) => addNode(type, centreOfCanvas())} />
        )}
      </div>
    </div>
  );
}
