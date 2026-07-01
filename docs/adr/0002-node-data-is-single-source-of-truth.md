# React Flow node data is the single source of truth for canvas content

## Context

The node components shadowed their editable content in local `useState` — an Image/Video Generation Node's prompt and History, a Static Media Reference's chosen asset, a Static Text Reference's text — and never wrote it back into React Flow's node `data`. Autosave serialises node `data`, and downstream consumers read upstream content via `useNodesData(...).data`. So the local-only content was invisible to both: reloading a canvas dropped every prompt, generated output, History entry, chosen asset and reference text (only positions, edges and viewport survived), and a connected Static Text Reference contributed nothing to a Generation Node's Resolved Prompt. Unit tests were green throughout; the gaps only showed when the app actually ran (see the `/verify` findings).

## Decision

Node components treat React Flow node `data` as the single source of truth for **persisted canvas content**. Editable content is written through with `updateNodeData(id, …)` and rendered from `data`/props; components do **not** shadow it in local `useState`. Downstream consumers read upstream content via `useNodesData`.

Purely **transient UI state** stays local: the in-progress `isGenerating` flag, the variant-count input, and the picker-open flag are not canvas content and are not persisted.

## Why

`data` is exactly what autosave persists and what `useNodesData` exposes to other nodes, so making it the single source of truth fixes persistence and cross-node reads (the Resolved Prompt) in one move instead of maintaining two copies that silently drift. Local-state shadowing was simpler per component but is precisely what dropped the content. Writing through on change is cheap: the existing ~1.5s autosave debounce coalesces database writes.

## Consequences

- Node components become controlled-from-`data`. A future contributor must resist reaching for `useState` to hold content — that reintroduces the exact bug this records.
- `variant-clone` reads a fresh `data.prompt` from `getNode(id)`, so its manual "merge the local prompt in" step is no longer needed.
- Graph-state features now require **runtime verification** (drive the app and reload), not only unit tests — a unit-green suite is what let these ship broken.
