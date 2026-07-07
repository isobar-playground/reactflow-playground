# Generation node details live in a canvas drawer; Pending Output is separate from Active Output

Generation Nodes keep their working controls on the node itself: prompt, Model picker, variant count, Estimated Price, Generate/Regenerate, Output Preview, and History carousel. Detailed information - status, Resolved Prompt, Model details, errors, negative prompt, and full History - belongs in a canvas-level Node Details Drawer for the selected Generation Node, not in an inline panel inside the node.

During generation, a run becomes a Pending Output only after FAL accepts it and returns the pending-generation record. The Output Preview shows the pending activity state, and when there is existing History the carousel also shows a pending placeholder. During regeneration, this may hide the old output from the node's preview, but the previous Active Output remains what downstream nodes consume until the new run completes successfully. If the accepted run fails, the Pending Output disappears and no History entry is created.

We rejected keeping model/status/cost/prompt details in boxes inside the node because it made the node read like an inspector panel and duplicated what the drawer is for. We also rejected creating a draft History entry at click time because a submit failure would require rolling back visible history, and a pending run does not yet have an output or Actual Cost. Actual Cost stays attached to the completed output that incurred it; Estimated Price stays near the generate action because it informs the next run.

## Consequences

- The node UI should distinguish the visual Output Preview from the Active Output consumed by downstream nodes.
- The pending placeholder is transient UI around an accepted run, not a persisted History entry.
- Image and Video Generation Nodes should share this behavior; only their completed-output renderers differ.
