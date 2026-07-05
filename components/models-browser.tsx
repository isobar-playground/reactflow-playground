"use client";

import { useMemo, useState, useTransition } from "react";
import { approveModelAction, unapproveModelAction } from "@/app/models-actions";
import {
  SURFACED_CATEGORIES,
  type Model,
  type ModelCategory,
} from "@/lib/fal-models";
import {
  filterModels,
  type ApprovalFilter,
  type SortOrder,
} from "@/lib/model-filter";
import { familyOptions } from "@/lib/model-family";

// The `/models` page: browses the Model Catalog fetched live from FAL
// (ADR-0006) and joins it against the app's approvals. Each Model carries an
// Approved checkbox (#26) wired to the server actions; toggling it persists.
//
// Search + filters (#27) live entirely client-side over the already-loaded
// catalog: the visible list is derived from the full `models` prop via the
// pure `filterModels`, so typing/filtering updates instantly with no re-fetch.
export function ModelsBrowser({
  models,
  approvedIds = [],
}: {
  models: Model[];
  approvedIds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ModelCategory | "all">("all");
  const [family, setFamily] = useState<string>("all");
  const [approval, setApproval] = useState<ApprovalFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");

  const approvedSet = useMemo(() => new Set(approvedIds), [approvedIds]);

  // Families to offer in the dropdown (>= 2 loaded Models — ADR-0010); a
  // singleton token has no dropdown option but stays reachable via the
  // existing text search.
  const families = useMemo(() => familyOptions(models), [models]);

  const visible = useMemo(
    () =>
      filterModels(models, { query, category, family, approval, approvedIds, sort }),
    [models, query, category, family, approval, approvedIds, sort],
  );

  // The catalog itself being empty (FAL returned nothing) is distinct from a
  // search/filter matching nothing — both show a message, but only the latter
  // keeps the controls on screen so the user can widen their query.
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No models to show.</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          role="searchbox"
          aria-label="Search models"
          placeholder="Search by name, description, tag, or provider…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Category</span>
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as ModelCategory | "all")
            }
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="all">All categories</option>
            {SURFACED_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Family</span>
          <select
            aria-label="Filter by family"
            value={family}
            onChange={(event) => setFamily(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="all">All families</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Approval</span>
          <select
            aria-label="Filter by approval"
            value={approval}
            onChange={(event) =>
              setApproval(event.target.value as ApprovalFilter)
            }
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="not-approved">Not approved</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort</span>
          <select
            aria-label="Sort models"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOrder)}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No models match your search or filters.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((model) => (
            <ModelCard
              key={model.endpointId}
              model={model}
              approved={approvedSet.has(model.endpointId)}
            />
          ))}
        </ul>
      )}
    </div>
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
