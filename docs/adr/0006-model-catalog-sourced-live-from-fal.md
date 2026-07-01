# Model Catalog is sourced live from FAL; the app persists only approvals

## Context

The app is moving from a pure playground toward real asset generation. The first step is a model-configuration page (route `/models`, behind the same `PLAYGROUND_PASSWORD` gate as the rest of the app) where a Model can be marked as an Approved Model — available for selection on the canvas. This step is catalog + approval management only: the canvas is untouched and nothing calls FAL to generate.

FAL exposes its full model catalog at `GET /v1/models` — paginated (`cursor`/`has_more`), with `endpoint_id` and a `metadata.category` per model, plus `q` (free-text), `category`, and `status` query filters. Auth is optional and only raises rate limits. There is no single "list every model" alternative we control, and no stable input-schema in the listing (only via `expand=openapi-3.0`, which this step doesn't need).

The repo already persists canvases in Postgres, so the default expectation would be a `models` table too. The question is what — if anything — of the catalog we own.

## Decision

- The **Model Catalog is read live from FAL** and never snapshotted into our database. A cached server fetch (~1h TTL) walks the cursor once per surfaced category and assembles the list; the page joins it against our approvals.
- The **only Model state the app owns is the set of approvals**: a table `approved_models(endpoint_id text primary key, approved_at timestamptz default now())`. Approve = insert, unapprove = delete. Shared, no per-user scoping (like the Asset Library).
- Only the **five categories that map 1:1 onto a generation Mode** (text-to-image, image-to-image, text-to-video, image-to-video, video-to-video) are fetched and surfaced; FAL's other categories (llm, speech-to-text, training, …) have no node to use them. Only `status=active` models are fetched.
- **"Approved" is deliberately our own flag**, distinct from FAL's `metadata.status: "active"` (FAL's lifecycle) and `is_favorited` (a per-FAL-account favourite).
- `FAL_KEY` is optional; sent as `Authorization: Key <FAL_KEY>` when present to raise rate limits, and the listing works without it.

## Why

FAL owns which models exist and their metadata; mirroring that into our DB would mean maintaining a sync cycle and reasoning about staleness for data we don't author. Reading live keeps FAL the single source of truth for the catalog and shrinks our owned state to the one thing that is genuinely ours — the approval set. A ~1h cache avoids hammering FAL (5 paginated walks) on every visit to a rarely-opened settings page, without the machinery of a snapshot. Surfacing only the five Mode-mapped categories keeps approval meaningful: approving a model no node can run would be a dead, confusing state.

## Consequences

- The page cannot render its catalog while FAL is unreachable; approvals still exist in our DB, but there is nothing to join them against until FAL responds. (Error/empty state is a UI concern, not persisted data.)
- Approvals are stored by `endpoint_id` only. If FAL renames or removes an endpoint, or an approved model later becomes `deprecated`, the stored approval dangles — it simply won't appear in the (active-only) catalog join. This is acceptable now and will need revisiting when the canvas actually resolves an approved model to a generation call.
- Rejected alternatives: a curated seed list in the repo (drifts from FAL, and FAL already exposes the catalog); a DB snapshot with an explicit sync (C — sync machinery and staleness for data we don't own); fetching on every page load without caching (A — needless repeated pagination against FAL).
