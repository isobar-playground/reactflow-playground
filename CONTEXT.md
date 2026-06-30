# React Flow Playground

A sandbox for stress-testing the "Canvas approach" to asset generation — a node/edge graph (built on React Flow) where references and generation steps are wired together. The asset-generation logic itself is mocked; the goal is to exercise React Flow's behaviour, not to produce real assets.

## Language

**Canvas approach**:
A way of composing asset generation as a graph of connected nodes and edges, where outputs of one step flow into the inputs of the next.

**Reference**:
A node that only provides data and never consumes it — it has an output but no input. Comes in two kinds: a Static Media Reference and a Static Text Reference.
_Avoid_: Source node, input node

**Asset Library**:
A single shared collection of uploaded files (stored in Vercel Blob), from which Static Image References pick their image. There is no per-user scoping — everyone sees and uploads to the same library.
_Avoid_: Media library, gallery, uploads

**Static Media Reference**:
A Reference that holds a single asset (image or video) chosen from the Asset Library. The media type is inferred from the file. No prompt, no generation.
_Avoid_: Static Image Reference, Static Video Reference

**Static Text Reference**:
A Reference that holds user-entered text, which other nodes can consume (e.g. as part of a prompt).

**Generation Node**:
A node that takes one or more inputs (References or other Generation Nodes), holds a prompt, and produces an output asset when "Generate" is triggered. Comes in two kinds: an Image Generation Node and a Video Generation Node.
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
When a Generation Node's variant count is set above one and generation is triggered, the node clones itself into that many independent nodes. Each clone inherits the incoming reference edges of the original.
_Avoid_: Copy, duplicate

## Connection rules

A directed edge means "the source's output feeds a specific input handle of the target".

- References have an output handle only — nothing can connect *into* a Reference.
- Generation Nodes have an output handle and several **named, typed input handles** (below). Outputs may chain into further Generation Nodes.
- Connections are validated by the data type accepted at each handle; disallowed edges are rejected at connect time. A node feeding a downstream consumer provides its Active Output.

**Image Generation Node — input handles:**
- `text` — accepts Static Text References (many; concatenated into the Resolved Prompt).
- `image` — accepts images (media ref or image-gen output); many allowed. When any image is connected the node is in **edit** mode rather than pure generation.

**Video Generation Node — input handles:**
- `text` — accepts Static Text References (many).
- `start frame` — one image.
- `end frame` — one image.
- `image reference` — many images.
- `video` — one video. **Mutually exclusive** with `start frame`, `end frame` and `image reference`: when a video is connected those handles are blocked, leaving only `text`.

**Modes** are derived from which inputs are connected, never chosen by hand; the node displays the resulting mode label:
- Image Gen: text only → text→image; any image present → image→image (edit).
- Video Gen: text only → text→video; frames/image references present → image→video; video present → video→video.
- Video → an Image Generation Node is never allowed (no video→image).
