# React Flow Playground

A sandbox for stress-testing the "Canvas approach" to asset generation — a node/edge graph (built on React Flow) where references and generation steps are wired together. Generation is real: a Generation Node runs its selected Model on FAL, and every run has a price (see Estimated Price and Actual Cost).

## Language

**Canvas approach**:
A way of composing asset generation as a graph of connected nodes and edges, where outputs of one step flow into the inputs of the next.

**Reference**:
A node that only provides data and never consumes it — it has an output but no input. Comes in two kinds: a Static Media Reference and a Static Text Reference.
_Avoid_: Source node, input node

**Asset Library**:
A single shared collection of uploaded files, from which a Static Media Reference picks its asset. There is no per-user scoping — everyone sees and uploads to the same library. Backed by one of several interchangeable storage backends chosen automatically per environment (see ADR-0005); the concept itself doesn't name a specific one.
_Avoid_: Media library, gallery, uploads

**Static Media Reference**:
A Reference that holds a single asset (image or video) chosen from the Asset Library. The media type is inferred from the file. No prompt, no generation. Unlike a Static Text Reference, its output data type is not fixed — it is unknown until an asset is chosen. Until then it has no connectable output at all (it isn't a Reference yet, in the sense of having data to provide); its Asset Picker can be given a **type hint** (see Handle-Spawned Node) to restrict the choice to one media type.
_Avoid_: Static Image Reference, Static Video Reference

**Static Text Reference**:
A Reference that holds user-entered text, which other nodes can consume (e.g. as part of a prompt).

**Generation Node**:
A node that selects a Model, takes one or more inputs (References or other Generation Nodes), holds a prompt, and produces an output asset by running its selected Model on FAL when "Generate" is triggered — without a Model selected there is nothing to run, so Generate is unavailable. For an Image Generation Node that Generate is only the **first** run: once an output exists, every further run is an **Edit** of that output (see Edit), not another generation. Comes in two kinds: an Image Generation Node and a Video Generation Node. Until a Model is selected it has no input handles; the selected Model's input schema defines them (see Model and Connection rules). If the selected Model's schema has a `negative_prompt`, the Node Details Drawer shows it as an optional **config field**, not an Input Handle, and not part of the Resolved Prompt. Other scalar parameters (guidance, steps, seed, …) are not surfaced.
_Avoid_: Generator, asset node

**Image Generation Node**:
A Generation Node whose output is an image. Its first run generates from its inputs — text-to-image by default, or image-to-image when its selected Model is one (e.g. a composition combining several image inputs, per Connection rules). Once it has an output, every further run is an **Edit** (see Edit) of that output; the base is generated once and is never re-rolled in place. _(This Edit lifecycle is defined for images only; whether a Video Generation Node gains an equivalent is not yet decided.)_

**Video Generation Node**:
A Generation Node whose output is a video.

**Resolved Prompt**:
The final prompt a Generation Node uses: the text of all connected Static Text References (in edge order) concatenated with the node's own local prompt field.

**History**:
A single Generation Node's **linear chain** of outputs, shown as a carousel inside the node once there is more than one completed output or a Pending Output alongside an existing output. The first entry is the base generation; for an Image Generation Node **each later entry is an Edit of the previous entry's output** (see Edit) — so History is a dependent chain, not a set of independent re-rolls. One entry is the Active Output. Each entry records the local prompt and Actual Cost of the run that produced it. History never branches: exploring an alternative — a Variant, or an Edit taken from an entry that is not the newest — spawns a sibling node instead of a second branch here (see Variant / Clone).
_Avoid_: Variants, gallery, tree

**Active Output**:
The currently-selected History entry of a Generation Node. It is what downstream nodes consume when this node is used as a reference, and — when it is the newest entry — the base image the node's next Edit operates on. The node's own Output Preview may temporarily hide it while a Pending Output is being generated.

**Edit**:
A run of an Image Generation Node *after* its first output exists. It takes the node's own previous Active Output as the base image — an implicit self-input, **not** a new Input Handle — plus the node's local prompt as the instruction, and runs the node's Edit Model, appending a new entry to History. The node's external inputs (References or upstream nodes) feed only the first generation; they are **not** re-fed on an Edit, because the base image already carries them. Editing from the newest entry extends the chain in place; a Variant, or an Edit taken from an older entry, branches to a sibling node instead (see Variant / Clone). Distinct from composition — combining several inputs into a new image is a *separate downstream Generation Node*, not an Edit.
_Avoid_: Regenerate, refine, variant

**Output Preview**:
The visual area of a Generation Node that shows either a completed output or a pending-generation state. During a re-run (a new generation or Edit) it may show only the Pending Output's activity state, while the Active Output remains unchanged for downstream consumers. The same concept applies to Image Generation Nodes and Video Generation Nodes.

**Pending Output**:
A generation run that has been accepted but has not produced its output yet, shown as an activity state in the Output Preview and, when there is existing History, as a placeholder next to it. It starts after the run is accepted, not merely after the user requests generation; it becomes a History entry only after it completes successfully, and disappears if the run fails. During a re-run, the current Active Output remains unchanged for downstream consumers.
_Avoid_: Variant, draft History entry

**Node Details Drawer**:
A canvas-level panel outside the node that shows detailed information about the selected Generation Node, such as status, Resolved Prompt, Model details, errors, and full History. It does not replace the node's working controls for choosing a Model, entering prompts, setting variant count, generating, and previewing outputs.
_Avoid_: Advanced settings, inline drawer, node-level drawer

**Variant / Clone**:
When a Generation Node's variant count is set above one and a run is triggered, the count is the total number of variants — the node itself is one of them, so (count - 1) new sibling nodes are cloned beside it. Every variant runs its own run: the original runs exactly as normal (its new output appends to its existing History and becomes the Active Output), and each clone runs the same thing and then continues its own independent History. On a **first generation** each clone starts from empty History (there is nothing yet to inherit). On an **Edit** each clone inherits the original's History **up to the branch point** and then diverges — this is how branching stays on the canvas as sibling nodes instead of turning a node's History into a tree (see History, Edit). Each clone inherits the incoming reference edges of the original, and owns its own run (ADR-0011).
_Avoid_: Copy, duplicate, branch

**Handle-Spawned Node**:
A node created by dragging from an existing node's handle and dropping on empty canvas, rather than from the right-click menu. The picker offered is filtered to only the node types that could form a valid connection at that handle (per Connection rules), and the new node is auto-connected to the handle it was dragged from. Two node types can't auto-connect at spawn and defer the edge to a later choice:
- A **Static Media Reference** has no output until an asset is chosen (ADR-0003), so picking it opens its Asset Picker immediately with a type hint restricting the choice to the dragged handle's data type; the edge is created only once an asset is picked.
- A **Generation Node** has no input handles until a Model is selected, so picking it creates the node and offers its Model picker — all Models of that node's output category, *not* pre-filtered by the dragged data type. The edge is created only once a Model is selected, and only if the resolved handles include one compatible with the dragged type, attached to the first such handle in schema order. Picking a Model with no compatible handle drops the pending edge. Re-selecting a Model later drops any existing input edges whose handle the new Model doesn't expose (silently, per ADR-0004's no-confirmation ethos).

Cancelling either picker leaves the node on the canvas, unconnected.
_Avoid_: Quick-add node, drag-to-create

**Model**:
A FAL inference endpoint a Generation Node calls, identified by its `endpoint_id` (e.g. `fal-ai/flux/dev`). Selecting a Model is what gives a Generation Node its shape: the Model's FAL input schema defines the node's connectable **input handles** (see Connection rules), and the Model's output determines the node's output type. Its `category` — one of text-to-image, image-to-image, text-to-video, image-to-video, video-to-video — groups Models by output modality for selection: an Image Generation Node offers only the image-output categories (text-to-image, image-to-image), a Video Generation Node only the video-output ones (text-to-video, image-to-video, video-to-video). The category is shown as the node's label; it is a property of the chosen Model, **not** derived from which inputs are connected. A Generation Node's selected Model is its **base Model** — the one it runs for its first output; subsequent Edits run a separate Edit Model (see Edit Model), so a text-to-image base Model must have a paired Edit Model to be selectable. Only these five categories are surfaced; FAL's other categories (llm, speech-to-text, training, …) have no node to use them and are not shown.
_Avoid_: Endpoint (in UI), algorithm

**Edit Model**:
The image-to-image Model an Edit runs. It is **not** chosen per node: the app owns a **pairing** from each text-to-image Model to its Edit Model, curated in the Models tab (an extension of the Approved Model state — see Approved Model, ADR-0014). A node whose base Model is text-to-image edits with that Model's paired Edit Model; a node whose base Model is *already* image-to-image edits with that same Model. A text-to-image Model with no paired Edit Model cannot be selected as a base (it could generate but never edit), so it is not offered in the Model picker. Many text-to-image Models may map to one Edit Model.
_Avoid_: Edit endpoint, refiner

**Input Handle**:
A typed connection point where a reference feeds into a Generation Node. A node's input handles are not fixed per node type — they are derived from the selected Model's FAL input schema: each media or text input in the schema becomes one input handle, labelled with the schema field name (e.g. `image_urls`, `start_image_url`, `prompt`), typed image / video / text, accepting *many* if the field is an array else *one*. Scalar generation parameters (guidance, steps, duration, seed, …) are not input handles. Inputs of media types the app doesn't model (audio, pdf) get no handle.
_Avoid_: input reference, input port, slot

**Estimated Price**:
The approximate amount a Generation Node shows before its next run: the **next run's** Model unit price (the base Model before the first output exists, the Edit Model once it does) × the estimated billable units for one run, × the variant count. Unit estimation is deliberately naive — 1 unit for per-image, per-megapixel and per-unit pricing, the schema's default duration for per-second pricing. It is an estimate, never a quote, and never what gets recorded — that is the Actual Cost.
_Avoid_: Cost (that's the actual one), quote

**Actual Cost**:
What one generation really cost, as billed by FAL: the billable units FAL reports for the finished run × the Model's unit price. It belongs to the completed output that generation produced, not to the Generation Node as a whole; a canvas also shows the running sum of all its nodes' Actual Costs.
_Avoid_: Price (that's the estimate), spend

**Model Catalog**:
The set of Models the app can show. Sourced live from FAL rather than stored by the app, and joined against the app's approvals and (best-effort) Unit Prices for display.
_Avoid_: Model list, registry

**Family**:
A grouping of Models that share a model line or brand — Kling, LTX, Nano Banana, Veo, Flux, Wan, and so on. A display-and-filter concept, not something FAL gives us: it is **derived from the `endpoint_id`** (the provider-stripped leading token, cut before the first version/digit) and then run through a small app-owned alias map that merges the variants FAL scatters (`ltx`, `ltx-video`, `ltxv` all become LTX; `kling-video`, `kling-image` become Kling). Deliberately **not** FAL's `group` metadata, which is version-fragmented and absent on many Models (see ADR-0010). The Family filter on the catalog only surfaces families with two or more loaded Models; the long tail of single-Model tokens has no explicit family and is reachable by text search only.
_Avoid_: Group, provider, series, brand

**Unit Price**:
A Model's raw per-unit price as billed by FAL — a number plus its unit, one of images / megapixels / seconds (e.g. `$0.14 / second`). Shown on the catalog card as-is, so prices are comparable within a unit but not across units. Distinct from **Estimated Price** (a per-run projection on a Generation Node) and **Actual Cost** (what a finished run was billed): the Unit Price is the shared input both of those are computed from. Fetched best-effort in batches and cached with the catalog; a Model whose price doesn't resolve simply shows no price (see ADR-0010).
_Avoid_: Price (that's the estimate), cost (that's the actual)

**Approved Model**:
A Model the app has marked as available for selection on the canvas — app-owned Model state (a set of `endpoint_id`s; shared, with no per-user scoping, like the Asset Library). Alongside the approval set the app also owns the text-to-image → Edit Model pairing (see Edit Model, ADR-0014); together these are the only Model state the app owns. Deliberately distinct from FAL's own `status: active` (FAL's lifecycle) and `is_favorited` (a per-FAL-account favourite).
_Avoid_: Active model, Enabled model, Favorite

## Connection rules

A directed edge means "the source's output feeds a specific input handle of the target".

- References have an output handle only — nothing can connect *into* a Reference.
- Generation Nodes have an output handle and, once a Model is selected, the **Input Handles** derived from that Model's FAL input schema. Outputs may chain into further Generation Nodes.
- Connections are validated by the data type accepted at each handle; disallowed edges are rejected at connect time. A node feeding a downstream consumer provides its Active Output.
- A Static Media Reference has no connectable output until an asset is chosen — its data type isn't known before then (ADR-0003).

**A Generation Node's Input Handles come from its selected Model, not from a fixed per-node-type list.** Which handles exist, their labels, their data types, and whether each takes one or many are all read from the Model's FAL input schema (see Input Handle). Before a Model is selected the node has no input handles at all. Because handles follow the actual Model, the node type only constrains **output** modality, not inputs — so an image-output Model that happens to accept a video input (they exist on FAL) gives an Image Generation Node a video Input Handle, and a Video → Image edge into that handle is allowed. There is no built-in mode-derived or video-exclusivity rule; validity is purely the data type each Model-declared handle accepts.
