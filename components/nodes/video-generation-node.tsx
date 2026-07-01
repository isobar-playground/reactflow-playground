"use client";

import { useState } from "react";
import {
  Handle,
  Position,
  useNodeConnections,
  useNodesData,
  useReactFlow,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { generateVideoPlaceholder } from "@/lib/generation-mock";
import {
  appendEntry,
  setActiveEntry,
  getActiveEntry,
  type NodeHistory,
} from "@/lib/node-history";
import { resolvedPrompt } from "@/lib/resolved-prompt";
import { videoGenerationMode, videoGenerationModeLabel } from "@/lib/generation-mode";
import { cloneVariants } from "@/lib/variant-clone";
import type { StaticTextReferenceNodeData } from "@/components/nodes/static-text-reference-node";

export type VideoGenerationNodeData = {
  prompt: string;
  history: NodeHistory;
};

export type VideoGenerationNodeType = Node<VideoGenerationNodeData, "videoGeneration">;

// The Video Generation Node (CONTEXT.md / issue #11): a Generation Node
// whose output is a video. Named input handles: `text` (many), `start
// frame`/`end frame` (one image each), `image reference` (many images),
// `video` (one video, mutually exclusive with the other three — enforced by
// lib/connection-rules.ts). Mode is derived, never chosen by hand, mirroring
// the Image Generation Node's pattern (components/nodes/image-generation-node.tsx).
//
// ADR-0002: the prompt field and History are both controlled from `data`
// and write through with updateNodeData on every change rather than
// shadowing them in local state — otherwise neither reaches autosave, and a
// downstream node's useNodesData read of the Active Output (or the Resolved
// Prompt) would go stale. Only the in-progress `isGenerating` flag is
// transient UI state and stays local (issue #16).
export function VideoGenerationNode({ id, data }: NodeProps<VideoGenerationNodeType>) {
  const prompt = data.prompt;
  const history = data.history;
  const [isGenerating, setIsGenerating] = useState(false);
  // Variant counter (CONTEXT.md / issue #12): above one, Generate clones this
  // node into that many independent nodes instead of appending to its own
  // History. Resets to 1 after cloning. Kept as the raw input string (rather
  // than clamping on every keystroke) so clearing the field to type a new
  // number doesn't immediately snap back to "1" mid-edit; it's parsed and
  // clamped to >= 1 when Generate reads it.
  const [variantCountInput, setVariantCountInput] = useState("1");
  const variantCount = Math.max(1, parseInt(variantCountInput, 10) || 1);

  const activeEntry = getActiveEntry(history);

  // Resolved Prompt (CONTEXT.md): the text of all connected Static Text
  // References, in edge order, concatenated with the local prompt field.
  const textConnections = useNodeConnections({ id, handleType: "target", handleId: "text" });
  const connectedTextNodeIds = textConnections.map((connection) => connection.source);
  const connectedTextNodes = useNodesData<Node<StaticTextReferenceNodeData>>(connectedTextNodeIds);
  const connectedTextByNodeId = new Map(
    connectedTextNodes.map((node) => [node.id, node.data.text]),
  );
  const connectedTexts = connectedTextNodeIds.map((nodeId) => connectedTextByNodeId.get(nodeId) ?? "");
  const resolvedPromptText = resolvedPrompt(connectedTexts, prompt);

  // Mode (CONTEXT.md / issue #11): derived from which inputs are connected —
  // never chosen by hand. A connected video takes priority (connection-rules
  // blocks it from coexisting with the frame/image-reference handles).
  const startFrameConnections = useNodeConnections({ id, handleType: "target", handleId: "startFrame" });
  const endFrameConnections = useNodeConnections({ id, handleType: "target", handleId: "endFrame" });
  const imageReferenceConnections = useNodeConnections({
    id,
    handleType: "target",
    handleId: "imageReference",
  });
  const videoConnections = useNodeConnections({ id, handleType: "target", handleId: "video" });
  const hasImageInput =
    startFrameConnections.length > 0 ||
    endFrameConnections.length > 0 ||
    imageReferenceConnections.length > 0;
  const mode = videoGenerationMode({ hasImageInput, hasVideo: videoConnections.length > 0 });
  const modeLabel = videoGenerationModeLabel(mode);

  const { getNode, getEdges, addNodes, addEdges, updateNodeData } = useReactFlow();

  // Variant cloning (CONTEXT.md / issue #12): when the counter is above one,
  // Generate clones this node into that many independent nodes instead of
  // appending to its own History. Each clone inherits only the original's
  // incoming edges (lib/variant-clone.ts), is laid out with an offset, and
  // generates its own single fresh output — never a copy of this node's
  // History. The counter resets to 1 afterward. Mirrors
  // components/nodes/image-generation-node.tsx's handleGenerateVariants.
  //
  // ADR-0002: getNode(id) already returns the live `data.prompt` — the
  // prompt field writes through on every keystroke — so no manual merge of
  // the local prompt into the cloned node's data is needed here.
  async function handleGenerateVariants(count: number) {
    setIsGenerating(true);
    const node = getNode(id);
    if (!node) {
      setIsGenerating(false);
      return;
    }
    const { nodes: clones, edges: clonedEdges } = cloneVariants(node, getEdges(), count);

    const generated = await Promise.all(clones.map(() => generateVideoPlaceholder()));
    const clonesWithOutput = clones.map((clone, index) => ({
      ...clone,
      data: {
        ...clone.data,
        history: appendEntry(clone.data.history as NodeHistory, {
          id: crypto.randomUUID(),
          prompt,
          output: generated[index],
        }),
      },
    }));

    addNodes(clonesWithOutput);
    addEdges(clonedEdges);
    setVariantCountInput("1");
    setIsGenerating(false);
  }

  // Every Generate/Regenerate appends a new History entry — even with an
  // unchanged prompt — and that entry becomes the Active Output (CONTEXT.md).
  // ADR-0002 / issue #16: written through to data.history so it survives
  // reload and stays visible to downstream consumers of the Active Output.
  async function handleGenerate() {
    if (variantCount > 1) {
      await handleGenerateVariants(variantCount);
      return;
    }
    setIsGenerating(true);
    const result = await generateVideoPlaceholder();
    updateNodeData(id, {
      history: appendEntry(history, { id: crypto.randomUUID(), prompt, output: result }),
    });
    setIsGenerating(false);
  }

  // Selecting a History thumbnail sets the Active Output and restores that
  // entry's prompt into the field. It never triggers regeneration — a pure
  // pointer swap written through to data (ADR-0002 / issue #16).
  function handleSelectHistoryEntry(entryId: string) {
    const selected = history.entries.find((entry) => entry.id === entryId);
    if (!selected) return;
    updateNodeData(id, { history: setActiveEntry(history, entryId), prompt: selected.prompt });
  }

  return (
    <div className="w-96 rounded-xl border border-border bg-card p-3 shadow-sm" data-node-id={id}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Video Generation Node</span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {modeLabel}
        </span>
      </div>

      <div className="mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
        {isGenerating ? (
          <span className="text-sm text-muted-foreground">Generating…</span>
        ) : activeEntry ? (
          <video
            src={activeEntry.output.url}
            className="h-full w-full object-cover"
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <span className="text-sm text-muted-foreground">No output yet</span>
        )}
      </div>

      {/* History carousel (CONTEXT.md): only appears from the second entry
          onward, so the node stays simple until there's history. */}
      {history.entries.length >= 2 && (
        <div className="nodrag mb-3 flex gap-1.5 overflow-x-auto">
          {history.entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleSelectHistoryEntry(entry.id)}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border ${
                entry.id === history.activeId ? "border-primary" : "border-border"
              }`}
            >
              <video src={entry.output.url} className="h-full w-full object-cover" muted />
            </button>
          ))}
        </div>
      )}

      <textarea
        className="nodrag mb-3 w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none"
        rows={3}
        value={prompt}
        onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
        placeholder="Enter a prompt…"
        data-node-id={id}
      />

      {/* Resolved Prompt preview (CONTEXT.md): connected Static Text
          References (edge order) concatenated with the local prompt. */}
      {resolvedPromptText.length > 0 && (
        <div className="mb-3 rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
          <div className="mb-1 font-medium">Resolved Prompt</div>
          <div>{resolvedPromptText}</div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <label htmlFor={`variant-count-${id}`} className="text-xs text-muted-foreground">
          Variants
        </label>
        <input
          id={`variant-count-${id}`}
          aria-label="Variant count"
          type="number"
          min={1}
          value={variantCountInput}
          onChange={(event) => setVariantCountInput(event.target.value)}
          onBlur={() => setVariantCountInput(String(variantCount))}
          className="nodrag w-16 rounded-md border border-border bg-background p-1 text-sm outline-none"
        />
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="nodrag w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isGenerating ? "Generating…" : history.entries.length > 0 ? "Regenerate" : "Generate"}
      </button>

      <Handle type="target" position={Position.Left} id="text" style={{ top: "20%" }} />
      <Handle type="target" position={Position.Left} id="startFrame" style={{ top: "35%" }} />
      <Handle type="target" position={Position.Left} id="endFrame" style={{ top: "50%" }} />
      <Handle type="target" position={Position.Left} id="imageReference" style={{ top: "65%" }} />
      <Handle type="target" position={Position.Left} id="video" style={{ top: "80%" }} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
