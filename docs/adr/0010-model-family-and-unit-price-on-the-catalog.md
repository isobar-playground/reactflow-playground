# Model Family and Unit Price on the catalog page

## Context

The `/models` catalog (ADR-0006) reads ~1000+ Models live from FAL and joins them against our approvals. Two additions were requested: show each Model's **price**, and let the catalog be filtered by **Family** (the model line — Kling, LTX, Nano Banana, …).

Neither maps cleanly onto what FAL gives us, so both needed a decision rather than a wiring job:

- **Family has no FAL field.** The obvious candidate, `metadata.group.key`, is version-fragmented (Kling alone spreads across ~15 keys — `kling-o3`, `kling-v3`, `kling-video-v1-6`, `Kling-Avatar`, …) and is absent on ~200 of the surfaced Models. It groups by version, not by line.
- **Pricing is per-endpoint and rate-limited.** `GET /v1/models/pricing` has no bulk/list mode; it accepts repeated `endpoint_id` params but caps at roughly 30–50 per call (100 → HTTP 400), and the limiter is aggressive — 20-way parallel single calls returned 429 for 41 of 50. Prices come in mixed units (images / megapixels / seconds).

## Decision

- **Family is derived from the `endpoint_id`, not from FAL's `group`.** Take the provider-stripped leading path token, cut it before the first version/digit run, then pass it through a small app-owned **alias map** that merges the variants FAL scatters (`ltx` / `ltx-video` / `ltxv` → LTX; `kling-video` / `kling-image` / `kling` → Kling; `nano-banana*` → Nano Banana; etc.). Unmapped tokens keep their derived name. Derivation is a pure module (like `model-filter.ts`) so it is unit-testable.
- **The Family filter surfaces only families with ≥2 loaded Models.** Pure auto-derivation produces ~251 tokens including ~113 single-Model singletons; those collapse into no explicit family and remain reachable by the existing text search. Only real, multi-Model families appear in the dropdown.
- **Each card shows the raw FAL Unit Price verbatim** — `$0.14 / second`, `$0.025 / megapixel`, `$0.04 / image`. No per-run estimate on this page (that is a Generation Node's Estimated Price, which needs variant count and schema duration this page doesn't have). Prices are comparable within a unit, not across units; no price-based sort.
- **Prices are joined best-effort in throttled batches, cached ~1h with the catalog.** Fetch via repeated `endpoint_id` params in chunks of ~30, sequential and throttled to survive the limiter. A Model whose price doesn't resolve (429, absent, outage) simply shows no price. A total pricing failure still renders the full catalog with families and approvals — price is additive, never a gate (mirrors ADR-0006's FAL-unreachable stance).

## Why

FAL's `group` looks like the answer and isn't — a future reader will reach for it, so recording that we rejected it (with the fragmentation and the ~200 missing) stops that. Deriving from `endpoint_id` plus a thin alias map keeps the maintained surface tiny (a handful of merge rules) while covering every Model automatically, and the ≥2 threshold keeps the filter usable instead of a 251-line list. Showing the raw Unit Price avoids inventing a misleading single number from mixed units on a page that lacks the per-node context the real estimate needs. Batching + 1h cache is the only shape the rate limiter allows; best-effort partial results keep one 429 from wiping the whole page.

## Consequences

- The alias map is a maintained artifact: when FAL adds a new model line that fragments (or a new spelling of an existing one), the merge rules need a hand-edit, otherwise the line shows up as several small families or as untitled derived tokens. This is deliberate — the alternative (parsing 217+ heterogeneous group keys) is worse.
- Family is derived, never stored. If FAL renames endpoints, a Model's family can shift silently; acceptable, since nothing keys off it beyond display/filter.
- Cold catalog load now also pays ~1 minute of throttled pricing fetches once per cache window; warm loads are unaffected. Only successfully-fetched prices are cached, so transient 429s self-heal on the next fetch rather than being memoised as "no price".
- Rejected alternatives: FAL `group.key` as family (version-fragmented, ~200 absent); a fully curated family list (more maintenance than the derive-plus-alias hybrid, and blind to new models until edited); naive per-run Estimated Price on the card (misleading without variant/duration context); parallel un-throttled price fetches (429 storm); all-or-nothing pricing (one failure wipes all prices).
