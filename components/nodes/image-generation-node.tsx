"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { generateImagePlaceholder, type ImagePlaceholderResult } from "@/lib/generation-mock";

export type ImageGenerationNodeData = {
  prompt: string;
  output: ImagePlaceholderResult | null;
};

export type ImageGenerationNodeType = Node<ImageGenerationNodeData, "imageGeneration">;

// Decorative-only chips from the reference screenshot (PRD story #60): they
// render to match the look but are intentionally inert — no state, no
// handlers beyond swallowing the click.
const DECORATIVE_CHIPS = ["1K", "1:1", "Light", "Style", "Camera"];

// The core Generation Node (CONTEXT.md): a Generation Node with an output
// handle and, later, named input handles (issue #8). This slice has no
// inputs yet, only the local prompt field and a single output — so it has
// an output handle and no input handle, like a Reference, but it also
// produces (rather than just holds) data.
export function ImageGenerationNode({ id, data }: NodeProps<ImageGenerationNodeType>) {
  const [prompt, setPrompt] = useState(data.prompt);
  const [output, setOutput] = useState<ImagePlaceholderResult | null>(data.output);
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleGenerate() {
    setIsGenerating(true);
    const result = await generateImagePlaceholder();
    setOutput(result);
    setIsGenerating(false);
  }

  return (
    <div className="w-96 rounded-xl border border-border bg-card p-3 shadow-sm" data-node-id={id}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">Image Generation Node</div>

      <div className="mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
        {isGenerating ? (
          <span className="text-sm text-muted-foreground">Generating…</span>
        ) : output ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={output.url}
            alt="Generation output"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No output yet</span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {DECORATIVE_CHIPS.map((label) => (
          <button
            key={label}
            type="button"
            disabled
            className="nodrag rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled
          className="nodrag rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
        >
          Model
        </button>
        <button
          type="button"
          disabled
          className="nodrag rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
        >
          Credits
        </button>
        <button
          type="button"
          disabled
          className="nodrag rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
        >
          Settings
        </button>
      </div>

      <textarea
        className="nodrag mb-3 w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none"
        rows={3}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Enter a prompt…"
        data-node-id={id}
      />

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="nodrag w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isGenerating ? "Generating…" : output ? "Regenerate" : "Generate"}
      </button>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
