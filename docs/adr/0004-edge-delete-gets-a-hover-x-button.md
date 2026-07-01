# Edge deletion gets a hover-X button, reversing issue #17's scope decision

## Context

Issue #17 scoped edge deletion to click-to-select + Backspace/Delete only, explicitly ruling out a hover-X button as out of scope — reasoned as already-working default `@xyflow/react` behavior needing no new UI. In practice that path isn't discoverable: nothing on the canvas hints that an edge can be removed at all, let alone how. Node deletion has since gained a visible affordance (the header "⋮" menu's Delete item, added alongside Duplicate), making the edge's keyboard-only path feel inconsistent by comparison.

## Decision

Every edge gets a small "×" button that appears on hover at the edge's midpoint (a custom edge component using `EdgeLabelRenderer`), in addition to — not replacing — the existing click + Backspace/Delete path. Clicking it deletes immediately, no confirmation, matching how node deletion and keyboard edge deletion already behave. This applies uniformly to every edge: there's no per-connection-type edge styling in the app today, so nothing is exempted.

## Why

Backspace/Delete on a selected edge has no visual cue that it's possible, so users don't discover it. A hover-reveal button fixes discoverability without permanently cluttering the canvas the way an always-visible button would on a graph with many edges.

## Consequences

This introduces the app's first custom edge type — today every edge renders via React Flow's default (no `edgeTypes` passed to `<ReactFlow>`). Future per-edge visual changes (e.g. styling by data type) would extend this same component.
