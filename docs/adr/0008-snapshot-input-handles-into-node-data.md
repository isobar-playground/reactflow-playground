# The resolved Input Handle set is snapshotted into node data, not re-derived live from FAL

## Context

ADR-0007 makes a Generation Node's Input Handles come from the selected Model's FAL input schema. That schema could be read **live from FAL on every canvas load**, or **captured once** when the Model is selected. ADR-0002 makes node `data` the single source of truth for persisted canvas content; ADR-0006 keeps the FAL *catalog* un-snapshotted (read live). Edges bind to specific handles by id, so a node's handle set is content the graph depends on to render and stay valid.

## Decision

When a Model is selected, fetch **that one endpoint's** schema (`expand=openapi-3.0`), derive the Input Handle set, and **snapshot it into the node's `data`**: the `endpoint_id`, the resolved handles (`[{ handleId, dataType, many, label }]`), and a `hasNegativePrompt` flag. Handles render from `data` and are **never re-derived from FAL on load**. The schema is fetched **lazily — only at selection**: the Model picker uses the existing live catalog (`listModels`, no `expand`), and only the chosen model is expanded.

## Why

The handle set is canvas content that edges reference (ADR-0002), so it belongs in `data`. Deriving it from a ~1h-cached external fetch on every load would make saved canvases **non-deterministic** and couple rendering to FAL uptime and to the model still being approved and present. Snapshotting makes a saved node **self-contained**: it renders offline and survives a Model being unapproved or removed from FAL. This is a narrow, deliberate exception to ADR-0006's "don't snapshot FAL" — that rule governs the *catalog list*; here we capture the *shape of one chosen model* as node content, which is a different thing.

## Consequences

- **Staleness**: if FAL later changes a model's inputs, the node keeps its snapshotted handles until the Model is re-selected. Accepted — re-selecting refreshes.
- A stored `endpoint_id` whose model is later unapproved or removed from FAL still renders from the snapshot; with generation mocked, the node stays fully functional. Only re-selecting that same model in the picker would fail, since it's no longer offered.
- Re-selecting a Model recomputes the snapshot and **silently drops** any input edges whose handle the new snapshot lacks (per ADR-0004's no-confirmation ethos).
- Rejected alternative: store only `endpoint_id` and re-derive handles live on every load — always fresh, but fragile (a saved canvas can't render its own nodes when FAL is unreachable or the model is gone) and non-deterministic.
