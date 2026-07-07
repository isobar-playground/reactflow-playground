"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
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
import { focusFirstDescendant, trapFocusWithin } from "@/components/nodes/focus-management";
import { useGenerationNodeRuntime } from "@/components/nodes/generation-node-runtime";
import { ModelPicker, type ApprovedPickerModel } from "@/components/nodes/model-picker";
import { NodeActionsMenu } from "@/components/nodes/node-actions-menu";
import { useNodeActions } from "@/components/nodes/use-node-actions";
import { runImageGeneration, resumeImageGeneration, submitImageGeneration } from "@/lib/real-generation";
import type { PendingGeneration } from "@/lib/fal-generation";
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
import type { MediaHandleConnection } from "@/lib/generation-payload";
import type { ModelPricing } from "@/lib/fal-pricing";
import { estimatePrice, formatEstimatedPrice } from "@/lib/price-estimate";
import { computeActualCost, formatActualCost } from "@/lib/actual-cost";
import { reconcileEdges, resolveEdgeDataTypeFromNodes } from "@/lib/edge-reconcile";
import type { StaticTextReferenceNodeData } from "@/components/nodes/static-text-reference-node";
import { BADGE_CLASSES, INPUT_CLASSES, SURFACE_CLASSES } from "@/lib/visual-system";

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
  // The Model's pricing entry (issue #37 / ADR-0009), snapshotted alongside
  // the handles at selection time; null when FAL has no resolvable entry for
  // this endpoint, in which case no Estimated Price is shown.
  pricing?: ModelPricing | null;
  // The Model's schema-derived default `duration` (seconds), used to
  // naively estimate units for a per-second-priced Model (issue #37).
  defaultDurationSeconds?: number;
};

export type ImageGenerationNodeData = {
  prompt: string;
  history: NodeHistory;
  model?: SelectedModel | null;
  negativePrompt?: string;
  // The in-flight FAL queue request (ADR-0009): request id + the status/
  // response URLs returned verbatim by the submit call. Persisted into
  // `data` so a reload can resume polling it (issue #38 — see the mount
  // effect below). Cleared once the generation finishes, whether it
  // succeeds or errors.
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedTriggerRef = useRef<HTMLButtonElement>(null);
  const advancedPanelRef = useRef<HTMLElement>(null);

  const activeEntry = getActiveEntry(history);
  const selectedModel = data.model;
  const hasPendingOutput = Boolean(data.pendingGeneration);
  const activeCostLabel = activeEntry ? formatActualCost(activeEntry.actualCost) : null;
  const statusLabel = isGenerating
    ? "Generating"
    : generationError
      ? "Error"
      : data.pendingGeneration
        ? "Pending"
        : "Ready";

  // Estimated Price (CONTEXT.md / ADR-0009, issue #37): unit price × naively
  // estimated units × variant count, recomputed live as the variant counter
  // changes. Undefined (no display) when the Model has no resolvable
  // pricing entry, or its pricing unit isn't one this naive estimation
  // covers (e.g. a per-second Model with no default duration).
  const estimatedAmount = estimatePrice({
    pricing: selectedModel?.pricing,
    variantCount,
    defaultDurationSeconds: selectedModel?.defaultDurationSeconds,
  });
  const estimatedPriceLabel = formatEstimatedPrice(estimatedAmount);

  // Model picker (CONTEXT.md's Model / issue #29): the picker's own list is
  // just names/thumbnails from the live catalog joined against approvals —
  // no per-model schema fetch here (that's issue #30, lazy at selection per
  // ADR-0008). Fetched once per node mount; the picker only ever needs to
  // show "Approved image-output Models," which doesn't change within a
  // node's lifetime on the canvas.
  const [approvedModels, setApprovedModels] = useState<ApprovedPickerModel[] | null>(null);
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

  // Connected media inputs (issue #40 / ADR-0009, PRD #35): every media
  // Input Handle's currently-connected source nodes, gathered once here (all
  // target connections regardless of handle, then grouped by targetHandle)
  // rather than one useNodeConnections call per handle — the number of media
  // handles varies with the selected Model, and a variable-length hook loop
  // would violate the Rules of Hooks. Handed to lib/real-generation.ts's
  // `media` field, which lib/generation-payload.ts's pure buildGenerationPayload
  // maps into the FAL request body (an array for a `many` handle, a single
  // value otherwise; unconnected handles are simply omitted).
  const allTargetConnections = useNodeConnections({ id, handleType: "target" });
  const mediaSourceIdsByHandle = new Map<string, string[]>();
  for (const connection of allTargetConnections) {
    const handleId = connection.targetHandle;
    if (!handleId || handleId === "text") continue;
    const ids = mediaSourceIdsByHandle.get(handleId) ?? [];
    ids.push(connection.source);
    mediaSourceIdsByHandle.set(handleId, ids);
  }
  const uniqueMediaSourceIds = [...new Set([...mediaSourceIdsByHandle.values()].flat())];
  const mediaSourceNodes = useNodesData(uniqueMediaSourceIds);
  const mediaSourceNodesById = new Map(mediaSourceNodes.map((node) => [node.id, node]));
  const mediaConnections: MediaHandleConnection[] = (selectedModel?.handles ?? []).map((handle) => ({
    handle,
    sources: (mediaSourceIdsByHandle.get(handle.handleId) ?? [])
      .map((nodeId) => mediaSourceNodesById.get(nodeId))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => ({ type: node.type, data: node.data })),
  }));

  const { getNode, getEdges, setEdges, addNodes, addEdges, updateNodeData } = useReactFlow();
  const { duplicate, remove } = useNodeActions(id);
  const { setGenerationNodeRuntime } = useGenerationNodeRuntime();

  useEffect(() => {
    setGenerationNodeRuntime(id, { isGenerating, error: generationError });
    return () => {
      setGenerationNodeRuntime(id, { isGenerating: false, error: null });
    };
  }, [id, isGenerating, generationError, setGenerationNodeRuntime]);

  useEffect(() => {
    if (!advancedOpen || !advancedPanelRef.current) return;
    requestAnimationFrame(() => {
      if (advancedPanelRef.current) focusFirstDescendant(advancedPanelRef.current);
    });
  }, [advancedOpen]);

  function closeAdvancedSettings() {
    setAdvancedOpen(false);
    requestAnimationFrame(() => advancedTriggerRef.current?.focus());
  }

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

  // Resume a pending generation after reload (CONTEXT.md / ADR-0009, issue
  // #38): data.pendingGeneration (written at submit time, issue #36) surviving
  // to mount means FAL is still running — or has already finished — a run
  // this component lost track of client-side. FAL bills it either way, so on
  // mount this resumes polling that exact record (never re-submits) instead
  // of leaving the node stuck showing nothing. Success lands the output in
  // History exactly like a fresh Generate; any failure — including FAL no
  // longer recognizing a stale record — surfaces as the node's normal error
  // state rather than polling forever. Either way the record is cleared from
  // data once the run settles.
  //
  // Guarded by a ref (rather than skipping via the effect's own cleanup) so
  // that clearing pendingGeneration from *this same* resumption — which
  // re-runs the effect, since it's keyed on data.pendingGeneration below —
  // doesn't race its own in-flight promise chain: a cleanup-based `cancelled`
  // flag would flip true the instant the success/failure handler nulls out
  // pendingGeneration, before the chain's own `finally` has run, silently
  // leaving isGenerating stuck true.
  const ownPendingRequestIds = useRef<Set<string>>(new Set());
  const resumedRequestIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = data.pendingGeneration;
    if (pending && ownPendingRequestIds.current.has(pending.requestId)) return;
    if (!pending || resumedRequestIds.current.has(pending.requestId)) return;
    resumedRequestIds.current.add(pending.requestId);
    setIsGenerating(true);
    setGenerationError(null);
    resumeImageGeneration(pending)
      .then((result) => {
        const { billableUnits, ...output } = result;
        const actualCost = computeActualCost({ pricing: selectedModel?.pricing, billableUnits });
        updateNodeData(id, {
          history: appendEntry(history, { id: crypto.randomUUID(), prompt, output, actualCost }),
          pendingGeneration: null,
        });
      })
      .catch((error) => {
        setGenerationError(error instanceof Error ? error.message : "Generation failed");
        updateNodeData(id, { pendingGeneration: null });
      })
      .finally(() => {
        setIsGenerating(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pendingGeneration]);

  // The node's own generation — the normal single-Generate path (CONTEXT.md /
  // ADR-0009): submit a real request to the selected Model's FAL queue
  // endpoint, sending the Resolved Prompt as `prompt` and the negative-prompt
  // config field when the Model supports it. The returned pending record is
  // written through to data.pendingGeneration as soon as FAL accepts the
  // submission (ADR-0009: enables resuming polling after a reload, wired
  // separately in issue #38) and cleared once the run settles. On success, a
  // new History entry becomes the Active Output (ADR-0002 / issue #16); on
  // any FAL failure, an error message is shown instead and no History entry
  // is added. Never throws — a failure settles into the node's own error
  // state, so a variant batch awaiting this run isn't torn down by it
  // (ADR-0011).
  async function runOwnGeneration() {
    if (!selectedModel) return;
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const negativePrompt =
        selectedModel.hasNegativePrompt && data.negativePrompt ? data.negativePrompt : undefined;
      const result = await runImageGeneration(
        { endpointId: selectedModel.endpointId, prompt: resolvedPromptText, negativePrompt, media: mediaConnections },
        {
          onPending: (pending) => {
            ownPendingRequestIds.current.add(pending.requestId);
            updateNodeData(id, { pendingGeneration: pending });
          },
        },
      );
      const { billableUnits, ...output } = result;
      const actualCost = computeActualCost({ pricing: selectedModel.pricing, billableUnits });
      updateNodeData(id, {
        history: appendEntry(history, { id: crypto.randomUUID(), prompt, output, actualCost }),
        pendingGeneration: null,
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Generation failed");
      updateNodeData(id, { pendingGeneration: null });
    } finally {
      setIsGenerating(false);
    }
  }

  // Variant cloning (CONTEXT.md / ADR-0011, issues #12, #47 and #48): the
  // counter is the *total* number of variants and this node is one of them,
  // so every variant runs its own generation — this node through the normal
  // single-Generate path above (History append, pendingGeneration
  // write-through, its own error state), plus (count - 1) sibling clones
  // added beside it. Each clone inherits only the original's incoming edges
  // (lib/variant-clone.ts), is laid out with an offset, and generates its own
  // single fresh output — never a copy of this node's History. The counter
  // resets to 1 at trigger time.
  //
  // A variant run is owned by the variant node, not by this submitter
  // (ADR-0011): the clones land on the canvas immediately — before any run
  // finishes — and this handler only *submits* their runs
  // (lib/real-generation.ts's submit-only submitImageGeneration), writing
  // each clone's pending record into that clone's node data as its
  // submission is accepted. The clone's own resume-on-mount machinery (the
  // effect above, issue #38) picks the record up, polls the run to
  // completion, and appends the single fresh output as the clone's only
  // History entry — this submitter never polls a clone's run, so nothing
  // here can double-append. A clone's failed run surfaces as that clone's
  // own error state with no History entry, and no variant's failure blocks
  // its siblings.
  //
  // ADR-0002: getNode(id) already returns the live `data.prompt` — the
  // prompt field writes through on every keystroke — so no manual merge of
  // the local prompt into the cloned node's data is needed here.
  async function handleGenerateVariants(count: number) {
    if (!selectedModel) return;
    const node = getNode(id);
    if (!node) return;
    const { nodes: clones, edges: clonedEdges } = cloneVariants(node, getEdges(), count - 1);
    setVariantCountInput("1");

    // Clones appear at trigger time, each starting with no run of its own
    // yet — never with this node's pendingGeneration, which belongs to the
    // original's run alone.
    addNodes(clones.map((clone) => ({ ...clone, data: { ...clone.data, pendingGeneration: null } })));
    addEdges(clonedEdges);

    // The original's run fires first, through the normal single-Generate
    // path — never awaited before the clones' submissions, so no variant's
    // run blocks another's.
    const ownRun = runOwnGeneration();

    const negativePrompt =
      selectedModel.hasNegativePrompt && data.negativePrompt ? data.negativePrompt : undefined;
    // Each clone inherits the original's incoming reference edges verbatim
    // (lib/variant-clone.ts), so its wired media inputs are the same
    // `mediaConnections` this node itself just computed (issue #40). A
    // submission FAL rejects leaves that clone without a run — its siblings'
    // submissions proceed regardless.
    await Promise.all(
      clones.map((clone) =>
        submitImageGeneration({
          endpointId: selectedModel.endpointId,
          prompt: resolvedPromptText,
          negativePrompt,
          media: mediaConnections,
        })
          .then((pending) => updateNodeData(clone.id, { pendingGeneration: pending }))
          .catch(() => null),
      ),
    );
    await ownRun;
  }

  async function handleGenerate() {
    if (variantCount > 1) {
      await handleGenerateVariants(variantCount);
      return;
    }
    await runOwnGeneration();
  }

  // Selecting a History thumbnail sets the Active Output and restores that
  // entry's prompt into the field. It never triggers regeneration — a pure
  // pointer swap written through to data (ADR-0002 / issue #16).
  function handleSelectHistoryEntry(entryId: string) {
    const selected = history.entries.find((entry) => entry.id === entryId);
    if (!selected) return;
    updateNodeData(id, { history: setActiveEntry(history, entryId), prompt: selected.prompt });
  }

  function handleSelectModel(chosen: ApprovedPickerModel) {
    void fetchModelSchemaAction(chosen.endpointId).then(
      ({ handles, hasNegativePrompt, pricing, defaultDurationSeconds }) => {
        updateNodeData(id, {
          model: {
            endpointId: chosen.endpointId,
            name: chosen.name,
            category: chosen.category,
            handles,
            hasNegativePrompt,
            pricing,
            defaultDurationSeconds,
          },
        });
        setEdges((edges) =>
          reconcileEdges(edges, id, handles, resolveEdgeDataTypeFromNodes(getNode)),
        );
      },
    );
  }

  return (
    <div className={`${SURFACE_CLASSES.card} studio-node w-[26rem] rounded-xl p-3`} data-node-id={id}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--studio-ink)]">Image Generation Node</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedModel?.name ?? "No model selected"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`${BADGE_CLASSES} border-[var(--data-image-border)] bg-[var(--data-image-bg)] text-[var(--data-image-fg)]`}>
            {modeLabel}
          </span>
          <button
            ref={advancedTriggerRef}
            type="button"
            aria-label={advancedOpen ? "Close advanced settings" : "Open advanced settings"}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="nodrag flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--studio-border)] bg-[var(--studio-input)] text-muted-foreground shadow-sm transition-colors hover:border-[var(--studio-border-strong)] hover:bg-[var(--studio-control-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]"
            title={advancedOpen ? "Close advanced settings" : "Open advanced settings"}
          >
            <Settings2 className="size-3.5" />
          </button>
          <NodeActionsMenu onDuplicate={duplicate} onDelete={remove} />
        </div>
      </div>

      <div
        aria-label="Image generation preview"
        className="mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--studio-border)] bg-muted"
      >
        {hasPendingOutput ? (
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <span className="size-8 animate-pulse rounded-full border border-primary/40 bg-primary/10" />
            <span>Pending output</span>
          </div>
        ) : activeEntry ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activeEntry.output.url}
            alt="Generation output"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No output yet</span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
        <div className="min-w-0 rounded-md border border-[var(--studio-border)] bg-muted px-2 py-1">
          <div className="text-[10px] uppercase tracking-normal">Model</div>
          <div className="truncate font-medium text-[var(--studio-ink)]">
            {selectedModel?.name ?? "Select a model"}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-[var(--studio-border)] bg-muted px-2 py-1">
          <div className="text-[10px] uppercase tracking-normal">Status</div>
          <div className="truncate font-medium text-[var(--studio-ink)]">{statusLabel}</div>
        </div>
        <div className="min-w-0 rounded-md border border-[var(--studio-border)] bg-muted px-2 py-1">
          <div className="text-[10px] uppercase tracking-normal">Estimated Price</div>
          <div className="truncate font-medium text-[var(--studio-ink)]">
            {estimatedPriceLabel ?? "Unavailable"}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-[var(--studio-border)] bg-muted px-2 py-1">
          <div className="text-[10px] uppercase tracking-normal">Actual Cost</div>
          <div className="truncate font-medium text-[var(--studio-ink)]">
            {activeCostLabel ?? "Unavailable"}
          </div>
        </div>
      </div>

      {/* History carousel (CONTEXT.md): appears once there are multiple
          completed entries, or when an accepted Pending Output sits beside
          existing History. The pending placeholder is transient UI only,
          never a draft History entry. Each completed thumbnail shows its
          own Actual Cost underneath (issue #41). */}
      {(history.entries.length >= 2 || (history.entries.length > 0 && hasPendingOutput)) && (
        <div className="nodrag mb-3 flex gap-1.5 overflow-x-auto">
          {history.entries.map((entry) => (
            <div key={entry.id} className="flex shrink-0 flex-col items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleSelectHistoryEntry(entry.id)}
                className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)] ${
                  entry.id === history.activeId ? "border-primary ring-2 ring-[var(--studio-focus-ring)]" : "border-border"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.output.url}
                  alt="History entry"
                  className="h-full w-full object-cover"
                />
              </button>
              {formatActualCost(entry.actualCost) && (
                <span className="text-[10px] text-muted-foreground">
                  {formatActualCost(entry.actualCost)}
                </span>
              )}
            </div>
          ))}
          {hasPendingOutput && (
            <div
              aria-label="Pending history entry"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-primary/50 bg-primary/10"
            >
              <span className="size-4 animate-pulse rounded-full bg-primary/40" />
            </div>
          )}
        </div>
      )}

      <textarea
        className={`${INPUT_CLASSES} nodrag mb-3 w-full resize-none p-2`}
        rows={3}
        value={prompt}
        onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
        placeholder="Enter a prompt…"
        data-node-id={id}
      />

      {/* Resolved Prompt preview (CONTEXT.md): connected Static Text
          References (edge order) concatenated with the local prompt. */}
      {resolvedPromptText.length > 0 && (
        <div className="mb-3 rounded-md border border-[var(--studio-border)] bg-muted p-2 text-xs text-muted-foreground">
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
          className={`${INPUT_CLASSES} nodrag w-16 p-1`}
        />

        {/* Model picker (CONTEXT.md's Model / issue #58): lists Approved
            image-output Models only in a rich popover. Selecting or
            re-selecting a Model still lazily fetches that endpoint's FAL
            input schema, snapshots its handles into node data, and
            reconciles existing edges against the refreshed handle set. */}
        <ModelPicker
          kind="image"
          models={approvedModels}
          selectedModel={selectedModel}
          onSelect={handleSelectModel}
        />
      </div>

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

      {advancedOpen && (
        <section
          ref={advancedPanelRef}
          role="region"
          aria-label="Advanced image generation settings"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (advancedPanelRef.current) {
              trapFocusWithin(event, advancedPanelRef.current, closeAdvancedSettings);
            }
          }}
          className="nodrag mb-3 space-y-3 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)] p-3 text-xs"
        >
          {selectedModel?.hasNegativePrompt && (
            <label className="block">
              <span className="mb-1 block font-medium text-[var(--studio-ink)]">Negative prompt</span>
              <textarea
                aria-label="Negative prompt"
                className={`${INPUT_CLASSES} nodrag w-full resize-none p-2`}
                rows={2}
                value={data.negativePrompt ?? ""}
                onChange={(event) => updateNodeData(id, { negativePrompt: event.target.value })}
                placeholder="Negative prompt (optional)…"
              />
            </label>
          )}

          <div className="rounded-md border border-[var(--studio-border)] bg-muted p-2">
            <div className="mb-1 font-medium text-[var(--studio-ink)]">Resolved Prompt</div>
            <div className="break-words text-muted-foreground">
              {resolvedPromptText || "No prompt text"}
            </div>
          </div>

          <div className="rounded-md border border-[var(--studio-border)] bg-muted p-2">
            <div className="mb-1 font-medium text-[var(--studio-ink)]">Model Details</div>
            <dl className="space-y-1 text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>Name</dt>
                <dd className="min-w-0 truncate text-right text-[var(--studio-ink)]">
                  {selectedModel?.name ?? "None"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Endpoint</dt>
                <dd className="min-w-0 truncate text-right text-[var(--studio-ink)]">
                  {selectedModel?.endpointId ?? "None"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Status</dt>
                <dd className="text-[var(--studio-ink)]">{statusLabel}</dd>
              </div>
              {generationError && (
                <div className="flex justify-between gap-2">
                  <dt>Error</dt>
                  <dd className="min-w-0 truncate text-right text-destructive">{generationError}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-md border border-[var(--studio-border)] bg-muted p-2">
            <div className="mb-2 font-medium text-[var(--studio-ink)]">Full History</div>
            {history.entries.length > 0 ? (
              <ol className="space-y-2">
                {history.entries.map((entry, index) => (
                  <li key={entry.id} className="rounded-md bg-[var(--studio-card)] p-2">
                    <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                      <span>Entry {index + 1}</span>
                      {formatActualCost(entry.actualCost) && (
                        <span>{formatActualCost(entry.actualCost)}</span>
                      )}
                    </div>
                    <div className="break-words text-[var(--studio-ink)]">{entry.prompt}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-muted-foreground">No History yet</div>
            )}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !selectedModel}
          className="nodrag flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)] disabled:pointer-events-none disabled:opacity-45"
        >
          {isGenerating ? "Generating…" : history.entries.length > 0 ? "Regenerate" : "Generate"}
        </button>
      </div>

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
