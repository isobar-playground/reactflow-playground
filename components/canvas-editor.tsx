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
  type OnConnectEnd,
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
import { createNodeAt, shouldShowEmptyCanvasMenu, NODE_TYPE_OPTIONS, type NodeTypeKey } from "@/lib/add-node-menu";
import {
  isConnectionAllowed,
  SOURCE_DATA_TYPE,
  TARGET_HANDLES,
  type DataType,
} from "@/lib/connection-rules";
import { resolveSpawnCandidates, type SpawnCandidate } from "@/lib/handle-spawn";
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

// Handle-Spawned Node (issue #17): resolves the concrete data type carried
// by the handle a connection drag started from, so it can be matched
// against lib/handle-spawn.ts's candidates. A "source" drag reads the
// node's output type (fixed per node type, except a Static Media
// Reference's per-instance asset); a "target" drag reads what the specific
// input handle it started from accepts.
function draggedHandleDataType(
  fromNode: Node,
  fromHandleId: string | null,
  direction: "source" | "target",
): DataType | undefined {
  if (direction === "source") {
    if (fromNode.type === "staticMediaReference") {
      return sourceMediaDataType(fromNode) ?? undefined;
    }
    return SOURCE_DATA_TYPE[fromNode.type as NodeTypeKey] ?? undefined;
  }
  const handles = TARGET_HANDLES[fromNode.type as NodeTypeKey];
  const accepted = handles?.[fromHandleId ?? ""];
  return accepted?.[0];
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

function nodeTypeLabel(type: NodeTypeKey): string {
  return NODE_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type;
}

// A Handle-Spawned Node drag in progress (issue #17): captured from
// onConnectEnd once it's confirmed the drag ended on empty canvas (no
// toNode) and at least one candidate node type would form a valid
// connection there. Consumed by the spawn picker's onSelect.
interface PendingSpawn {
  /** Flow-coordinate position the new node should be created at. */
  position: { x: number; y: number };
  /** Screen-pixel position (the drop point) the picker panel is placed at. */
  screenPosition: { x: number; y: number };
  candidates: SpawnCandidate[];
  /** The node/handle the drag originated from. */
  originNodeId: string;
  originHandleId: string | null;
  /** Whether the drag started from a source (output) or target (input)
   * handle — mirrors SpawnAttempt.direction (lib/handle-spawn.ts): a
   * "source" drag needs a compatible *target* handle on the new node, and
   * vice versa. */
  direction: "source" | "target";
  /** The dragged handle's resolved data type — carried along so a Static
   * Media Reference candidate's Asset Picker type hint doesn't need to be
   * recomputed from the (possibly since-changed) origin node. */
  dataType: DataType;
}

// A Handle-Spawned Static Media Reference whose asset hasn't been picked
// yet (ADR-0003): its output doesn't exist until data.asset is set, so the
// edge to the originating handle can only be created once
// StaticMediaReferenceNode's own onSelect writes that asset — tracked here
// rather than at spawn time, so a cancelled picker leaves no stale edge.
interface PendingMediaSpawn {
  nodeId: string;
  originNodeId: string;
  originHandleId: string | null;
  direction: "source" | "target";
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

  // Handle-Spawned Node picker state (issue #17): set by onConnectEnd once a
  // drag ends on empty canvas with at least one valid candidate node type,
  // cleared once a candidate is picked (or the picker is dismissed).
  const [pendingSpawn, setPendingSpawn] = useState<PendingSpawn | null>(null);
  // Set only while a Handle-Spawned Static Media Reference is waiting on its
  // forced-open Asset Picker (ADR-0003) — see handleMediaSpawnAssetChosen.
  const pendingMediaSpawn = useRef<PendingMediaSpawn | null>(null);

  const addNode = useCallback(
    (type: NodeTypeKey, position: { x: number; y: number }) => {
      const node = createNodeAt(type, position) as Node;
      setNodes((current) => [...current, node]);
      return node;
    },
    [setNodes],
  );

  // onConnectEnd (issue #17): React Flow's documented hook for "a connection
  // drag ended, whether on a handle or on the pane". A non-null toNode means
  // the user dropped on an existing handle — that's a normal connect/reject,
  // already handled by onConnect/isValidConnection, so this only acts when
  // toNode is null (dropped on empty canvas).
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.toNode) return; // dropped on a handle, not empty canvas
      const { fromNode, fromHandle } = connectionState;
      if (!fromNode?.type || !fromHandle) return;
      if (!reactFlowInstance) return;

      const direction = fromHandle.type; // "source" (dragged from output) or "target" (input)
      const dataType = draggedHandleDataType(fromNode, fromHandle.id ?? null, direction);
      if (!dataType) return; // e.g. an unset Static Media Reference output: no data type to match candidates against

      const candidates = resolveSpawnCandidates({ direction, dataType });
      if (candidates.length === 0) return;

      const clientPoint = "changedTouches" in event ? event.changedTouches[0] : event;
      const screenPosition = { x: clientPoint.clientX, y: clientPoint.clientY };
      const position = reactFlowInstance.screenToFlowPosition(screenPosition);

      setPendingSpawn({
        position,
        screenPosition,
        candidates,
        originNodeId: fromNode.id,
        originHandleId: fromHandle.id ?? null,
        direction,
        dataType,
      });
    },
    [reactFlowInstance],
  );

  // Selecting a Handle-Spawned Node candidate (issue #17): creates the node
  // at the drop position and auto-connects it to the handle the drag
  // originated from. Static Media Reference is the exception (ADR-0003): it
  // has no output until an asset is chosen, so instead of connecting
  // immediately, its Asset Picker opens forced-open with a type hint, and
  // the edge is created only once an asset is actually picked
  // (handleMediaSpawnAssetChosen below).
  function handleSpawnSelect(candidate: SpawnCandidate) {
    if (!pendingSpawn) return;
    const { position, originNodeId, originHandleId, direction, dataType } = pendingSpawn;
    setPendingSpawn(null);

    if (candidate.nodeType === "staticMediaReference") {
      const mediaNode = createNodeAt("staticMediaReference", position);
      (mediaNode.data as StaticMediaReferenceNodeData).forcedOpenTypeHint = dataType as
        | "image"
        | "video";
      setNodes((current) => [...current, mediaNode as Node]);
      pendingMediaSpawn.current = {
        nodeId: mediaNode.id,
        originNodeId,
        originHandleId,
        direction,
      };
      return;
    }

    const newNode = addNode(candidate.nodeType, position);
    const connection: Connection =
      direction === "source"
        ? {
            source: originNodeId,
            sourceHandle: originHandleId,
            target: newNode.id,
            targetHandle: candidate.handleId,
          }
        : {
            source: newNode.id,
            sourceHandle: candidate.handleId,
            target: originNodeId,
            targetHandle: originHandleId,
          };
    setEdges((eds) => addEdge(connection, eds));
  }

  // ADR-0003: a Handle-Spawned Static Media Reference's edge is created here
  // — once StaticMediaReferenceNode's onSelect has actually written
  // data.asset — rather than at spawn time. Cancelling the picker leaves
  // pendingMediaSpawn set but never calls this, so the node stays on the
  // canvas unconnected, same as one added from the right-click menu.
  const handleMediaSpawnAssetChosen = useCallback(
    (nodeId: string) => {
      const pending = pendingMediaSpawn.current;
      if (!pending || pending.nodeId !== nodeId) return;
      pendingMediaSpawn.current = null;

      const connection: Connection =
        pending.direction === "source"
          ? {
              source: pending.originNodeId,
              sourceHandle: pending.originHandleId,
              target: nodeId,
              targetHandle: null,
            }
          : { source: nodeId, sourceHandle: null, target: pending.originNodeId, targetHandle: pending.originHandleId };
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges],
  );

  // Fires handleMediaSpawnAssetChosen once the pending Handle-Spawned Static
  // Media Reference's data.asset is actually written through (ADR-0002:
  // StaticMediaReferenceNode writes via updateNodeData, not a callback prop
  // — so this observes the resulting `nodes` state rather than being called
  // directly from that component).
  useEffect(() => {
    const pending = pendingMediaSpawn.current;
    if (!pending) return;
    const node = nodes.find((n) => n.id === pending.nodeId);
    const asset = (node?.data as StaticMediaReferenceNodeData | undefined)?.asset;
    if (asset) handleMediaSpawnAssetChosen(pending.nodeId);
  }, [nodes, handleMediaSpawnAssetChosen]);

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
              onConnectEnd={onConnectEnd}
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

        {pendingSpawn && (
          <SpawnPickerMenu
            screenPosition={pendingSpawn.screenPosition}
            candidates={pendingSpawn.candidates}
            onSelect={handleSpawnSelect}
            onDismiss={() => setPendingSpawn(null)}
          />
        )}
      </div>
    </div>
  );
}

// Handle-Spawned Node picker (issue #17): opened by onConnectEnd at the
// drop point, listing only the node types that would form a valid
// connection at the dragged handle. Reuses EmptyCanvasMenu's floating-panel
// visual pattern rather than Radix's context-menu-trigger machinery, since
// this isn't a right-click — it's positioned imperatively at a drop point,
// and dismisses on an explicit close rather than Radix's own open-state
// plumbing.
function SpawnPickerMenu({
  screenPosition,
  candidates,
  onSelect,
  onDismiss,
}: {
  screenPosition: { x: number; y: number };
  candidates: SpawnCandidate[];
  onSelect: (candidate: SpawnCandidate) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      {/* Full-screen scrim: clicking outside the picker dismisses it,
          leaving no node behind (nothing was created yet at this point). */}
      <div className="fixed inset-0 z-10" onClick={onDismiss} />
      <div
        className="pointer-events-auto absolute z-20 w-56 -translate-x-1/2 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        style={{ left: screenPosition.x, top: screenPosition.y }}
        role="menu"
        aria-label="Add a connected node"
      >
        {candidates.map((candidate) => (
          <button
            key={`${candidate.nodeType}-${candidate.handleId ?? ""}`}
            type="button"
            role="menuitem"
            onClick={() => onSelect(candidate)}
            className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-muted hover:text-foreground"
          >
            {nodeTypeLabel(candidate.nodeType)}
          </button>
        ))}
      </div>
    </>
  );
}
