"use client";

import type { Model } from "@/lib/fal-models";

// The `/models` page (issue #25): browses the Model Catalog fetched live from
// FAL (ADR-0006), read-only for this slice. Approve/un-approve controls
// (#26) and search/filters (#27) are later slices — this component is kept
// structured so those slot in above the list and onto each card without a
// rewrite.
export function ModelsBrowser({ models }: { models: Model[] }) {
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No models to show.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {models.map((model) => (
        <ModelCard key={model.endpointId} model={model} />
      ))}
    </ul>
  );
}

function ModelCard({ model }: { model: Model }) {
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
    </li>
  );
}
