# Editing is an in-node linear chain; branches spawn sibling nodes

## Context

Until now every Generation Node run re-ran the same Model from the node's inputs, and History was a set of **independent re-rolls** — entry N's input was never entry N-1's output. UX wants a different lifecycle: the **first** run generates from the node's inputs, and **every subsequent user action is an Edit** of the produced image (like `nano-banana-2/edit`: base image + instruction → modified image).

Two structural choices had to be made:

1. **Where an edit lives.** (A) each edit is a new downstream image-to-image node, or (B) edits accumulate inside the same node.
2. **If in-node, the shape of History.** A linear line (branches become sibling nodes) or a tree (branches live inside the node).

Multi-input composition (e.g. a car image + a person image → "person in the car") is a genuinely different operation and stays a separate downstream Generation Node — it is not an Edit.

## Decision

**(B) + linear.** An Image Generation Node's first run generates from its inputs; **every later run is an Edit** that takes the node's own previous Active Output as base image plus the local prompt as instruction, appending a new entry to a **linear** History via the node's Edit Model (ADR-0014). External inputs (References, upstream nodes) feed only the first generation and are **not** re-fed on an Edit — the base image already carries them.

Branching stays on the canvas, not in the node: a **Variant**, or an **Edit taken from a non-newest entry**, spawns sibling node(s) that inherit the original's History **up to the branch point** and then diverge. This generalizes `variant-clone` from "clone starts with empty History" to "clone inherits History up to the branch point" (empty is just the first-generation case, where there is nothing to inherit yet). ADR-0011's run-ownership rule is unchanged: each clone still owns its own run.

The base image is an **implicit self-input, not an Input Handle**, so entering edit mode does not change the node's snapshotted handle set (ADR-0008). Video Generation Nodes are out of scope for now.

## Why

Keeping one node = one **linear lineage** lets History render as the existing simple carousel and lets the **canvas** carry branching — which is exactly what the Canvas approach is for. Rejected (A) edit-as-downstream-node: UX wants iteration to stay inside the tile, not scatter every "make it night" across the graph. Rejected the tree-in-node: it needs branch-navigation UI inside the tile for little gain, when the canvas already represents branches as nodes.

## Consequences

- History becomes a **dependent chain**; the "independent re-rolls" reading is gone (CONTEXT.md's History, Active Output, Edit, Variant / Clone updated). Downstream consumers still read the Active Output.
- **No in-place re-roll of the base.** To get a different base, use a first-generation Variant (siblings) or a new node — "every subsequent action is an Edit" is taken literally.
- `variant-clone` must carry History up to the branch point (was empty); each clone still owns its run (ADR-0011).
- The base image being an implicit self-input keeps the ADR-0008 handle snapshot untouched when a node starts editing.
- An Edit needs an Edit Model — how a node gets one is ADR-0014.
- Video parity is deferred; the lifecycle is defined for images only.
