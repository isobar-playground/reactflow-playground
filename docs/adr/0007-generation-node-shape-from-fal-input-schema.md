# A Generation Node's shape is driven by the selected Model's FAL input schema

## Context

Until now (issues #10/#11) a Generation Node had **fixed, hand-declared input handles** (`connection-rules.ts`) and a **Mode derived from which inputs were connected** — CONTEXT.md's "Modes are derived from which inputs are connected, never chosen by hand." ADR-0006 deliberately did **not** fetch FAL's per-model input schema, noting it's only available via `expand=openapi-3.0`, "which this step doesn't need."

We now want a **Model selected per Generation Node to define which inputs it accepts**. Inspecting FAL's real schemas kills the idea that a model's coarse `category` implies its inputs: within a single category models vary wildly. `fal-ai/nano-banana-2/edit` (image-to-image) takes `image_urls` (array) **plus** `video_url`, `audio_url`, `pdf_url`; `openai/gpt-image-2/edit` takes `image_urls` + `mask_url`; `fal-ai/kling-video/v3/pro/image-to-video` takes `start_image_url` + `end_image_url`. A category→handles mapping would misrepresent nearly every model.

Crucially, FAL provides **no machine flag** marking a property as a connectable reference — the input schema is a flat bag of all parameters (`prompt`, `cfg_scale`, `seed`, `duration`, `start_image_url`, …) with no `format: uri` or equivalent.

## Decision

- A Generation Node has **no input handles until a Model is selected**. The selected Model's FAL input schema (`expand=openapi-3.0`) defines the node's **Input Handles**: each media/text input becomes one typed handle (image / video / text), **labelled by the schema field name**, accepting *many* if the field is an array else *one*. This **reverses** the derived-Mode rule and the fixed per-node-type handle lists.
- Which properties become handles is a **heuristic** over the schema — field name suffix `_url`/`_urls` plus a description like "URL of the image/video" — because FAL doesn't label connectable fields. Scalar parameters (guidance, steps, seed, duration, `num_images`, …) are **not** surfaced. Media types the app doesn't model (audio, pdf) get **no** handle. The one exception, `negative_prompt`, is shown as an editable **config field** beneath the prompt, not a handle.
- The **node type constrains output modality only**: an Image Generation Node offers the image-output categories (text-to-image, image-to-image), a Video Generation Node the video-output ones. **Text stays the node's existing prompt mechanism** (local textarea + `text` handle + Resolved Prompt), mapped to the Model's primary prompt parameter — it is *not* multiplied into one handle per text field.
- This reverses only ADR-0006's "the schema isn't needed." The **catalog listing stays live and un-snapshotted** (ADR-0006 still holds for the catalog itself); how the *chosen model's* handle set is stored is ADR-0008.

## Why

FAL owns each model's real input contract, so deriving handles from the actual schema is the only way "the Model defines its inputs" is truthful — a category-level mapping would be a fiction for most models. The heuristic is unavoidable (FAL exposes no connectable-field marker) and is accepted as a POC-grade approximation. Keeping text as the existing single prompt mechanism preserves the Resolved Prompt concept unchanged instead of splintering it across `prompt`/`negative_prompt`/etc.

## Consequences

- `connection-rules.ts`'s static `TARGET_HANDLES` and the video-exclusivity rule are largely **superseded** by per-node handles; validity becomes simply "does this Model-declared handle accept this source's data type." **`video → image` edges become possible** where a model exposes a video input (e.g. `nano-banana-2/edit`) — previously hard-blocked as "no video→image."
- `handle-spawn.ts` can no longer read a Generation Node's handles statically. A Generation Node is offered as a spawn target for any media/text drag, and the edge is confirmed only **after** Model selection (see CONTEXT.md's Handle-Spawned Node).
- The heuristic will misclassify unusual schemas — nested objects like `elements`/`multi_prompt` are skipped, and an oddly-named media field may be missed. Accepted for now.
- Rendering a node's handles requires its Model's schema; how that is persisted so a saved canvas renders without a live FAL fetch is decided in ADR-0008.
- Rejected alternatives: a coarse `category → handles` mapping (a fiction, per Context); an app-owned per-model input config set on `/models` (new owned state ADR-0006 explicitly avoids, and manual upkeep for data FAL already publishes).
