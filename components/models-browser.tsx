"use client";

import { useState, useTransition } from "react";
import { approveModelAction, unapproveModelAction } from "@/app/models-actions";
import type { Model } from "@/lib/fal-models";

// The `/models` page: browses the Model Catalog fetched live from FAL
// (ADR-0006) and joins it against the app's approvals. Each Model carries an
// Approved checkbox (#26) wired to the server actions; toggling it persists.
// Search/filters (#27) are a later slice — this component is kept structured so
// those slot in above the list without a rewrite.
export function ModelsBrowser({
  models,
  approvedIds = [],
}: {
  models: Model[];
  approvedIds?: string[];
}) {
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No models to show.
      </p>
    );
  }

  const approvedSet = new Set(approvedIds);

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {models.map((model) => (
        <ModelCard
          key={model.endpointId}
          model={model}
          approved={approvedSet.has(model.endpointId)}
        />
      ))}
    </ul>
  );
}

function ModelCard({ model, approved }: { model: Model; approved: boolean }) {
  // Optimistic toggle: flip locally at once, then persist via the action
  // (mirrors asset-library-browser's useTransition). revalidatePath in the
  // action reconciles the server-rendered state on the next paint.
  const [checked, setChecked] = useState(approved);
  const [isPending, startTransition] = useTransition();

  function handleToggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      if (next) {
        await approveModelAction(model.endpointId);
      } else {
        await unapproveModelAction(model.endpointId);
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      {model.thumbnailUrl ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={model.thumbnailUrl}
            alt={model.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{model.name}</span>
        <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {model.category}
        </span>
        {model.description ? (
          <p className="text-sm text-muted-foreground">{model.description}</p>
        ) : null}
      </div>
      <label className="mt-1 flex w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={isPending}
          onChange={(event) => handleToggle(event.target.checked)}
        />
        Approved
      </label>
    </li>
  );
}
