# Generation runs on FAL's queue API; Actual Cost is computed from the billable-units header

## Context

Generation was mocked (picsum / a bundled mp4). Making it real means calling the selected Model's FAL endpoint with the node's Resolved Prompt, negative prompt, and connected media inputs — and the product wants an Estimated Price before the run and an Actual Cost after it. Probing FAL's live API established the constraints: video generations take minutes (a synchronous `fal.run` call would pin an HTTP request that long and a page reload would orphan a run FAL still bills); FAL's inference responses contain **no cost amount** — only an `x-fal-billable-units` response header on the queue result — while unit prices live in a separate `GET /v1/models/pricing` endpoint (`unit_price` per `megapixels` / `images` / `seconds`); and assets in the local-filesystem Asset Library (ADR-0005) are not URLs FAL can fetch.

## Decision

- **One transport for both node kinds**: submit to `https://queue.fal.run/{endpoint_id}`, persist the returned `request_id` (and the returned `status_url`/`response_url` — they may live under a *parent* app, e.g. `fal-ai/flux/schnell` answers under `fal-ai/flux`, so they are never reconstructed by hand) into the node's `data`, and poll status from the client via a server action every few seconds. Because the pending request lives in `data` (ADR-0002), a reload resumes polling instead of losing a billed run. All FAL calls stay server-side (`FAL_KEY`), via plain `fetch` — no new dependency.
- **Actual Cost** = `x-fal-billable-units` (from the queue result response) × the Model's `unit_price`. The pricing entry is fetched once at Model selection and snapshotted into `data.model` alongside the schema-derived handles (extending ADR-0008). The cost is recorded on the History entry it produced.
- **Estimated Price** = `unit_price` × naively estimated units (1 for `images`/`megapixels`; the schema's default duration for `seconds`) × variant count.
- **Media inputs** from the Asset Library are inlined as base64 data URIs in the payload's URL fields; an upstream Generation Node's output is already a public `fal.media` URL and is passed as-is.
- **The mock is deleted**, not kept as a fallback: without a selected Model, Generate is disabled.

## Consequences

- Actual Cost is *derived*, not authoritative — it can drift from FAL's invoice if a unit price changes between Model selection and generation (re-selecting refreshes the snapshot). Accepted for a playground.
- Data-URI media has a size ceiling; very large video inputs will need an upload to `fal.storage` instead. Deferred until it breaks.
- Rejected: synchronous `fal.run` (fine for images, unusable for minutes-long video, and a mid-run reload silently pays for a lost result); `@fal-ai/client` (its queue/polling convenience duplicates ~30 lines of `fetch` while hiding the response headers the cost computation needs).
