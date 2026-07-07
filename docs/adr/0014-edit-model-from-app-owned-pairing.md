# The Edit Model comes from an app-owned text-to-image → edit pairing

## Context

An Edit (ADR-0013) must run an image-to-image model, but the node's **base Model** may be text-to-image (e.g. `fal-ai/nano-banana-2`, which has no image input). Something has to decide **which** model performs the edit. Options considered:

- **Per-node picker** — the user picks an Edit Model on each node.
- **Family-name auto-map** — derive a same-family `/edit` endpoint from the base's `endpoint_id`.
- **One global default edit model** for the whole app.
- **App-curated pairing** — the app owns an explicit base → edit map.

ADR-0006/0007 deliberately keep model config **live from FAL** and the app-owned model state minimal (just the Approved Model `endpoint_id` set). FAL exposes no "this is the edit variant of that model" relationship.

## Decision

The app owns a curated **pairing** from each text-to-image Model to its **Edit Model** (an image-to-image Model), configured in the Models tab alongside approvals. A node with a text-to-image base edits with its paired Edit Model; a node whose base is **already** image-to-image edits with that same Model (no pairing needed — it is already edit-capable). A text-to-image Model with **no** pairing cannot fulfil the generate-then-edit contract, so it is **not selectable as a base** (filtered out of the Model picker). The map is **many-to-one**: several text-to-image Models may point at the same Edit Model.

## Why

A curated pairing is explicit and correct where the alternatives are not: the family-name heuristic is fragile (many families — Flux, Veo — have no `/edit` endpoint, and it would need an owned alias map anyway), and a single global edit model produces a style mismatch against whatever generated the base. It is a **deliberate, bounded** extension of the Approved Model owned-state — one extra edge per approved text-to-image endpoint — not a return to owning full model config. A per-node picker makes every node re-answer a question the catalog can answer once.

## Consequences

- Approved Model state grows from a set of `endpoint_id`s to that set **plus** a pairing map; CONTEXT.md's "the only Model state the app owns" is updated to include it.
- Approving a text-to-image Model now implies **also pairing** it before it is usable as a base; the Models tab must surface and enforce this.
- A deliberate step away from ADR-0006's live-from-FAL, for the one relationship FAL doesn't express.
- If a paired Edit Model is later unapproved or removed from FAL, nodes relying on it lose editability until re-paired — accepted, mirroring ADR-0008's staleness stance.
