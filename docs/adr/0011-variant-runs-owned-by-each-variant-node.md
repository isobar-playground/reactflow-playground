# Variant runs are owned by each variant node, not by the submitter

When a Generation Node's variant count is above one, every variant — the original included — runs its own FAL generation (CONTEXT.md / Variant / Clone). The original's Generate handler only *submits* the clones' runs: clones are added to the canvas immediately, each with its `pendingGeneration` record set at submit time, and each clone's own resume-on-mount machinery (ADR-0009, issue #38) polls its run to completion and appends the result to its own History. The submitter never polls a clone's run.

We rejected the alternative — the original polls all runs in a batch and adds the clones with finished outputs (the original v1 behavior, which additionally skipped the original's own run entirely) — because it made clones invisible until every run finished and made a mid-run reload lose the clones' runs unrecoverably even though FAL bills them. Owning the run in the node it belongs to gives variants the same reload-resumability a single Generate already has, for free.

## Consequences

- A variant run's failure surfaces as that clone's own error state, without blocking siblings.
- The submit path must not also append the clone's result — double-append is the failure mode this ownership rule exists to prevent.
