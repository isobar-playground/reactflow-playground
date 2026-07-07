"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Model } from "@/lib/fal-models";
import { formatUnitPrice, type ModelPricing } from "@/lib/fal-pricing";
import { modelCategoryLabel } from "@/lib/generation-mode";
import { deriveFamily } from "@/lib/model-family";
import { INPUT_CLASSES } from "@/lib/visual-system";
import type { SelectedModel } from "@/components/nodes/image-generation-node";

export type ApprovedPickerModel = Model & {
  pricing?: ModelPricing | null;
};

interface ModelPickerProps {
  kind: "image" | "video";
  models: ApprovedPickerModel[] | null;
  selectedModel: SelectedModel | null | undefined;
  onSelect: (model: ApprovedPickerModel) => void;
}

export function ModelPicker({ kind, models, selectedModel, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const availableModels = models ?? [];
  const selectedIndex = availableModels.findIndex((model) => model.endpointId === selectedModel?.endpointId);
  const activeModel = availableModels[activeIndex] ?? availableModels[0];

  function openPicker() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => listboxRef.current?.focus());
  }, [open]);

  if (models && models.length === 0) {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        No approved {kind} models yet. Approve one in the{" "}
        <Link href="/models" className="underline">
          Models workspace
        </Link>
        .
      </p>
    );
  }

  function closeAndReturnFocus() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(model: ApprovedPickerModel) {
    onSelect(model);
    closeAndReturnFocus();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!availableModels.length) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!availableModels.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % availableModels.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + availableModels.length) % availableModels.length);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(availableModels[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndReturnFocus();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeAndReturnFocus();
    }
  }

  return (
    <div className="nodrag relative flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${kind === "image" ? "Image" : "Video"} model picker`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openPicker();
        }}
        onKeyDown={handleTriggerKeyDown}
        disabled={!models}
        className={`${INPUT_CLASSES} flex min-h-9 w-full items-center justify-between gap-2 p-1.5 text-left disabled:opacity-60`}
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-[var(--studio-ink)]">
            {selectedModel?.name ?? "Choose model"}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {selectedModel
              ? `${modelCategoryLabel(selectedModel.category)} · ${deriveFamily(selectedModel.endpointId)}`
              : models
                ? "Approved models only"
                : "Loading approved models"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={`${kind === "image" ? "Image" : "Video"} model options`}
          aria-activedescendant={activeModel ? `${listboxId}-${activeModel.endpointId}` : undefined}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className="absolute z-20 mt-1 max-h-72 w-[22rem] overflow-y-auto rounded-lg border border-[var(--studio-border)] bg-[var(--studio-card)] p-1 shadow-xl"
        >
          {availableModels.map((model, index) => {
            const selected = model.endpointId === selectedModel?.endpointId;
            const active = index === activeIndex;
            const price = formatUnitPrice(model.pricing);
            return (
              <button
                id={`${listboxId}-${model.endpointId}`}
                key={model.endpointId}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(model)}
                className={`flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors ${
                  active ? "bg-[var(--studio-control-hover)]" : "hover:bg-[var(--studio-control-hover)]"
                }`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--studio-border)] bg-muted">
                  {model.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={model.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {model.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--studio-ink)]">
                    {model.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {modelCategoryLabel(model.category)} · {deriveFamily(model.endpointId)}
                    {price ? ` · ${price}` : ""}
                  </span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
