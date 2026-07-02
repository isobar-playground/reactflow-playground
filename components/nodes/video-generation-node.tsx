"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Position,
  useNodeConnections,
  useNodesData,
  useReactFlow,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { HandleBadge } from "@/components/nodes/handle-badge";
import { NodeActionsMenu } from "@/components/nodes/node-actions-menu";
import { useNodeActions } from "@/components/nodes/use-node-actions";
import { generateVideoPlaceholder } from "@/lib/generation-mock";
import {
  appendEntry,
  setActiveEntry,
  getActiveEntry,
  type NodeHistory,
} from "@/lib/node-history";
import { resolvedPrompt } from "@/lib/resolved-prompt";
import { videoGenerationMode, videoGenerationModeLabel, modelCategoryLabel } from "@/lib/generation-mode";
import { cloneVariants } from "@/lib/variant-clone";
import { approvedModelsForKind } from "@/app/models-actions";
import type { Model } from "@/lib/fal-models";
import { fetchModelInputSchema, deriveInputHandles, type ResolvedHandle } from "@/lib/fal-schema";
import type { StaticTextReferenceNodeData } from "@/components/nodes/static-text-reference-node";
import type { SelectedModel } from "@/components/nodes/image-generation-node";

export type VideoGenerationNodeData = {
  prompt: string;
  history: NodeHistory;
  model?: SelectedModel | null;
  negativePrompt?: string;
};

export type VideoGenerationNodeType = Node<VideoGenerationNodeData, "videoGeneration">;

// The Video Generation Node (CONTEXT.md / issue #11, reshaped by issue #31 /
// ADR-0007): a Generation Node whose output is a video. Until issue #31 it
// had fixed, hand-declared input handles (`startFrame`/`endFrame`/
// `imageReference`/`video`) and a connection-derived mode. It now mirrors
// the Image Generation Node's pattern (components/nodes/image-generation-node.tsx,
// issues #29/#30): a Model picker beside Variants lists Approved
// video-output Models; selecting one snapshots that Model's schema-derived
// Input Handles into `data.model`, which the node renders from — no input
// handles at all until a Model is selected.
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
  const selectedModel = data.model;

  // Model picker (CONTEXT.md's Model / issue #31): the picker's own list is
  // just names/thumbnails from the live catalog joined against approvals —
  // no per-model schema fetch here (lazy, at selection, per ADR-0008).
  // Fetched once per node mount; the picker only ever needs to show
  // "Approved video-output Models," which doesn't change within a node's
  // lifetime on the canvas.
  const [approvedModels, setApprovedModels] = useState<Model[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void approvedModelsForKind("video").then((models) => {
      if (!cancelled) setApprovedModels(models);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Label (CONTEXT.md's Model / ADR-0007, issue #31): once a Model is
  // selected, its category is the node's label — a property of the chosen
  // Model, not derived from connections. Falls back to the old
  // connection-derived mode label (issue #11) only while no Model is chosen
  // yet, so a fresh node still communicates something before its first pick.
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
  const modeLabel = selectedModel
    ? modelCategoryLabel(selectedModel.category)
    : videoGenerationModeLabel(mode);

  // Input Handle layout (ADR-0007 / ADR-0008 / issue #31): `text` is the
  // node's fixed prompt mechanism — present whenever a Model is selected,
  // never itself schema-derived — followed by one handle per entry in the
  // Model's snapshotted, schema-derived handle set, in schema order.
  const inputHandleLayout: ResolvedHandle[] = selectedModel
    ? [{ handleId: "text", label: "text", dataType: "text", many: true }, ...selectedModel.handles]
    : [];

  const { getNode, getEdges, addNodes, addEdges, updateNodeData } = useReactFlow();
  const { duplicate, remove } = useNodeActions(id);

  // Variant cloning (CONTEXT.md / issue #12): when the counter is above one,
  // Generate adds (count - 1) sibling clones beside this node instead of
  // appending to its own History — the counter is the total number of
  // variants, and this node is already one of them. Each clone inherits only
  // the original's incoming edges (lib/variant-clone.ts), is laid out with an
  // offset, and generates its own single fresh output — never a copy of this
  // node's History. The counter resets to 1 afterward. Mirrors
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
    const { nodes: clones, edges: clonedEdges } = cloneVariants(node, getEdges(), count - 1);

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
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {modeLabel}
          </span>
          <NodeActionsMenu onDuplicate={duplicate} onDelete={remove} />
        </div>
      </div>

      {/* Output box: only takes up space once there's something to show —
          a fresh node has no "no output yet" placeholder. */}
      {(isGenerating || activeEntry) && (
        <div className="mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
          {isGenerating ? (
            <span className="text-sm text-muted-foreground">Generating…</span>
          ) : (
            <video
              src={activeEntry!.output.url}
              className="h-full w-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
          )}
        </div>
      )}

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

      {/* Negative-prompt config field (CONTEXT.md's Generation Node / ADR-0007,
          issue #32): shown only when the selected Model's schema has a
          `negative_prompt` field (data.model.hasNegativePrompt). It is a plain
          config field written through to data.negativePrompt — not an Input
          Handle, and never mixed into the Resolved Prompt below. */}
      {selectedModel?.hasNegativePrompt && (
        <textarea
          aria-label="Negative prompt"
          className="nodrag mb-3 w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none"
          rows={2}
          value={data.negativePrompt ?? ""}
          onChange={(event) => updateNodeData(id, { negativePrompt: event.target.value })}
          placeholder="Negative prompt (optional)…"
        />
      )}

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

        {/* Model picker (CONTEXT.md's Model / issue #31): lists Approved
            video-output Models only. Selecting one writes endpointId, name
            and category through to data.model (ADR-0002), and lazily
            fetches that one endpoint's FAL input schema, derives its Input
            Handles, and snapshots them alongside it (ADR-0008). The
            snapshot is what the handles below render from; it's never
            re-derived live on load. */}
        {approvedModels && approvedModels.length > 0 && (
          <select
            aria-label="Model"
            className="nodrag flex-1 rounded-md border border-border bg-background p-1 text-sm outline-none"
            value={selectedModel?.endpointId ?? ""}
            onChange={(event) => {
              const chosen = approvedModels.find((m) => m.endpointId === event.target.value);
              if (!chosen) {
                updateNodeData(id, { model: null });
                return;
              }
              void fetchModelInputSchema(chosen.endpointId).then((schema) => {
                const { handles, hasNegativePrompt } = deriveInputHandles(schema, chosen.endpointId);
                updateNodeData(id, {
                  model: {
                    endpointId: chosen.endpointId,
                    name: chosen.name,
                    category: chosen.category,
                    handles,
                    hasNegativePrompt,
                  },
                });
              });
            }}
          >
            <option value="">Select a model…</option>
            {approvedModels.map((m) => (
              <option key={m.endpointId} value={m.endpointId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* No-model / empty-picker states (issue #31): a fetched-but-empty
          catalog points the author at /models rather than showing a picker
          with nothing in it; otherwise, an unselected picker gets a plain
          text nudge alongside the dropdown above. */}
      {approvedModels && approvedModels.length === 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          No approved video models yet — approve one on{" "}
          <Link href="/models" className="underline">
            /models
          </Link>
          .
        </p>
      )}
      {approvedModels && approvedModels.length > 0 && !selectedModel && (
        <p className="mb-3 text-xs text-muted-foreground">Select a model to configure this node.</p>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="nodrag w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isGenerating ? "Generating…" : history.entries.length > 0 ? "Regenerate" : "Generate"}
      </button>

      {/* Input Handles (ADR-0007 / ADR-0008 / issue #31): none until a Model
          is selected. Once selected, `text` stays the node's fixed prompt
          mechanism (not schema-derived — ADR-0007), followed by one handle
          per entry in the Model's snapshotted schema-derived handle set,
          evenly spaced down the left edge. */}
      {selectedModel &&
        inputHandleLayout.map(({ handleId, dataType }, index) => (
          <HandleBadge
            key={handleId}
            type="target"
            position={Position.Left}
            id={handleId}
            dataType={dataType}
            style={{ top: `${((index + 1) / (inputHandleLayout.length + 1)) * 100}%` }}
          />
        ))}
      <HandleBadge type="source" position={Position.Right} dataType="video" />
    </div>
  );
}
