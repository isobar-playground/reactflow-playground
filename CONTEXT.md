# React Flow Playground

A sandbox for stress-testing the "Canvas approach" to asset generation — a node/edge graph (built on React Flow) where references and generation steps are wired together. The asset-generation logic itself is mocked; the goal is to exercise React Flow's behaviour, not to produce real assets.

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
A node that selects a Model, takes one or more inputs (References or other Generation Nodes), holds a prompt, and produces an output asset when "Generate" is triggered. Comes in two kinds: an Image Generation Node and a Video Generation Node. Until a Model is selected it has no input handles; the selected Model's input schema defines them (see Model and Connection rules). If the selected Model's schema has a `negative_prompt`, the node also shows an optional negative-prompt field beneath the prompt — an editable **config field**, not an Input Handle, and not part of the Resolved Prompt. Other scalar parameters (guidance, steps, seed, …) are not surfaced.
_Avoid_: Generator, asset node

**Image Generation Node**:
A Generation Node whose output is an image.

**Video Generation Node**:
A Generation Node whose output is a video.

**Resolved Prompt**:
The final prompt a Generation Node uses: the text of all connected Static Text References (in edge order) concatenated with the node's own local prompt field.

**History**:
The ordered list of outputs a single Generation Node has produced over time, shown as a carousel inside the node. There is no carousel until a second output exists. One entry is the Active Output.
_Avoid_: Variants, gallery

**Active Output**:
The currently-selected History entry of a Generation Node. It is what the node displays, and what downstream nodes consume when this node is used as a reference.

**Variant / Clone**:
When a Generation Node's variant count is set above one and generation is triggered, the count is the total number of variants — the node itself is one of them, so (count - 1) new sibling nodes are cloned beside it. Each clone inherits the incoming reference edges of the original.
_Avoid_: Copy, duplicate

**Handle-Spawned Node**:
A node created by dragging from an existing node's handle and dropping on empty canvas, rather than from the right-click menu. The picker offered is filtered to only the node types that could form a valid connection at that handle (per Connection rules), and the new node is auto-connected to the handle it was dragged from. Two node types can't auto-connect at spawn and defer the edge to a later choice:
- A **Static Media Reference** has no output until an asset is chosen (ADR-0003), so picking it opens its Asset Picker immediately with a type hint restricting the choice to the dragged handle's data type; the edge is created only once an asset is picked.
- A **Generation Node** has no input handles until a Model is selected, so picking it creates the node and offers its Model picker — all Models of that node's output category, *not* pre-filtered by the dragged data type. The edge is created only once a Model is selected, and only if the resolved handles include one compatible with the dragged type, attached to the first such handle in schema order. Picking a Model with no compatible handle drops the pending edge. Re-selecting a Model later drops any existing input edges whose handle the new Model doesn't expose (silently, per ADR-0004's no-confirmation ethos).

Cancelling either picker leaves the node on the canvas, unconnected.
_Avoid_: Quick-add node, drag-to-create

**Model**:
A FAL inference endpoint a Generation Node calls, identified by its `endpoint_id` (e.g. `fal-ai/flux/dev`). Selecting a Model is what gives a Generation Node its shape: the Model's FAL input schema defines the node's connectable **input handles** (see Connection rules), and the Model's output determines the node's output type. Its `category` — one of text-to-image, image-to-image, text-to-video, image-to-video, video-to-video — groups Models by output modality for selection: an Image Generation Node offers only the image-output categories (text-to-image, image-to-image), a Video Generation Node only the video-output ones (text-to-video, image-to-video, video-to-video). The category is shown as the node's label; it is a property of the chosen Model, **not** derived from which inputs are connected. Only these five categories are surfaced; FAL's other categories (llm, speech-to-text, training, …) have no node to use them and are not shown.
_Avoid_: Endpoint (in UI), algorithm

**Input Handle**:
A typed connection point where a reference feeds into a Generation Node. A node's input handles are not fixed per node type — they are derived from the selected Model's FAL input schema: each media or text input in the schema becomes one input handle, labelled with the schema field name (e.g. `image_urls`, `start_image_url`, `prompt`), typed image / video / text, accepting *many* if the field is an array else *one*. Scalar generation parameters (guidance, steps, duration, seed, …) are not input handles. Inputs of media types the app doesn't model (audio, pdf) get no handle.
_Avoid_: input reference, input port, slot

**Model Catalog**:
The set of Models the app can show. Sourced live from FAL rather than stored by the app, and joined against the app's approvals for display.
_Avoid_: Model list, registry

**Approved Model**:
A Model the app has marked as available for selection on the canvas — the only Model state the app owns (a set of `endpoint_id`s; shared, with no per-user scoping, like the Asset Library). Deliberately distinct from FAL's own `status: active` (FAL's lifecycle) and `is_favorited` (a per-FAL-account favourite).
_Avoid_: Active model, Enabled model, Favorite

## Connection rules

A directed edge means "the source's output feeds a specific input handle of the target".

- References have an output handle only — nothing can connect *into* a Reference.
- Generation Nodes have an output handle and, once a Model is selected, the **Input Handles** derived from that Model's FAL input schema. Outputs may chain into further Generation Nodes.
- Connections are validated by the data type accepted at each handle; disallowed edges are rejected at connect time. A node feeding a downstream consumer provides its Active Output.
- A Static Media Reference has no connectable output until an asset is chosen — its data type isn't known before then (ADR-0003).

**A Generation Node's Input Handles come from its selected Model, not from a fixed per-node-type list.** Which handles exist, their labels, their data types, and whether each takes one or many are all read from the Model's FAL input schema (see Input Handle). Before a Model is selected the node has no input handles at all. Because handles follow the actual Model, the node type only constrains **output** modality, not inputs — so an image-output Model that happens to accept a video input (they exist on FAL) gives an Image Generation Node a video Input Handle, and a Video → Image edge into that handle is allowed. There is no built-in mode-derived or video-exclusivity rule; validity is purely the data type each Model-declared handle accepts.
