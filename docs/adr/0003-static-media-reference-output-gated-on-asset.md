# Static Media Reference has no connectable output until an asset is chosen

## Context

Adding Handle-Spawned Nodes (drag from a handle, drop on empty canvas to create and auto-connect a new node) surfaced a gap: a Static Media Reference's output data type (image or video) is only known once an asset is chosen (`data.asset`), but `connection-rules.ts` already rejects any connection attempt while `sourceDataType` is `null`. Rendering an always-present output `Handle` regardless of `data.asset` offers a connection affordance the graph will refuse, and gives the new handle-icon UI no data type to show.

## Decision

The output `Handle` on `StaticMediaReferenceNode` only renders once `data.asset` is set. Before that, the node has no connectable output at all — it isn't a Reference yet, in the sense of having no data to provide. When a Handle-Spawned Node creates a Static Media Reference to satisfy an image- or video-only input handle, its Asset Picker opens immediately with a type hint restricting the choice to that one media type; the auto-connected edge is created only after an asset is picked. Cancelling the picker leaves the node on the canvas with no asset and no edge, same as one added from the right-click menu.

## Why

This keeps the UI honest about what `connection-rules.ts` already enforces, instead of teaching the picker/edge-creation flow a special case that ignores validation and could leave a stale, type-mismatched edge. Rejected alternative: create the edge immediately and validate/prune it after the asset is chosen — works, but adds tracking state (which handle the pending edge targets) for a problem that disappears entirely if the output simply doesn't exist yet.
