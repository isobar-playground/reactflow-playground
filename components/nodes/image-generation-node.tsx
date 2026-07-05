"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Position,
  useNodeConnections,
  useNodesData,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { HandleBadge } from "@/components/nodes/handle-badge";
import { NodeActionsMenu } from "@/components/nodes/node-actions-menu";
import { useNodeActions } from "@/components/nodes/use-node-actions";
import { runImageGeneration } from "@/lib/real-generation";
import type { PendingGeneration } from "@/app/generation-actions";
import {
  appendEntry,
  setActiveEntry,
  getActiveEntry,
  type NodeHistory,
} from "@/lib/node-history";
import { resolvedPrompt } from "@/lib/resolved-prompt";
import { imageGenerationMode, imageGenerationModeLabel, modelCategoryLabel } from "@/lib/generation-mode";
import { cloneVariants } from "@/lib/variant-clone";
import { approvedModelsForKind, fetchModelSchemaAction } from "@/app/models-actions";
import type { Model } from "@/lib/fal-models";
import type { ResolvedHandle } from "@/lib/fal-schema";
import { reconcileEdges, resolveEdgeDataTypeFromNodes } from "@/lib/edge-reconcile";
import type { StaticTextReferenceNodeData } from "@/components/nodes/static-text-reference-node";

// The Model recorded on a Generation Node once selected (CONTEXT.md's Model /
// ADR-0007): enough to show the picker's current value, drive the node's
// label, AND (issue #30 / ADR-0008) the resolved Input Handle set snapshotted
// from that one endpoint's FAL schema at selection time — never re-derived
// live on load.
export type SelectedModel = {
  endpointId: string;
  name: string;
  category: Model["category"];
  handles: ResolvedHandle[];
  hasNegativePrompt: boolean;
};

export type ImageGenerationNodeData = {
  prompt: string;
  history: NodeHistory;
  model?: SelectedModel | null;
  negativePrompt?: string;
  // The in-flight FAL queue request (ADR-0009): request id + the status/
  // response URLs returned verbatim by the submit call. Persisted into
  // `data` so a reload can resume polling it (issue #38 wires the actual
  // resumption; this issue only needs the record to land here). Cleared
  // once the generation finishes, whether it succeeds or errors.
  pendingGeneration?: PendingGeneration | null;
};

export type ImageGenerationNodeType = Node<ImageGenerationNodeData, "imageGeneration">;

// The core Generation Node (CONTEXT.md): a Generation Node with an output
// handle and named input handles. Issue #8 adds the `text` input handle,
// which accepts Static Text References and feeds the Resolved Prompt
// preview; issue #10 adds the `image` handle and the derived edit-mode
// label — the mode is never chosen by hand, only computed from whether any
// image is connected.
//
// ADR-0002: the prompt field and History are both controlled from `data`
// and write through with updateNodeData on every change rather than
// shadowing them in local state — otherwise neither reaches autosave, and a
// downstream node's useNodesData read of the Active Output (or the Resolved
// Prompt) would go stale. Only the in-progress `isGenerating` flag is
// transient UI state and stays local (issue #16).
export function ImageGenerationNode({ id, data }: NodeProps<ImageGenerationNodeType>) {
  const prompt = data.prompt;
  const history = data.history;
  const [isGenerating, setIsGenerating] = useState(false);
  // FAL failure (CONTEXT.md / ADR-0009): any error from the real generation
  // surfaces as a message in the node and adds no History entry. Transient
  // UI state, like isGenerating (issue #16) — not persisted to data.
  const [generationError, setGenerationError] = useState<string | null>(null);
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

  // Model picker (CONTEXT.md's Model / issue #29): the picker's own list is
  // just names/thumbnails from the live catalog joined against approvals —
  // no per-model schema fetch here (that's issue #30, lazy at selection per
  // ADR-0008). Fetched once per node mount; the picker only ever needs to
  // show "Approved image-output Models," which doesn't change within a
  // node's lifetime on the canvas.
  const [approvedModels, setApprovedModels] = useState<Model[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void approvedModelsForKind("image").then((models) => {
      if (!cancelled) setApprovedModels(models);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolved Prompt (CONTEXT.md): the text of all connected Static Text
  // References, in edge order, concatenated with the local prompt field.
  // useNodeConnections returns connections in edge order; useNodesData
  // reads each connected node's live text so the preview updates as those
  // nodes are edited.
  const textConnections = useNodeConnections({ id, handleType: "target", handleId: "text" });
  const connectedTextNodeIds = textConnections.map((connection) => connection.source);
  const connectedTextNodes = useNodesData<Node<StaticTextReferenceNodeData>>(connectedTextNodeIds);
  const connectedTextByNodeId = new Map(
    connectedTextNodes.map((node) => [node.id, node.data.text]),
  );
  const connectedTexts = connectedTextNodeIds.map((nodeId) => connectedTextByNodeId.get(nodeId) ?? "");
  const resolvedPromptText = resolvedPrompt(connectedTexts, prompt);

  // Label (CONTEXT.md's Model / ADR-0007, issue #29): once a Model is
  // selected, its category is the node's label — a property of the chosen
  // Model, not derived from connections. Falls back to the old
  // connection-derived mode label (issue #10) only while no Model is chosen
  // yet, so a fresh node still communicates something before its first pick.
  const imageConnections = useNodeConnections({ id, handleType: "target", handleId: "image" });
  const mode = imageGenerationMode(imageConnections.length > 0);
  const modeLabel = selectedModel
    ? modelCategoryLabel(selectedModel.category)
    : imageGenerationModeLabel(mode);

  // Input Handle layout (ADR-0007 / ADR-0008 / issue #30): `text` is the
  // node's fixed prompt mechanism — present whenever a Model is selected,
  // never itself schema-derived — followed by one handle per entry in the
  // Model's snapshotted, schema-derived handle set, in schema order.
  const inputHandleLayout: ResolvedHandle[] = selectedModel
    ? [{ handleId: "text", label: "text", dataType: "text", many: true }, ...selectedModel.handles]
    : [];

  const { getNode, getEdges, setEdges, addNodes, addEdges, updateNodeData } = useReactFlow();
  const { duplicate, remove } = useNodeActions(id);

  // React Flow only re-measures a node's Handle positions on resize/mount
  // (useUpdateNodeInternals' own documented caveat — see
  // static-media-reference-node.tsx's identical use for ADR-0003's Asset
  // Picker deferral); selecting or changing the Model swaps the whole
  // Input Handle set without a resize, so without this an edge created
  // right after Model selection (e.g. a Handle-Spawned Node's deferred
  // connect, issue #34, or issue #33's reconciled edges) has nowhere valid
  // to render from and silently never appears.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [selectedModel?.endpointId, inputHandleLayout.length, id, updateNodeInternals]);

  // Variant cloning (CONTEXT.md / issue #12): when the counter is above one,
  // Generate adds (count - 1) sibling clones beside this node instead of
  // appending to its own History — the counter is the total number of
  // variants, and this node is already one of them. Each clone inherits only
  // the original's incoming edges (lib/variant-clone.ts), is laid out with an
  // offset, and generates its own single fresh output — never a copy of this
  // node's History. The counter resets to 1 afterward.
  //
  // ADR-0002: getNode(id) already returns the live `data.prompt` — the
  // prompt field writes through on every keystroke — so no manual merge of
  // the local prompt into the cloned node's data is needed here.
  // Each clone runs its own independent real FAL submission (CONTEXT.md /
  // ADR-0009's Variant / Clone) — never a shared or copied result. A clone
  // whose generation errors gets no History entry (CONTEXT.md), same as the
  // single-generation path below, but doesn't block its siblings.
  async function handleGenerateVariants(count: number) {
    if (!selectedModel) return;
    setIsGenerating(true);
    const node = getNode(id);
    if (!node) {
      setIsGenerating(false);
      return;
    }
    const { nodes: clones, edges: clonedEdges } = cloneVariants(node, getEdges(), count - 1);

    const negativePrompt =
      selectedModel.hasNegativePrompt && data.negativePrompt ? data.negativePrompt : undefined;
    const generated = await Promise.all(
      clones.map(() =>
        runImageGeneration({
          endpointId: selectedModel.endpointId,
          prompt: resolvedPromptText,
          negativePrompt,
        }).catch(() => null),
      ),
    );
    const clonesWithOutput = clones.map((clone, index) => {
      const result = generated[index];
      return {
        ...clone,
        data: {
          ...clone.data,
          history: result
            ? appendEntry(clone.data.history as NodeHistory, {
                id: crypto.randomUUID(),
                prompt,
                output: result,
              })
            : clone.data.history,
        },
      };
    });

    addNodes(clonesWithOutput);
    addEdges(clonedEdges);
    setVariantCountInput("1");
    setIsGenerating(false);
  }

  // Every Generate/Regenerate submits a real request to the selected Model's
  // FAL queue endpoint (CONTEXT.md / ADR-0009), sending the Resolved Prompt
  // as `prompt` and the negative-prompt config field when the Model supports
  // it. The returned pending record is written through to data.pending
  // Generation as soon as FAL accepts the submission (ADR-0009: enables
  // resuming polling after a reload, wired separately in issue #38) and
  // cleared once the run settles. On success, a new History entry becomes
  // the Active Output (ADR-0002 / issue #16); on any FAL failure, an error
  // message is shown instead and no History entry is added.
  async function handleGenerate() {
    if (variantCount > 1) {
      await handleGenerateVariants(variantCount);
      return;
    }
    if (!selectedModel) return;
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const negativePrompt =
        selectedModel.hasNegativePrompt && data.negativePrompt ? data.negativePrompt : undefined;
      const result = await runImageGeneration(
        { endpointId: selectedModel.endpointId, prompt: resolvedPromptText, negativePrompt },
        { onPending: (pending) => updateNodeData(id, { pendingGeneration: pending }) },
      );
      updateNodeData(id, {
        history: appendEntry(history, { id: crypto.randomUUID(), prompt, output: result }),
        pendingGeneration: null,
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Generation failed");
      updateNodeData(id, { pendingGeneration: null });
    } finally {
      setIsGenerating(false);
    }
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
        <span className="text-xs font-medium text-muted-foreground">Image Generation Node</span>
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeEntry!.output.url}
              alt="Generation output"
              className="h-full w-full object-cover"
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.output.url}
                alt="History entry"
                className="h-full w-full object-cover"
              />
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

        {/* Model picker (CONTEXT.md's Model / issue #29): lists Approved
            image-output Models only. Selecting one writes endpointId, name
            and category through to data.model (ADR-0002), and — issue #30 /
            ADR-0008 — lazily fetches that one endpoint's FAL input schema,
            derives its Input Handles, and snapshots them alongside it. The
            snapshot is what the handles below render from; it's never
            re-derived live on load. Re-selecting (issue #33 / ADR-0008):
            recomputing the snapshot also reconciles this node's existing
            input edges against the new handle set, silently dropping any
            (per ADR-0004) whose handle is now absent or type-incompatible —
            re-picking the same Model is a no-op since its handles are
            unchanged. */}
        {approvedModels && approvedModels.length > 0 && (
          <select
            aria-label="Model"
            className="nodrag flex-1 rounded-md border border-border bg-background p-1 text-sm outline-none"
            value={selectedModel?.endpointId ?? ""}
            onChange={(event) => {
              const chosen = approvedModels.find((m) => m.endpointId === event.target.value);
              if (!chosen) {
                updateNodeData(id, { model: null });
                setEdges((edges) => reconcileEdges(edges, id, [], resolveEdgeDataTypeFromNodes(getNode)));
                return;
              }
              void fetchModelSchemaAction(chosen.endpointId).then(({ handles, hasNegativePrompt }) => {
                updateNodeData(id, {
                  model: {
                    endpointId: chosen.endpointId,
                    name: chosen.name,
                    category: chosen.category,
                    handles,
                    hasNegativePrompt,
                  },
                });
                setEdges((edges) =>
                  reconcileEdges(edges, id, handles, resolveEdgeDataTypeFromNodes(getNode)),
                );
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

      {/* No-model / empty-picker states (issue #29): a fetched-but-empty
          catalog points the author at /models rather than showing a picker
          with nothing in it; otherwise, an unselected picker gets a plain
          text nudge alongside the dropdown above. */}
      {approvedModels && approvedModels.length === 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          No approved image models yet — approve one on{" "}
          <Link href="/models" className="underline">
            /models
          </Link>
          .
        </p>
      )}
      {approvedModels && approvedModels.length > 0 && !selectedModel && (
        <p className="mb-3 text-xs text-muted-foreground">Select a model to configure this node.</p>
      )}

      {/* FAL failure (CONTEXT.md / ADR-0009): shown instead of a History
          entry — no entry is ever added for a failed generation. */}
      {generationError && (
        <p role="alert" className="mb-3 text-xs text-destructive">
          {generationError}
        </p>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating || !selectedModel}
        className="nodrag w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isGenerating ? "Generating…" : history.entries.length > 0 ? "Regenerate" : "Generate"}
      </button>

      {/* Input Handles (ADR-0007 / ADR-0008 / issue #30): none until a Model
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
      <HandleBadge type="source" position={Position.Right} dataType="image" />
    </div>
  );
}
